#!/usr/bin/env bash
# LAN player (nginx + source service) checks and start, shared by setup.sh
# and `npm run player:start`.
#
#   bash scripts/player-stack.sh start   validate, build and start the player
#
# setup.sh sources this file for the same checks. Settings follow Docker
# Compose: the environment wins over .env, and .env wins over the defaults.

PLAYER_CERT_DIR=deploy/certs
PLAYER_CERT_FILES=(player.crt player.key local-ca.crt)

if ! declare -F fail >/dev/null; then
  fail() { printf '✗ %s\n' "$1" >&2; exit 1; }
fi

# player_setting NAME DEFAULT: value from the environment, then .env, then DEFAULT.
player_setting() {
  local name=$1 default=$2 value=${!1:-}

  if [ -z "$value" ] && [ -f .env ]; then
    value=$(sed -n "s/^[[:space:]]*$name[[:space:]]*=[[:space:]]*//p" .env | tail -n 1 |
      sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
  fi

  printf '%s' "${value:-$default}"
}

player_http_port() { player_setting PLAYER_HTTP_PORT 80; }
player_https_port() { player_setting PLAYER_HTTPS_PORT 443; }

player_lan_ip() {
  { hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true; } | awk '{print $1}'
}

# player_url SCHEME HOST PORT PATH: leaves out the port when it is the default.
player_url() {
  local scheme=$1 host=$2 port=$3 path=$4 default=443
  [ "$scheme" = http ] && default=80

  if [ "$port" = "$default" ]; then
    printf '%s://%s%s' "$scheme" "$host" "$path"
  else
    printf '%s://%s:%s%s' "$scheme" "$host" "$port" "$path"
  fi
}

# Directories where certificate files belong are leftovers of an older
# compose.yaml: Docker created them as root before the certificate existed.
player_check_certificate_paths() {
  local file leftovers=()

  for file in "${PLAYER_CERT_FILES[@]}" local-ca.key; do
    [ -d "$PLAYER_CERT_DIR/$file" ] && leftovers+=("$PLAYER_CERT_DIR/$file")
  done

  if [ "${#leftovers[@]}" -gt 0 ]; then
    fail "${leftovers[*]} should be certificate files but are directories, created by Docker before the certificate existed. Remove them, then run ./setup.sh again:
      sudo rmdir ${leftovers[*]} && sudo chown $(id -u):$(id -g) $PLAYER_CERT_DIR"
  fi
}

player_require_certificates() {
  local file

  player_check_certificate_paths

  for file in "${PLAYER_CERT_FILES[@]}"; do
    if [ ! -s "$PLAYER_CERT_DIR/$file" ]; then
      fail "missing $PLAYER_CERT_DIR/$file: the LAN player needs a local TLS certificate first. Run ./setup.sh once (or: npm run player:certificate -- <LAN IP>)."
    fi
  done
}

# player_port_in_use HOST PORT: succeeds when something accepts connections.
player_port_in_use() {
  node -e '
    const socket = require("node:net").connect({ host: process.argv[1], port: Number(process.argv[2]) });
    const done = (code) => { socket.destroy(); process.exit(code); };
    socket.setTimeout(1000, () => done(1));
    socket.on("connect", () => done(0));
    socket.on("error", () => done(1));
  ' "$1" "$2"
}

player_check_ports() {
  local bind http https hosts host port

  # A running player already holds its ports; Compose updates it in place.
  if docker compose ps --status running --services 2>/dev/null | grep -qx player; then
    return 0
  fi

  bind=$(player_setting PLAYER_BIND_ADDRESS 0.0.0.0)
  http=$(player_http_port)
  https=$(player_https_port)

  case "$bind" in
    0.0.0.0 | '::' | '') hosts="127.0.0.1 $(player_lan_ip)" ;;
    *) hosts=$bind ;;
  esac

  for port in "$http" "$https"; do
    for host in $hosts; do
      if player_port_in_use "$host" "$port"; then
        fail "port $port is already in use on $host, so the player cannot start there. Choose free ports, for example:
      PLAYER_HTTP_PORT=8080 PLAYER_HTTPS_PORT=8443 ./setup.sh
    or set PLAYER_HTTP_PORT and PLAYER_HTTPS_PORT in .env (see .env.example)."
      fi
    done
  done
}

# Starts the stack; on failure it removes what was started instead of leaving
# a half-running stack with a restart policy behind.
player_compose_up() {
  if ! docker compose up -d; then
    docker compose down >/dev/null 2>&1 || true
    fail "Docker Compose could not start the player (see the error above); nothing was left running."
  fi
}

player_print_urls() {
  local host=${1:-<lan-address>} http https
  http=$(player_http_port)
  https=$(player_https_port)

  printf '  Player   %s   (from any device on your network)\n' "$(player_url https "$host" "$https" /)"
  printf '  Studio   %s\n' "$(player_url https "$host" "$https" /index.html)"
  printf '  CA cert  %s   (install on other devices once)\n' "$(player_url http "$host" "$http" /local-ca.crt)"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  cd "$(dirname "$0")/.."

  case "${1:-}" in
    start)
      player_require_certificates
      player_check_ports
      npm run pieces:validate
      npm run build
      player_compose_up
      printf '\nThe LAN player is running.\n\n'
      player_print_urls "$(player_lan_ip)"
      printf '\nStop it with: npm run player:stop\n'
      ;;
    *)
      echo "usage: bash scripts/player-stack.sh start" >&2
      exit 2
      ;;
  esac
fi

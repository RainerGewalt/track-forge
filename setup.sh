#!/usr/bin/env bash
# Guided installation and start for the Strudel track workspace.
#
#   ./setup.sh            install, build and start the LAN player (nginx)
#   ./setup.sh --dev      install and start the Vite dev server instead
#   ./setup.sh --no-samples   skip downloading the CC0 sample library
#   ./setup.sh --image        pull and run the published GHCR images (no local build)
#   ./setup.sh --image=1.0.0  pin the image version (default: latest)
#
# Safe to re-run: every step detects existing state and skips or refreshes.

set -euo pipefail
cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# Console helpers
# ---------------------------------------------------------------------------

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

STEP=0
step()  { STEP=$((STEP + 1)); printf '\n%s[%d] %s%s\n' "$BOLD$CYAN" "$STEP" "$1" "$RESET"; }
ok()    { printf '    %s✓ %s%s\n' "$GREEN" "$1" "$RESET"; }
warn()  { printf '    %s! %s%s\n' "$YELLOW" "$1" "$RESET"; }
fail()  { printf '    %s✗ %s%s\n' "$RED" "$1" "$RESET"; exit 1; }
note()  { printf '    %s%s%s\n' "$DIM" "$1" "$RESET"; }

DEV_MODE=false
WITH_SAMPLES=true
IMAGE_MODE=false
PLAYER_VERSION=${PLAYER_VERSION:-latest}
for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=true ;;
    --no-samples) WITH_SAMPLES=false ;;
    --image) IMAGE_MODE=true ;;
    --image=*) IMAGE_MODE=true; PLAYER_VERSION="${arg#--image=}" ;;
    *) fail "unknown option: $arg (use --dev, --no-samples or --image[=VERSION])" ;;
  esac
done

if [ "$IMAGE_MODE" = true ] && [ "$DEV_MODE" = true ]; then
  fail "--image and --dev cannot be combined"
fi
export PLAYER_VERSION

describe_mode() {
  if [ "$IMAGE_MODE" = true ]; then echo "published images (GHCR, v$PLAYER_VERSION)"
  elif [ "$DEV_MODE" = true ]; then echo 'dev server'
  else echo 'production LAN player (nginx)'; fi
}

printf '%s\n' "${BOLD}Strudel Track Workspace — setup${RESET}"
note "mode: $(describe_mode)"

# ---------------------------------------------------------------------------
step "Checking prerequisites"
# ---------------------------------------------------------------------------

if [ "$IMAGE_MODE" = false ]; then
  command -v node >/dev/null || fail "Node.js is required (>= 20). https://nodejs.org"
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  [ "$NODE_MAJOR" -ge 20 ] || fail "Node.js >= 20 required, found $(node --version)"
  ok "node $(node --version)"

  command -v npm >/dev/null || fail "npm is required"
  ok "npm $(npm --version)"
else
  note "image mode: skipping Node/npm, dependencies and local build"
fi

if [ "$DEV_MODE" = false ]; then
  command -v docker >/dev/null || fail "Docker is required for the nginx player (or run ./setup.sh --dev)"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose …)"
  ok "docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) + compose"
  command -v openssl >/dev/null || fail "openssl is required to generate the local TLS certificate"
  ok "openssl available"
fi

if [ "$IMAGE_MODE" = false ]; then

# ---------------------------------------------------------------------------
step "Installing dependencies"
# ---------------------------------------------------------------------------

if [ -d node_modules/@strudel ]; then
  ok "node_modules present — skipping install (delete node_modules to force)"
else
  npm install --no-fund --no-audit
  ok "dependencies installed"
fi

# ---------------------------------------------------------------------------
step "Sample library (CC0)"
# ---------------------------------------------------------------------------

if [ "$WITH_SAMPLES" = false ]; then
  warn "skipped (--no-samples): tracks that use bot_ banks will stay silent"
elif [ -f public/samples/library/strudel-samples.json ] && [ -d public/samples/library/audio ] \
  && [ -n "$(ls -A public/samples/library/audio 2>/dev/null)" ]; then
  ok "library already built ($(find public/samples/library/audio -type f | wc -l) files)"
else
  note "downloading the curated CC0 selection (VCSL + Wikimedia, ~80 MB)…"
  npm run samples:seed
  npm run samples:download || warn "supplementary downloads failed — continuing with VCSL only"
  npm run samples:curate
  npm run samples:build
  npm run samples:audit || fail "sample library audit failed"
  ok "library built and audited"
fi

# ---------------------------------------------------------------------------
step "Generated assets"
# ---------------------------------------------------------------------------

if ls public/timeline-previews/*.json >/dev/null 2>&1; then
  ok "timeline previews present"
else
  npm run timeline:previews
  ok "timeline previews generated"
fi

npm run images:manifest >/dev/null
ok "images manifest refreshed"

# ---------------------------------------------------------------------------
step "Validating tracks"
# ---------------------------------------------------------------------------

npm run pieces:validate >/dev/null && ok "all tracks valid" || fail "track validation failed — run: npm run pieces:validate"

fi  # end build-from-source asset pipeline (skipped in --image mode)

# ---------------------------------------------------------------------------
if [ "$DEV_MODE" = true ]; then
  step "Starting dev server"
  note "player:  http://127.0.0.1:5173/player.html"
  note "studio:  http://127.0.0.1:5173/"
  exec npm run dev
fi

if [ "$IMAGE_MODE" = false ]; then
# ---------------------------------------------------------------------------
step "Building the app"
# ---------------------------------------------------------------------------

npm run build >/dev/null
ok "production build in dist/"
fi

# ---------------------------------------------------------------------------
step "TLS certificate for the LAN"
# ---------------------------------------------------------------------------

if [ -f deploy/certs/player.crt ] && [ -f deploy/certs/player.key ]; then
  ok "certificate exists (deploy/certs) — delete it to regenerate"
else
  DEFAULT_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  printf '    %sLAN address of this machine%s [%s]: ' "$BOLD" "$RESET" "${DEFAULT_IP:-none found}"
  read -r LAN_IP
  LAN_IP=${LAN_IP:-$DEFAULT_IP}
  [ -n "$LAN_IP" ] || fail "a LAN address is required for the certificate"
  bash scripts/generate-player-certificate.sh "$LAN_IP"
  ok "certificate generated for $LAN_IP"
fi

# ---------------------------------------------------------------------------
step "Starting the player (Docker Compose)"
# ---------------------------------------------------------------------------

if [ "$IMAGE_MODE" = true ]; then
  note "pulling ghcr.io images (v$PLAYER_VERSION)…"
  docker compose -f compose.image.yaml pull
  docker compose -f compose.image.yaml up -d
else
  docker compose up -d
fi
ok "player container running"

LAN_IP=${LAN_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}
printf '\n%sDone.%s\n\n' "$BOLD$GREEN" "$RESET"
printf '  %sPlayer%s   https://%s/            (from any device on your network)\n' "$BOLD" "$RESET" "${LAN_IP:-<lan-address>}"
printf '  %sStudio%s   https://%s/index.html\n' "$BOLD" "$RESET" "${LAN_IP:-<lan-address>}"
printf '  %sCA cert%s  http://%s/local-ca.crt  (install on other devices once)\n\n' "$BOLD" "$RESET" "${LAN_IP:-<lan-address>}"
if [ "$IMAGE_MODE" = true ]; then
  note "stop with:   docker compose -f compose.image.yaml down"
else
  note "stop with:   npm run player:stop"
fi
note "dev server:  ./setup.sh --dev"

#!/usr/bin/env bash
# First-use check, level L5 in docs/TESTING.md.
#
# Walks through the README the way a new user would and stops at the first
# step that does not behave as documented:
#
#   npm run first-use                   the committed HEAD, from a fresh clone
#   RELEASE=0.1.1 npm run first-use     the tag v0.1.1 from GitHub, and the
#                                       hosted demo on GitHub Pages
#
# It needs what the README asks of a user: Git, Node.js 20 or newer and npm
# for the Studio; Docker with Compose v2 and OpenSSL for the LAN player. It
# uses the ports 5173 (Studio), 18080 and 18443 (player) and 18079 (an
# occupied port for the documented failure), and runs without the sample
# download (--no-samples), which the README allows.
#
# FIRST_USE_KEEP=1 keeps the working directory for inspection.
set -euo pipefail

RELEASE="${RELEASE:-}"
REPO_URL="https://github.com/RainerGewalt/track-forge.git"
PAGES="https://rainergewalt.github.io/track-forge"
# Safety net for each wait, in seconds. A wait ends on what it waits for; the
# bound only stops a hang and is never the assertion.
WAIT="${FIRST_USE_WAIT:-120}"
HTTP_PORT=18080
HTTPS_PORT=18443
BUSY_PORT=18079

here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/track-forge-first-use.XXXXXX")"
clone="$work/track-forge"
dev_pid=""
busy_pid=""
player_up=0
steps=0

# A separate Compose project, so a player the user already runs is not touched.
export COMPOSE_PROJECT_NAME="track-forge-first-use"

step() { steps=$((steps + 1)); printf '\n==> %s\n' "$*"; }
ok() { printf '    ok: %s\n' "$*"; }

diagnostics() {
	for f in "$work"/logs/*.log; do
		[[ -s $f ]] || continue
		echo "--- $(basename "$f"):" >&2
		tail -n 15 "$f" >&2
	done
}

fail() {
	printf '\nFIRST-USE FAILED at step %d: %s\n' "$steps" "$*" >&2
	diagnostics
	exit 1
}

stop_dev() {
	if [[ -n $dev_pid ]]; then
		# setsid made the dev server the leader of its own process group.
		kill -- "-$dev_pid" 2>/dev/null || kill "$dev_pid" 2>/dev/null || true
		wait "$dev_pid" 2>/dev/null || true
		dev_pid=""
	fi
}

cleanup() {
	stop_dev
	[[ -n $busy_pid ]] && kill "$busy_pid" 2>/dev/null || true
	if ((player_up)); then
		(cd "$clone" && docker compose down -v --remove-orphans >/dev/null 2>&1) || true
	fi
	if [[ ${FIRST_USE_KEEP:-0} == 1 ]]; then
		echo "kept: $work"
	else
		rm -rf "$work" 2>/dev/null || echo "note: could not remove all of $work"
	fi
}
trap cleanup EXIT

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed: $2"; }
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# wait_port PORT WHAT [SECONDS]
wait_port() {
	local i bound=${3:-$WAIT}
	for ((i = 0; i < bound * 5; i++)); do
		port_in_use "$1" && return 0
		sleep 0.2
	done
	fail "$2 did not open port $1 within ${bound}s"
}

# run_cli EXPECTED_EXIT GREP_PATTERN ARGS...: run a command, check its exit
# code and that its output matches the pattern.
run_cli() {
	local want=$1 pattern=$2 out code
	shift 2
	if out="$("$@" 2>&1)"; then code=0; else code=$?; fi
	[[ $code == "$want" ]] || fail "$* exited $code, want $want; output: $(tail -n 8 <<<"$out")"
	grep -Eq -- "$pattern" <<<"$out" || fail "$* did not print /$pattern/; output: $(tail -n 8 <<<"$out")"
	ok "$(grep -Em1 -- "$pattern" <<<"$out" | sed 's/\x1b\[[0-9;]*m//g' | sed 's/^ *//')  [exit $code: ${*//$work/<work>}]"
}

# wait_http URL WHAT [CURL ARGS...]: wait until URL answers with a success.
# Docker publishes a port before the server behind it accepts requests, so an
# open port alone does not mean the page is served.
wait_http() {
	local url=$1 what=$2 i
	shift 2
	for ((i = 0; i < WAIT * 5; i++)); do
		curl -fsS -o /dev/null --max-time 5 "$@" "$url" 2>/dev/null && return 0
		sleep 0.2
	done
	fail "$what did not answer $url within ${WAIT}s"
}

# page URL TITLE [CURL ARGS...]: the URL answers 200 and has the title.
page() {
	local url=$1 title=$2 body
	shift 2
	body="$(curl -fsS --max-time 20 "$@" "$url")" || fail "GET $url failed"
	grep -q "<title>$title" <<<"$body" || fail "$url has no title '$title'"
	ok "GET $url: $title"
}

# ---------------------------------------------------------------------------
step "Prerequisites from the README"
need git "Fastest start: Git, Node.js 20 or newer and npm"
need node "Fastest start: Node.js 20 or newer"
need npm "Fastest start: npm"
need curl "this check reads the pages with it"
need docker "the LAN player runs on Docker Compose"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 (docker compose) is missing"
need openssl "the LAN player needs a local TLS certificate"
need python3 "this check occupies a port with it for the documented failure"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
((node_major >= 20)) || fail "Node.js $(node --version) is older than the documented 20"
for port in 5173 $HTTP_PORT $HTTPS_PORT $BUSY_PORT; do
	port_in_use "$port" && fail "port $port is in use (Studio 5173, player $HTTP_PORT and $HTTPS_PORT, check $BUSY_PORT)"
done
mkdir -p "$work/logs"
ok "git, node $(node --version), npm $(npm --version), docker compose, openssl; ports free"

# ---------------------------------------------------------------------------
step "Get the code"
if [[ -z $RELEASE ]]; then
	rev="$(git -C "$here" rev-parse HEAD)"
	if [[ -n "$(git -C "$here" status --porcelain)" ]]; then
		echo "    note: uncommitted changes are not part of this check; it runs the committed HEAD ${rev:0:12}"
	fi
	git clone --quiet "$here" "$clone"
	git -C "$clone" checkout --quiet "$rev"
	ok "fresh clone of $(git -C "$clone" describe --tags --always)"
else
	git clone --quiet --depth 1 --branch "v$RELEASE" "$REPO_URL" "$clone" 2>"$work/logs/clone.log" ||
		fail "tag v$RELEASE not found on $REPO_URL"
	ok "tag v$RELEASE from GitHub"
	step "Try it without installing (hosted demo)"
	page "$PAGES/" "Track Forge"
	page "$PAGES/player.html" "Track Forge — Listening player"
fi
cd "$clone"

# ---------------------------------------------------------------------------
step "The LAN player before setup (fixed after 0.1.0)"
# On a fresh clone, starting the player first must ask for ./setup.sh and
# must not let Docker create root-owned directories for the certificate.
run_cli 1 'Run \./setup\.sh once' npm run player:start
for f in deploy/certs/player.crt deploy/certs/player.key deploy/certs/local-ca.crt; do
	[[ -e $f ]] && fail "$f exists after a refused player:start"
done
ok "no certificate paths were created"

# ---------------------------------------------------------------------------
step "Fastest start: ./setup.sh --dev --no-samples"
setsid ./setup.sh --dev --no-samples >"$work/logs/dev.log" 2>&1 &
dev_pid=$!
# setup installs the dependencies first, which can take minutes on a fresh clone.
wait_port 5173 "the Vite dev server" $((WAIT * 5))
wait_http "http://127.0.0.1:5173/" "the Vite dev server"
page "http://127.0.0.1:5173/" "Track Forge"
page "http://127.0.0.1:5173/player.html" "Track Forge — Listening player"
grep -q 'all tracks valid' "$work/logs/dev.log" || fail "setup did not validate the tracks"
stop_dev
ok "Studio and Player served; tracks validated by setup"

# ---------------------------------------------------------------------------
step "Add your first track (README)"
run_cli 0 'night-signal' npm run piece:create -- night-signal "Night Signal"
for f in main.strudel notes.md piece.js piece.json; do
	[[ -s src/pieces/night-signal/$f ]] || fail "piece:create did not write src/pieces/night-signal/$f"
done
run_cli 0 '' npm run timeline:previews
ls public/timeline-previews/ | grep -q night-signal || fail "timeline:previews wrote no preview for night-signal"
run_cli 0 '' npm run pieces:validate
run_cli 0 'pass [1-9]' npm test
run_cli 0 '' npm run build
grep -rqs 'night-signal' dist/ || fail "the build does not contain the new track"
ok "night-signal scaffolded, previewed, validated, tested and built"

# A track whose metadata is broken has to be named by the validator.
cp src/pieces/night-signal/piece.json "$work/piece.json.ok"
printf '{ "id": "night-signal", "title": \n' >src/pieces/night-signal/piece.json
run_cli 1 'night-signal' npm run pieces:validate
cp "$work/piece.json.ok" src/pieces/night-signal/piece.json

# ---------------------------------------------------------------------------
step "Put the player on your local network (README), on ports $HTTP_PORT and $HTTPS_PORT"
# The documented failure first: an occupied port is named before anything starts.
python3 -m http.server "$BUSY_PORT" --bind 127.0.0.1 >"$work/logs/busy.log" 2>&1 &
busy_pid=$!
wait_port "$BUSY_PORT" "the occupying listener"
if out="$(printf '127.0.0.1\n' | PLAYER_HTTP_PORT=$BUSY_PORT PLAYER_HTTPS_PORT=$HTTPS_PORT ./setup.sh --no-samples 2>&1)"; then
	fail "setup started although port $BUSY_PORT was taken"
fi
grep -q "port $BUSY_PORT is already in use" <<<"$out" && grep -q 'PLAYER_HTTP_PORT' <<<"$out" ||
	fail "setup did not name the taken port and PLAYER_HTTP_PORT: $(tail -n 5 <<<"$out")"
[[ -z "$(docker compose ps -q 2>/dev/null)" ]] || fail "containers were started although the port check failed"
kill "$busy_pid" 2>/dev/null || true
busy_pid=""
ok "port $BUSY_PORT named with PLAYER_HTTP_PORT, nothing started"

player_up=1
printf '127.0.0.1\n' | PLAYER_HTTP_PORT=$HTTP_PORT PLAYER_HTTPS_PORT=$HTTPS_PORT ./setup.sh --no-samples >"$work/logs/player.log" 2>&1 ||
	fail "./setup.sh for the LAN player: $(tail -n 5 "$work/logs/player.log")"
grep -q "https://127.0.0.1:$HTTPS_PORT/" "$work/logs/player.log" || fail "setup did not print the player URL with the port"
ca="$clone/deploy/certs/local-ca.crt"
wait_http "https://127.0.0.1:$HTTPS_PORT/" "the player" --cacert "$ca"
page "https://127.0.0.1:$HTTPS_PORT/" "Track Forge — Listening player" --cacert "$ca"
page "https://127.0.0.1:$HTTPS_PORT/index.html" "Track Forge" --cacert "$ca"
curl -fsS --max-time 20 "http://127.0.0.1:$HTTP_PORT/local-ca.crt" | grep -q 'BEGIN CERTIFICATE' ||
	fail "the local CA is not served on http://127.0.0.1:$HTTP_PORT/local-ca.crt"
redirect="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 20 "http://127.0.0.1:$HTTP_PORT/")"
[[ $redirect == "https://127.0.0.1:$HTTPS_PORT/"* ]] || fail "HTTP does not redirect to HTTPS with the port, got '$redirect'"
ok "player over TLS verified against the generated local CA; CA served; redirect keeps port $HTTPS_PORT"
run_cli 0 '' npm run player:stop
player_up=0
[[ -z "$(docker compose ps -q 2>/dev/null)" ]] || fail "containers still run after player:stop"
ok "player stopped"

if [[ -n $RELEASE ]]; then
	printf '\nFIRST-USE PASSED: %d steps, published release %s\n' "$steps" "$RELEASE"
else
	printf '\nFIRST-USE PASSED: %d steps, committed HEAD from a fresh clone\n' "$steps"
fi

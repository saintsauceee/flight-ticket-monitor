#!/bin/bash
# Runs Flight Monitor, installing dependencies and building first when needed.
#
#   ./run.sh              start now and open the browser (Ctrl+C stops it)
#   ./run.sh install      start at login and keep running in the background (macOS)
#   ./run.sh uninstall    stop the background service and remove it
#   ./run.sh status       show whether it is running
#   ./run.sh logs         follow the background service's log
#
#   --no-open             do not open the browser
#
# Run "./run.sh install" again after changing the code, .env or your Node version.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LABEL="com.flight-ticket-monitor"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/flight-ticket-monitor.log"
DOMAIN="gui/$(id -u)"
ENTRY="server/dist/index.js"
OPEN=1
PORT="${PORT:-}"
URL=""

say() { printf '%s\n' "$*"; }
die() { printf 'run.sh: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,12s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"; }

# The server reads PORT from .env itself; the script needs it to find the server.
port_from_env_file() {
  local value=""
  if [ -f .env ]; then
    value="$(sed -n "s/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*[\"']\{0,1\}\([0-9][0-9]*\).*/\1/p" .env | tail -n 1)"
  fi
  printf '%s' "${value:-8787}"
}

find_node() {
  if ! command -v node >/dev/null 2>&1; then
    # Not on PATH, for example outside an interactive shell: try nvm.
    local nvm="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    if [ -s "$nvm" ]; then
      set +eu
      # shellcheck disable=SC1090
      . "$nvm" >/dev/null 2>&1
      set -eu
    fi
  fi
  command -v node >/dev/null 2>&1 || die "Node.js was not found. Install Node 20.12 or newer."
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 12) ? 0 : 1)' \
    || die "Node.js 20.12 or newer is required, found $(node -v)."
}

needs_build() {
  [ -f "$ENTRY" ] && [ -f web/dist/index.html ] || return 0
  local changed
  changed="$(find server/src server/package.json server/tsup.config.ts shared \
    web/src web/public web/index.html web/package.json web/vite.config.ts package-lock.json \
    -newer "$ENTRY" -print -quit 2>/dev/null || true)"
  [ -n "$changed" ]
}

ensure_built() {
  if [ ! -d node_modules ]; then
    say "Installing dependencies..."
    npm install
  fi
  if needs_build; then
    say "Building..."
    npm run build
  fi
}

is_up() { curl -fsS --max-time 2 "$URL/api/meta" 2>/dev/null | grep -q '"provider"'; }
port_busy() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }

# wait_until <tries> <command...>: retries every half second.
wait_until() {
  local tries="$1" i
  shift
  for i in $(seq 1 "$tries"); do
    if "$@"; then return 0; fi
    sleep 0.5
  done
  return 1
}

open_browser() {
  [ "$OPEN" = 1 ] || return 0
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  fi
}

cmd_start() {
  if is_up; then
    say "Flight Monitor is already running at $URL"
    open_browser
    return 0
  fi
  if port_busy; then
    die "Port $PORT is in use by another program. Set a different PORT in .env."
  fi
  find_node
  ensure_built
  if [ "$OPEN" = 1 ]; then
    (wait_until 60 is_up && open_browser) >/dev/null 2>&1 &
  fi
  exec node "$ENTRY"
}

# ---- background service (launchd) ----

require_macos() { [ "$(uname)" = Darwin ] || die "The background service is only supported on macOS."; }
service_loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }
service_gone() { ! service_loaded; }
port_free() { ! port_busy; }

stop_service() {
  service_loaded || return 0
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  wait_until 20 service_gone || die "The background service did not stop."
}

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

write_plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$(command -v node)")</string>
    <string>$(xml "$ROOT/$ENTRY")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml "$ROOT")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
}

cmd_install() {
  require_macos
  find_node
  ensure_built
  stop_service
  wait_until 10 port_free \
    || die "Port $PORT is in use. If Flight Monitor is running in a terminal, stop it there (Ctrl+C) and run this again."
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  write_plist > "$PLIST"
  launchctl bootstrap "$DOMAIN" "$PLIST"
  wait_until 60 is_up || die "Installed, but the server did not come up. Check the log: $LOG"
  say "Flight Monitor is running at $URL"
  say "It now starts when you log in and restarts if it crashes."
  say "  log    : $LOG"
  say "  remove : ./run.sh uninstall"
  open_browser
}

cmd_uninstall() {
  require_macos
  stop_service
  rm -f "$PLIST"
  say "Removed. Flight Monitor no longer starts at login."
}

cmd_status() {
  if [ -f "$PLIST" ]; then say "Start at login : on"; else say "Start at login : off"; fi
  if is_up; then say "Server         : running at $URL"; else say "Server         : not running"; fi
}

cmd_logs() {
  [ -f "$LOG" ] || die "No log yet at $LOG (the background service has not run)."
  exec tail -n 40 -f "$LOG"
}

main() {
  local cmd="start" arg
  for arg in "$@"; do
    case "$arg" in
      --no-open) OPEN=0 ;;
      start | install | uninstall | status | logs) cmd="$arg" ;;
      -h | --help | help) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done
  # The background service does not inherit this shell's environment, so only
  # a foreground start honours a PORT set on the command line.
  if [ "$cmd" != start ] || [ -z "$PORT" ]; then PORT="$(port_from_env_file)"; fi
  URL="http://127.0.0.1:$PORT"
  "cmd_$cmd"
}

# Sourcing the file defines the functions without running anything.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi

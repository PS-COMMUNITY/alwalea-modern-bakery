#!/usr/bin/env bash
# =============================================================
# مشغّل لقطات CDP الشاملة — أدلة "قبل" لتدقيق توافق الواجهة (Task V-1)
# - قاعدة معزولة عبر HOME مؤقت (لا يلمس أي بيانات حقيقية)
# - Xvfb مباشر :78 بمقاس 1440x900x24 (نفس run-period-e2e.sh)
# - Lقطات في release-evidence/parity/before/*.png
# - السكربت: scripts/e2e/shots-all.ts (منفذ CDP من argv، SHOT_DIR من البيئة)
# =============================================================
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${E2E_PORT:-9555}"
HOME_DIR="${E2E_HOME:-/tmp/shots-e2e-home-$$}"
SHOT_DIR="${SHOT_DIR:-$(cd "$ROOT/.." && pwd)/release-evidence/parity/before}"
LOG="${E2E_LOG:-/tmp/shots-electron.log}"

echo "=== Electron Shots-All E2E | HOME=$HOME_DIR | PORT=$PORT | SHOTS=$SHOT_DIR ==="
rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR" "$SHOT_DIR"

XVFB_PID=""
start_xvfb() {
  local disp="${E2E_DISPLAY:-:78}"
  Xvfb "$disp" -screen 0 1440x900x24 -nolisten tcp > /dev/null 2>&1 &
  XVFB_PID=$!
  export DISPLAY="$disp"
  sleep 1.5
}
stop_xvfb() {
  [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null
  XVFB_PID=""
}

launch() {
  HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" \
    "$ROOT/node_modules/.bin/electron" "$ROOT" --remote-debugging-port="$PORT" \
    > "$LOG" 2>&1 &
  echo $!
}

wait_port() {
  for i in $(seq 1 45); do
    if curl -s "http://127.0.0.1:$PORT/json" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "FATAL | CDP port did not open — log tail:"
  tail -20 "$LOG"
  return 1
}

start_xvfb
PID=$(launch)
if ! wait_port; then kill "$PID" 2>/dev/null; stop_xvfb; exit 1; fi

( cd "$ROOT" && SHOT_DIR="$SHOT_DIR" bun scripts/e2e/shots-all.ts "$PORT" )
RC=${PIPESTATUS[0]}

kill "$PID" 2>/dev/null
sleep 1
pkill -f "remote-debugging-port=$PORT" 2>/dev/null
stop_xvfb

echo "=== DONE | rc=$RC ==="
echo "Screenshots: $SHOT_DIR"
exit "$RC"

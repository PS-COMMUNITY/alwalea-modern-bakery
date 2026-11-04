#!/usr/bin/env bash
# =============================================================
# مشغّل الجرد البصري — لقطات قبل/بعد لكل الشاشات
# استخدام: bash scripts/e2e/run-visual-audit.sh [OUT_DIR] [PORT]
# =============================================================
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${2:-9445}"
OUT_DIR="${1:-/tmp/va-shots}"
HOME_DIR="/tmp/va-home-$$"
LOG="/tmp/va-electron.log"
rm -rf "$HOME_DIR"; mkdir -p "$HOME_DIR" "$OUT_DIR"

DISP="${VA_DISPLAY:-:78}"
Xvfb "$DISP" -screen 0 1440x900x24 -nolisten tcp > /dev/null 2>&1 &
XVFB_PID=$!
export DISPLAY="$DISP"
sleep 1.5

HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" \
  "$ROOT/node_modules/.bin/electron" "$ROOT" --remote-debugging-port="$PORT" \
  > "$LOG" 2>&1 &
PID=$!

for i in $(seq 1 45); do
  curl -s "http://127.0.0.1:$PORT/json" >/dev/null 2>&1 && break
  sleep 1
done

cd "$ROOT" && E2E_SHOT_DIR="$OUT_DIR" bun scripts/e2e/visual-audit.ts "$PORT"
RC=$?

kill "$PID" 2>/dev/null; sleep 1
pkill -f "remote-debugging-port=$PORT" 2>/dev/null
kill "$XVFB_PID" 2>/dev/null
echo "=== VA RUNNER DONE | rc=$RC | shots=$OUT_DIR ==="
exit "$RC"

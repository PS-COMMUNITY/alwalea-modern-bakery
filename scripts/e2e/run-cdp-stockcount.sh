#!/usr/bin/env bash
# مشغّل اختبار CDP للجرد الشهري والإقفال والتقارير — معزول تمامًا (HOME مؤقت + Xvfb)
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${MC_CDP_PORT:-9222}"
HOME_DIR="${MC_CDP_HOME:-/tmp/mc-cdp-home}"
SHOT_DIR="${MC_CDP_SHOTS:-/tmp/e2e-shots-mc}"
DISPLAY_NUM="${MC_CDP_DISPLAY:-81}"
LOG="${MC_CDP_LOG:-/tmp/mc-cdp-electron.log}"

rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR" "$SHOT_DIR"

Xvfb "$DISPLAY_NUM" -screen 0 1440x900x24 -nolisten tcp > /dev/null 2>&1 &
XVFB_PID=$!
sleep 2

HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" DISPLAY=":$DISPLAY_NUM" \
  "$ROOT/node_modules/.bin/electron" "$ROOT" --remote-debugging-port="$PORT" \
  > "$LOG" 2>&1 &
APP_PID=$!

for i in $(seq 1 40); do
  if curl -s "http://127.0.0.1:$PORT/json/list" 2>/dev/null | grep -q '"type": "page"'; then break; fi
  sleep 1
done

cd "$ROOT"
timeout 180 bun scripts/e2e/cdp-stockcount-test.ts "$PORT"
RC=$?

kill "$APP_PID" 2>/dev/null
kill "$XVFB_PID" 2>/dev/null
pkill -f "remote-debugging-port=$PORT" 2>/dev/null
exit $RC

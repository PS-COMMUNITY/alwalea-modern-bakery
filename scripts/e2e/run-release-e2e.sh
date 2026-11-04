#!/usr/bin/env bash
# =============================================================
# مشغّل اختبار الإطلاق الشامل لتطبيق Electron — مخبز الولاء الحديث
# - قاعدة معزولة عبر HOME مؤقت (لا يلمس أي بيانات حقيقية)
# - المرحلة 1: إعداد كامل + دورات مالية + لقطات
# - إعادة تشغيل التطبيق نفسه (إغلاق ثم فتح) — المرحلة 2: التحقق من بقاء البيانات
# النتيجة: /tmp/e2e-shots/*.png + سجل كامل في stdout، رمز خروج 0 عند نجاح الكل
# =============================================================
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${E2E_PORT:-9333}"
HOME_DIR="${E2E_HOME:-/tmp/e2e-home-$$}"
SHOT_DIR="${E2E_SHOT_DIR:-/tmp/e2e-shots}"
STATE="${E2E_STATE_FILE:-/tmp/e2e-state.json}"
LOG="${E2E_LOG:-/tmp/e2e-electron.log}"
FAILURES=0

echo "=== Electron Release E2E | HOME=$HOME_DIR | PORT=$PORT ==="
rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR" "$SHOT_DIR"

XVFB_PID=""
start_xvfb() {
  local disp="${E2E_DISPLAY:-:77}"
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

run_phase() {
  local phase="$1"
  ( cd "$ROOT" && E2E_SHOT_DIR="$SHOT_DIR" E2E_STATE_FILE="$STATE" \
      bun scripts/e2e/release-e2e.ts "$phase" "$PORT" ) | tee "/tmp/e2e-$phase.out"
  local rc=${PIPESTATUS[0]}
  return "$rc"
}

# ---------- المرحلة 1 ----------
start_xvfb
PID=$(launch)
if ! wait_port; then kill "$PID" 2>/dev/null; stop_xvfb; exit 1; fi
if run_phase phase1; then :; else FAILURES=$((FAILURES+1)); fi

# إغلاق نظيف ثم إعادة تشغيل فعلي لنفس قاعدة البيانات
kill "$PID" 2>/dev/null
for i in $(seq 1 15); do
  curl -s "http://127.0.0.1:$PORT/json" >/dev/null 2>&1 || break
  sleep 1
done
pkill -f "remote-debugging-port=$PORT" 2>/dev/null
sleep 2

# ---------- المرحلة 2 ----------
PID=$(launch)
if ! wait_port; then kill "$PID" 2>/dev/null; stop_xvfb; exit 1; fi
if run_phase phase2; then :; else FAILURES=$((FAILURES+1)); fi

kill "$PID" 2>/dev/null
sleep 1
pkill -f "remote-debugging-port=$PORT" 2>/dev/null
stop_xvfb

echo "=== DONE | failing_phases=$FAILURES ==="
echo "Screenshots: $SHOT_DIR"
exit "$FAILURES"

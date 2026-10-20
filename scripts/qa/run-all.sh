#!/bin/bash
# إعادة بناء قاعدة الاختبار المعزولة بالكامل وتشغيل كل الدفعات بالترتيب
set -e
cd /home/z/my-project
export DATABASE_URL=file:/tmp/qa-bakery/qa.db
echo "=== SEED ==="
bun scripts/qa/seed.ts 2>&1 | grep -v "prisma:query" | tail -2
for batch in batch-a-auth batch-b-catalog batch-c-sales batch-d-ops batch-e-reports; do
  if [ -f "scripts/qa/$batch.ts" ]; then
    echo "=== $batch ==="
    bun "scripts/qa/$batch.ts" 2>&1 | grep -v "prisma:query" | grep -E "^(PASS|FAIL|=====|الاختبارات)" || true
  fi
done

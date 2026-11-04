-- =============================================================
-- 003: الجرد الشهري وإقفال الشهور (موازاة Task P1-E من تطبيق الويب)
-- period_close: صف واحد لكل شهر YYYY-MM (UNIQUE) — الحاجز المالي الموحد
-- stock_count / stock_count_item: أوراق جرد شهرية بلقطة أرصدة الدفتر
-- الأموال: أغورة Minor — الكميات: ألفية Milli — idempotent (IF NOT EXISTS فقط)
-- =============================================================

-- status مصدر الحقيقة: locked = 1 مقفل / 0 مفتوح (فك القفل بسبب موثق)
CREATE TABLE IF NOT EXISTS period_close (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  month               TEXT NOT NULL UNIQUE,             -- YYYY-MM
  locked              INTEGER NOT NULL DEFAULT 1,
  closed_at           TEXT NOT NULL,
  closed_by_user_id   INTEGER REFERENCES users(id),
  closed_by_name      TEXT,
  unlocked_at         TEXT,
  unlocked_by_user_id INTEGER REFERENCES users(id),
  unlocked_by_name    TEXT,
  unlock_reason       TEXT,                             -- آخر سبب فك قفل — إلزامي في مسار فك القفل
  close_count         INTEGER NOT NULL DEFAULT 1,       -- كم مرة أُقفل (يفسح ثم يُعاد إقفاله)
  created_at          TEXT NOT NULL,
  updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_period_close_month ON period_close(month);
CREATE INDEX IF NOT EXISTS idx_period_close_locked ON period_close(locked);

-- status: DRAFT | APPROVED — count_no فريد بصيغة JC-YYYYMM-0001
CREATE TABLE IF NOT EXISTS stock_count (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  count_no            TEXT NOT NULL UNIQUE,
  month               TEXT NOT NULL,                    -- YYYY-MM — شهر الجرد
  status              TEXT NOT NULL DEFAULT 'DRAFT',
  note                TEXT,
  user_id             INTEGER REFERENCES users(id),
  user_name           TEXT,
  created_at          TEXT NOT NULL,
  approved_at         TEXT,
  approved_by_user_id INTEGER REFERENCES users(id),
  approved_by_name    TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_count_month ON stock_count(month);
CREATE INDEX IF NOT EXISTS idx_stock_count_status ON stock_count(status);

-- system_qty_milli لقطة الرصيد الدفتري عند الإنشاء، counted_qty_milli NULL = لم يُجرد
CREATE TABLE IF NOT EXISTS stock_count_item (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id          INTEGER NOT NULL REFERENCES stock_count(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  product_name      TEXT NOT NULL,
  system_qty_milli  INTEGER NOT NULL,
  counted_qty_milli INTEGER,
  unit_cost_minor   INTEGER NOT NULL                    -- تكلفة لحظة الجرد لتقييم قيمة الفرق
);
CREATE INDEX IF NOT EXISTS idx_stock_count_item_count ON stock_count_item(count_id);

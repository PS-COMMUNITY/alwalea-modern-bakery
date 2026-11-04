-- =============================================================
-- مخبز الولاء الحديث — 003_month_close.sql
-- الجرد الشهري (لقطة أرصدة + فعلي + فرق بسبب إلزامي)
-- وإقفال الشهر (قفل يمنع التعديل الرجعي حتى يُفك بسببه).
-- الأموال: أغورة Minor — الكميات: ألفية ×1000 (Milli). idempotent.
-- =============================================================

-- status: DRAFT|APPROVED — فهرس فريد جزئي: جرد معتمد واحد فقط لكل شهر
CREATE TABLE IF NOT EXISTS stock_counts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period_ym   TEXT NOT NULL,                 -- 'YYYY-MM'
  status      TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED')),
  created_at  TEXT NOT NULL,
  approved_at TEXT,
  created_by  TEXT,
  approved_by TEXT,
  note        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_counts_period_approved ON stock_counts(period_ym) WHERE status = 'APPROVED';

-- اللقطة: system عند الفتح، actual ما عُدّ فعليًا، diff = actual - system (موقعة)
CREATE TABLE IF NOT EXISTS stock_count_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id         INTEGER NOT NULL REFERENCES stock_counts(id),
  product_id       INTEGER NOT NULL,
  product_name     TEXT NOT NULL,
  system_qty_milli INTEGER NOT NULL,
  actual_qty_milli INTEGER NOT NULL,
  diff_milli       INTEGER NOT NULL,
  reason           TEXT NOT NULL,              -- من قائمة الأسباب الإلزامية
  note             TEXT,
  unit             TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(count_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_product ON stock_count_items(product_id);

-- إقفال الشهر: صف بدون unlocked_at = مقفل؛ الفك يوثق السبب ولا يُحذف
CREATE TABLE IF NOT EXISTS month_closes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  period_ym     TEXT NOT NULL UNIQUE,
  closed_at     TEXT NOT NULL,
  closed_by     TEXT NOT NULL,
  note          TEXT,
  unlocked_at   TEXT,
  unlocked_by   TEXT,
  unlock_reason TEXT
);

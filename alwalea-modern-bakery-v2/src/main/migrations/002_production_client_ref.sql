-- =============================================================
-- 002: منع الترحيل المزدوج لدفعات الإنتاج (توحيد مع البيع والشراء)
-- عمود client_ref اختياري + فهرس فريد (SQLite يسمح بعدة قيم NULL)
-- =============================================================
ALTER TABLE production_batches ADD COLUMN client_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_batches_client_ref ON production_batches(client_ref);

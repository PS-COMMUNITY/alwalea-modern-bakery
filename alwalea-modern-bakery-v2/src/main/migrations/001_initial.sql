-- =============================================================
-- مخبز الولاء الحديث — 001_initial.sql
-- الأموال: أعداد صحيحة (أغورة Minor) — الكميات: ألفية ×1000 (Milli)
-- القيم الموقعة: قيود الدفاتر وحركات المخزون قد تكون سالبة (موثقة).
-- =============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,            -- OWNER|MANAGER|CASHIER|STOCK|PRODUCTION|DISTRIBUTION|ACCOUNTANT
  password_hash   TEXT NOT NULL,            -- scrypt hex
  password_salt   TEXT NOT NULL,            -- hex
  pin_hash        TEXT,
  pin_salt        TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- type: RAW|FINISHED|TRADE
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  sku             TEXT UNIQUE,
  category_id     INTEGER REFERENCES categories(id),
  type            TEXT NOT NULL DEFAULT 'FINISHED',
  base_unit       TEXT NOT NULL DEFAULT 'قطعة',
  price_minor     INTEGER NOT NULL DEFAULT 0,
  cost_minor      INTEGER NOT NULL DEFAULT 0,
  min_stock_milli INTEGER NOT NULL DEFAULT 0,
  track_stock     INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- amount_minor موقعة: (+) تزيد دين العميل، (−) تنقصه
CREATE TABLE IF NOT EXISTS customer_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  ref_type     TEXT NOT NULL,             -- SALE|PAYMENT|ADJUSTMENT|SALE_CANCEL|TRIP_SALE
  ref_id       INTEGER,
  amount_minor INTEGER NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_created ON customer_ledger(created_at);

CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id  INTEGER NOT NULL REFERENCES suppliers(id),
  ref_type     TEXT NOT NULL,             -- PURCHASE|PAYMENT|ADJUSTMENT|PURCHASE_CANCEL
  ref_id       INTEGER,
  amount_minor INTEGER NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger(supplier_id);

-- status: PAID|PARTIAL|CREDIT|CANCELLED  — source: POS|DISTRIBUTION
CREATE TABLE IF NOT EXISTS sales (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no      TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL,
  customer_id     INTEGER REFERENCES customers(id),
  subtotal_minor  INTEGER NOT NULL,
  discount_minor  INTEGER NOT NULL DEFAULT 0,
  tax_minor       INTEGER NOT NULL DEFAULT 0,
  total_minor     INTEGER NOT NULL,
  paid_minor      INTEGER NOT NULL DEFAULT 0,
  credit_minor    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'POS',
  client_ref      TEXT UNIQUE,
  note            TEXT,
  shift_id        INTEGER REFERENCES shifts(id),
  user_id         INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL,
  cancelled_at    TEXT,
  cancel_reason   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

CREATE TABLE IF NOT EXISTS sale_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  qty_milli         INTEGER NOT NULL,
  unit_price_minor  INTEGER NOT NULL,
  discount_minor    INTEGER NOT NULL DEFAULT 0,
  line_total_minor  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

-- method: CASH|CREDIT
CREATE TABLE IF NOT EXISTS sale_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id      INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method       TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  shift_id     INTEGER REFERENCES shifts(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);

-- status: ACTIVE|PAID|PARTIAL|CREDIT|CANCELLED — client_ref لمنع الترحيل المزدوج
CREATE TABLE IF NOT EXISTS purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no      TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL,
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  subtotal_minor  INTEGER NOT NULL,
  discount_minor  INTEGER NOT NULL DEFAULT 0,
  total_minor     INTEGER NOT NULL,
  paid_minor      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL,
  client_ref      TEXT UNIQUE,
  note            TEXT,
  prev_cost_minor INTEGER,
  user_id         INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL,
  cancelled_at    TEXT,
  cancel_reason   TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id      INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  qty_milli        INTEGER NOT NULL,
  unit_cost_minor  INTEGER NOT NULL,
  line_total_minor INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);

CREATE TABLE IF NOT EXISTS purchase_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id  INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  method       TEXT NOT NULL DEFAULT 'CASH',
  amount_minor INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);

-- qty_milli موقعة — types: OPENING|PURCHASE|SALE|SALE_RETURN|PURCHASE_RETURN|PRODUCTION_IN|PRODUCTION_OUT|WASTE|ADJUSTMENT|TRIP_OUT|TRIP_RETURN
CREATE TABLE IF NOT EXISTS stock_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  qty_milli       INTEGER NOT NULL,
  type            TEXT NOT NULL,
  ref_type        TEXT,
  ref_id          INTEGER,
  unit_cost_minor INTEGER,
  note            TEXT,
  date            TEXT NOT NULL,
  user_id         INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product_date ON stock_movements(product_id, date);
CREATE INDEX IF NOT EXISTS idx_stock_mov_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_type ON stock_movements(type);

CREATE TABLE IF NOT EXISTS recipes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  product_id      INTEGER NOT NULL REFERENCES products(id),  -- المنتج الناتج
  output_qty_milli INTEGER NOT NULL,
  note            TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_milli  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items(recipe_id);

-- status: ACTIVE|CANCELLED
CREATE TABLE IF NOT EXISTS production_batches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no           TEXT NOT NULL UNIQUE,
  recipe_id          INTEGER NOT NULL REFERENCES recipes(id),
  date               TEXT NOT NULL,
  actual_qty_milli   INTEGER NOT NULL,
  waste_qty_milli    INTEGER NOT NULL DEFAULT 0,
  material_cost_minor INTEGER NOT NULL DEFAULT 0,
  unit_cost_minor    INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  notes              TEXT,
  user_id            INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL,
  cancelled_at       TEXT,
  cancel_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_production_date ON production_batches(date);

CREATE TABLE IF NOT EXISTS expense_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- status: ACTIVE|CANCELLED
CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  amount_minor INTEGER NOT NULL,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- status: OPEN|CLOSED
CREATE TABLE IF NOT EXISTS shifts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_at           TEXT NOT NULL,
  closed_at           TEXT,
  opening_cash_minor  INTEGER NOT NULL DEFAULT 0,
  expected_cash_minor INTEGER,
  counted_cash_minor  INTEGER,
  difference_minor    INTEGER,
  status              TEXT NOT NULL DEFAULT 'OPEN',
  user_id             INTEGER REFERENCES users(id),
  notes               TEXT
);

-- amount_minor موقعة — types: OPENING|SALE|EXPENSE|COLLECTION|PURCHASE|SUPPLIER_PAYMENT|TRIP_CASH|ADJUSTMENT|CLOSING
CREATE TABLE IF NOT EXISTS cash_movements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  shift_id     INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  type         TEXT NOT NULL,
  ref_type     TEXT,
  ref_id       INTEGER,
  amount_minor INTEGER NOT NULL,
  note         TEXT,
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_movements(date);
CREATE INDEX IF NOT EXISTS idx_cash_shift ON cash_movements(shift_id);

CREATE TABLE IF NOT EXISTS distribution_reps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS distribution_routes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- status: OPEN|SETTLED|CANCELLED
CREATE TABLE IF NOT EXISTS distribution_trips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_no     TEXT NOT NULL UNIQUE,
  rep_id      INTEGER NOT NULL REFERENCES distribution_reps(id),
  route_id    INTEGER REFERENCES distribution_routes(id),
  date        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'OPEN',
  notes       TEXT,
  settle_notes TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  settled_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_trips_date ON distribution_trips(date);

CREATE TABLE IF NOT EXISTS trip_loads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id    INTEGER NOT NULL REFERENCES distribution_trips(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_milli  INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_loads_trip ON trip_loads(trip_id);

-- payment_type: CASH|CREDIT — sale_id يُملأ عند الترحيل في التسوية (يمنع مضاعفة الترحيل)
CREATE TABLE IF NOT EXISTS trip_sales (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id          INTEGER NOT NULL REFERENCES distribution_trips(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  qty_milli        INTEGER NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  payment_type     TEXT NOT NULL,
  customer_id      INTEGER REFERENCES customers(id),
  sale_id          INTEGER REFERENCES sales(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_sales_trip ON trip_sales(trip_id);

-- condition: GOOD|DAMAGED
CREATE TABLE IF NOT EXISTS trip_returns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id    INTEGER NOT NULL REFERENCES distribution_trips(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_milli  INTEGER NOT NULL,
  condition  TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_returns_trip ON trip_returns(trip_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  user_id    INTEGER,
  username   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(date);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

CREATE TABLE IF NOT EXISTS sequences (
  name  TEXT PRIMARY KEY,   -- مثال: sale:20250101
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL,
  path           TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  note           TEXT
);

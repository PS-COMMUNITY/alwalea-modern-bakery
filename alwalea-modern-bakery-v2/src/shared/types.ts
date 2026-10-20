// =============================================================
// مخبز الولاء الحديث — الأنواع المشتركة (main / preload / renderer)
// الأموال: أعداد صحيحة بوحدة أصغر (أغورة) Minor.
// الكميات: أعداد صحيحة بوحدة ألفية (×1000) Milli.
// =============================================================

/** قائمة قنوات IPC المسموحة — المصدر الوحيد للقائمة (يُفرض في preload وفي main) */
export const IPC_CHANNELS = [
  'status.get',
  'setup.run',
  'auth.login',
  'auth.logout',
  'auth.me',
  'settings.get',
  'settings.update',
  'users.list',
  'users.create',
  'users.update',
  'users.setPassword',
  'users.setPin',
  'categories.list',
  'categories.create',
  'categories.update',
  'products.list',
  'products.get',
  'products.create',
  'products.update',
  'customers.list',
  'customers.get',
  'customers.create',
  'customers.update',
  'customers.statement',
  'customers.payment',
  'customers.adjust',
  'suppliers.list',
  'suppliers.get',
  'suppliers.create',
  'suppliers.update',
  'suppliers.statement',
  'suppliers.payment',
  'sales.list',
  'sales.get',
  'sales.create',
  'sales.cancel',
  'purchases.list',
  'purchases.get',
  'purchases.create',
  'purchases.cancel',
  'purchases.payment',
  'inventory.balances',
  'inventory.movements',
  'inventory.opening',
  'inventory.adjust',
  'inventory.waste',
  'inventory.low',
  'recipes.list',
  'recipes.get',
  'recipes.create',
  'recipes.update',
  'production.list',
  'production.create',
  'production.cancel',
  'distribution.reps.list',
  'distribution.reps.create',
  'distribution.reps.update',
  'distribution.routes.list',
  'distribution.routes.create',
  'distribution.routes.update',
  'distribution.trips.list',
  'distribution.trips.get',
  'distribution.trips.create',
  'distribution.trips.load',
  'distribution.trips.sale',
  'distribution.trips.return',
  'distribution.trips.settle',
  'distribution.trips.cancel',
  'expenses.categories.list',
  'expenses.categories.create',
  'expenses.list',
  'expenses.create',
  'expenses.cancel',
  'shifts.current',
  'shifts.open',
  'shifts.close',
  'shifts.list',
  'cash.list',
  'cash.record',
  'reports.dashboard',
  'reports.sales',
  'reports.collections',
  'reports.debts',
  'reports.suppliers',
  'reports.purchases',
  'reports.inventory',
  'reports.production',
  'reports.expenses',
  'reports.cash',
  'reports.distribution',
  'audit.list',
  'backup.export',
  'backup.list',
  'backup.preview',
  'backup.restore'
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export function isIpcChannel(ch: unknown): ch is IpcChannel {
  return typeof ch === 'string' && (IPC_CHANNELS as readonly string[]).includes(ch)
}

/** مغلف النتيجة الموحد لكل استدعاءات IPC — لا تُرمى استثناءات نحو الـ renderer */
export type ApiEnvelope<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: number }

export interface StatusInfo {
  setupCompleted: boolean
  businessName: string | null
  version: string
  schemaVersion: number
}

export interface SessionUser {
  id: number
  username: string
  name: string
  role: string
  perms: string[]
}

export interface LoginResult {
  token: string
  user: SessionUser
  businessName: string
}

export interface AppSettings {
  businessName: string
  currencyCode: string
  currencySymbol: string
  taxBp: number
  taxEnabled: boolean
  allowNegativeStock: boolean
  receiptFooter: string
  phone: string
  address: string
}

export interface UserRow {
  id: number
  username: string
  name: string
  role: string
  active: number
  hasPin: number
  created_at: string
}

export interface CategoryRow {
  id: number
  name: string
  active: number
}

export interface ProductRow {
  id: number
  name: string
  sku: string | null
  category_id: number | null
  category_name: string | null
  type: string
  base_unit: string
  price_minor: number
  cost_minor: number
  min_stock_milli: number
  track_stock: number
  active: number
}

export interface PartyRow {
  id: number
  name: string
  phone: string | null
  address: string | null
  note: string | null
  active: number
  balance_minor?: number
}

export interface LedgerRow {
  id: number
  created_at: string
  ref_type: string
  ref_id: number | null
  amount_minor: number
  note: string | null
  balance_minor: number
}

export interface SaleRow {
  id: number
  invoice_no: string
  date: string
  customer_id: number | null
  customer_name: string | null
  total_minor: number
  paid_minor: number
  credit_minor: number
  status: string
  source: string
  created_at: string
}

export interface SaleDetail extends SaleRow {
  subtotal_minor: number
  discount_minor: number
  tax_minor: number
  note: string | null
  items: Array<{
    id: number
    product_id: number
    product_name: string
    qty_milli: number
    unit_price_minor: number
    discount_minor: number
    line_total_minor: number
  }>
  payments: Array<{ id: number; method: string; amount_minor: number }>
}

export interface InventoryBalanceRow {
  product_id: number
  name: string
  base_unit: string
  type: string
  track_stock: number
  min_stock_milli: number
  cost_minor: number
  price_minor: number
  balance_milli: number
}

export interface StockMovementRow {
  id: number
  date: string
  product_id: number
  product_name: string
  qty_milli: number
  type: string
  ref_type: string | null
  ref_id: number | null
  note: string | null
  created_at: string
}

export interface DashboardReport {
  businessName: string
  currencySymbol: string
  todaySalesMinor: number
  todaySalesCount: number
  cashBalanceMinor: number
  receivablesMinor: number
  payablesMinor: number
  lowStockCount: number
  openShift: { id: number; opened_at: string; opening_cash_minor: number } | null
  recentSales: SaleRow[]
}

// ---------- أدوار وصلاحيات (انظر permissions.ts للتفاصيل) ----------
export type { Role, Perm } from './permissions'

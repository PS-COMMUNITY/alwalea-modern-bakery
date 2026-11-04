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
  'periods.list',
  'period.close',
  'period.unlock',
  'counts.list',
  'counts.get',
  'counts.create',
  'counts.saveItems',
  'counts.approve',
  'reports.countVariance',
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
  'reports.dashboardExtra',
  'reports.eod',
  'stockcount.get',
  'stockcount.open',
  'stockcount.saveItems',
  'stockcount.approve',
  'stockcount.variances',
  'stockcount.getMonthStatuses',
  'stockcount.closeMonth',
  'stockcount.unlockMonth',
  'audit.list',
  'backup.export',
  'backup.list',
  'backup.preview',
  'backup.restore',
  'backup.autoStatus',
  'telegram.test'
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
  telegramBotToken: string
  telegramChatId: string
  telegramDaily: boolean
  telegramTime: string
}

/** حالة النسخ التلقائي الدوري (rc.10) — للعرض في اللوحة والإعدادات */
export interface BackupAutoStatus {
  intervalMinutes: number
  lastAutoAt: string | null
  lastAutoNote: string | null
  autoCount: number
  dirPath: string
  logTail: string[]
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

// ---------- إقفال الشهور والجرد الشهري (P1-E) ----------
export interface PeriodRow {
  id: number
  month: string // YYYY-MM
  locked: boolean
  closed_at: string
  closed_by_name: string | null
  unlocked_at: string | null
  unlocked_by_name: string | null
  unlock_reason: string | null
  close_count: number
}

export interface StockCountRow {
  id: number
  count_no: string // JC-YYYYMM-0001
  month: string // YYYY-MM
  status: string // DRAFT | APPROVED
  note: string | null
  user_name: string | null
  created_at: string
  approved_at: string | null
  approved_by_name: string | null
  items_total: number
  items_counted: number
  diff_items: number
  diff_value_minor: number
}

export interface StockCountItemRow {
  id: number
  product_id: number
  product_name: string
  system_qty_milli: number
  counted_qty_milli: number | null
  diff_milli: number | null
  unit_cost_minor: number
}

export interface CountVarianceRow {
  product_id: number
  product_name: string
  system_qty_milli: number
  counted_qty_milli: number
  diff_milli: number
  unit_cost_minor: number
  diff_value_minor: number
}

// ---------- أدوار وصلاحيات (انظر permissions.ts للتفاصيل) ----------
export type { Role, Perm } from './permissions'

// ---------- rc.9: لوحة التحكم المتقدمة (المرحلة 2) ----------
/** نقطة في سلسلة المبيعات اليومية (للرسم الشهري) */
export interface SeriesPoint {
  date: string // YYYY-MM-DD
  total_minor: number
  invoices: number
}

/** مقارنة فترة مع سابقتها — null = لا بيانات كافية للمقارنة */
export interface CompareBlock {
  label: string
  currentMinor: number
  previousMinor: number | null
  currentInvoices: number
  previousInvoices: number | null
  deltaMinor: number | null
  deltaPct: number | null
}

/** أعلى منتجات مبيعًا في فترة */
export interface TopProductRow {
  product_id: number
  product_name: string
  qty_milli: number
  revenue_minor: number
}

/** أكبر المدينين (رصيد قائم) */
export interface DebtorRow {
  customer_id: number
  customer_name: string
  balance_minor: number
  oldest_unpaid_date: string | null
  days_late: number
}

/** تنبيهات اللوحة */
export interface AlertsInfo {
  lateOver30Count: number
  lateOver30Minor: number
  openShiftHours: number | null
  openShiftDays: number
}

/** بيانات إضافية للوحة التحكم */
export interface DashboardExtra {
  currencySymbol: string
  monthSeries: SeriesPoint[]
  monthTotalMinor: number
  compares: CompareBlock[]
  topPeriod: { key: string; label: string; from: string; to: string }
  topProducts: TopProductRow[]
  debtors: DebtorRow[]
  alerts: AlertsInfo
}

/** ورقة نهاية اليوم (المرحلة 3 — تُطبع A4) */
export interface EodData {
  businessName: string
  currencySymbol: string
  date: string
  invoicesCount: number
  salesTotalMinor: number
  cashInMinor: number
  collectionsMinor: number
  expensesMinor: number
  cashNetMinor: number
  creditSalesMinor: number
  byMethod: Array<{ method: string; amount_minor: number }>
  topItems: Array<{ product_name: string; qty_milli: number; revenue_minor: number }>
  openShift: { id: number; opened_at: string } | null
}

// =============================================================
// الجرد الشهري وإقفال الشهر (P0-D) — stockcount.*
// =============================================================

/** أسباب فروق الجرد — قائمة مغلقة إلزامية (سببان يصنفان النقص هالكًا عند الاعتماد) */
export const STOCK_COUNT_REASONS = ['هالك', 'تلف', 'فقدان', 'تسوية', 'أخرى'] as const

/** حالة شهر واحدة: الإقفال الموحد (month_closes أو period_close القديم) + حالة الجرد */
export interface MonthStatusRow {
  period_ym: string
  locked: boolean
  closed_at: string | null
  closed_by: string | null
  unlocked_at: string | null
  count_id: number | null
  count_status: 'DRAFT' | 'APPROVED' | null
}

/** رأس جرد شهري (stock_counts) */
export interface StockCountHeaderRow {
  id: number
  period_ym: string
  status: 'DRAFT' | 'APPROVED'
  created_at: string
  approved_at: string | null
  created_by: string | null
  approved_by: string | null
  note: string | null
}

/** بند جرد: لقطة الرصيد النظامي + الفعلي + الفرق الموقع + السبب الإلزامي */
export interface StockCountEntryRow {
  id: number
  count_id: number
  product_id: number
  product_name: string
  system_qty_milli: number
  actual_qty_milli: number
  diff_milli: number
  reason: string
  note: string | null
  unit: string | null
}

/** عرض الجرد الكامل كما يعيده stockcount.get/open/saveItems/approve */
export interface StockCountView {
  count: StockCountHeaderRow | null
  items: StockCountEntryRow[]
  month: MonthStatusRow | null
}

/** بند تقرير الفروق: يضيف تكلفة الوحدة والأثر المالي (فرق × تكلفة ÷ 1000) */
export interface VarianceItemRow extends StockCountEntryRow {
  cost_minor: number
  impact_minor: number
}

/** تقرير الفروق الكامل مع الخسارة/الفائض/الصافي بالأغورة وحالة الإقفال */
export interface VarianceReport {
  count: StockCountHeaderRow
  items: VarianceItemRow[]
  lossMinor: number
  gainMinor: number
  netMinor: number
  month: MonthStatusRow
}

/** حالة خدمة تيليجرام (alerts.ts) — قراءة سريعة لبطاقة الإعدادات */
export interface TelegramStatus {
  enabled: boolean
  chatId: string
  hasToken: boolean
  lastSentAt: string | null
  lastError: string | null
}

/** حالة النسخ التلقائي الدوري (backup.autoStatus) */
export interface AutoBackupStatus {
  intervalMinutes: number
  lastAutoAt: string | null
  lastAutoNote: string | null
  autoCount: number
  dirPath: string
  logTail: string[]
}

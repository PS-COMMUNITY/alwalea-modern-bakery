// =============================================================
// مخبز الولاء الحديث — مساعدات مشتركة للخدمات
// rc.12 (P0-1): حاجز الجرد النشط الموحد — كل حركة مخزنية تمر عبر addStockMovement
// وبالتالي الحاجز هنا يحمي كل الخدمات والقنوات في طبقة الخدمة لا الواجهة.
// =============================================================
import { BakeryDb } from '../db'
import { ApiError } from '../validate'
import type { SessionUser } from '../../shared/types'

export interface SvcCtx {
  db: BakeryDb
  user: SessionUser | null
  audit(action: string, entity?: string, entityId?: number | null, details?: unknown): void
}

export interface SettingRow {
  key: string
  value: string
}

export function getSetting(db: BakeryDb, key: string): string | null {
  const r = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  return r ? r.value : null
}

export function setSetting(db: BakeryDb, key: string, value: string): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, db.now()]
  )
}

export function getBoolSetting(db: BakeryDb, key: string, def = false): boolean {
  const v = getSetting(db, key)
  if (v === null) return def
  return v === '1' || v === 'true'
}

export function getIntSetting(db: BakeryDb, key: string, def = 0): number {
  const v = getSetting(db, key)
  if (v === null) return def
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

export function businessName(db: BakeryDb): string {
  return getSetting(db, 'business_name') ?? 'مخبز'
}

export function setupCompleted(db: BakeryDb): boolean {
  return getBoolSetting(db, 'setup_completed', false)
}

/** رصيد عميل من قيود الدفتر فقط (موجب = مديونية على العميل) */
export function customerBalance(db: BakeryDb, customerId: number): number {
  const r = db.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM customer_ledger WHERE customer_id = ?', [
    customerId
  ])
  return r ? Number(r.s) : 0
}

/** رصيد مورد من قيود الدفتر (موجب = علينا للمورد) */
export function supplierBalance(db: BakeryDb, supplierId: number): number {
  const r = db.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM supplier_ledger WHERE supplier_id = ?', [
    supplierId
  ])
  return r ? Number(r.s) : 0
}

/** رصيد مخزون منتج = مجموع الحركات (ممكن أن يكون سالبًا فقط إذا سمح الإعداد) */
export function stockBalance(db: BakeryDb, productId: number): number {
  const r = db.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE product_id = ?', [
    productId
  ])
  return r ? Number(r.s) : 0
}

/** رصيد الصندوق = مجموع حركات الصندوق الموقعة */
export function cashBalance(db: BakeryDb): number {
  const r = db.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM cash_movements')
  return r ? Number(r.s) : 0
}

export function openShift(db: BakeryDb): { id: number; opened_at: string; opening_cash_minor: number } | undefined {
  return db.get<{ id: number; opened_at: string; opening_cash_minor: number }>(
    "SELECT id, opened_at, opening_cash_minor FROM shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1"
  )
}

/** يتطلب وجود وردية مفتوحة للربط (إن وُجدت) — لا يفشل إن لم توجد */
export function currentShiftId(db: BakeryDb): number | null {
  const s = openShift(db)
  return s ? s.id : null
}

export function ensureExists<T>(row: T | undefined, msg: string): T {
  if (!row) throw new ApiError(msg, 404)
  return row
}

/** رقم مستند متسلسل S-YYYYMMDD-NNNN */
export function nextDocNo(db: BakeryDb, prefix: 'S' | 'P' | 'PRD' | 'TRP', date: string): string {
  const dayKey = date.replace(/-/g, '')
  const n = db.nextSeq(`${prefix.toLowerCase()}:${dayKey}`)
  return `${prefix}-${dayKey}-${String(n).padStart(4, '0')}`
}

// ---------- حاجز الجرد النشط (rc.12 — إصلاح P0-1 من مراجعة المحترفين) ----------

export const STOCK_COUNT_LOCK_MESSAGE =
  'يوجد جرد مخزون نشط (مسودة) — لا يمكن تنفيذ أي حركة مخزون (بيع/شراء/إنتاج/تسوية/إعدام/جولة توزيع) ' +
  'حتى اعتماد ورقة الجرد أو حذفها من شاشة الجرد، حتى تبقى أرقام اللقطة متسقة مع لحظة واحدة'

/**
 * هل توجد ورقة جرد نشطة (DRAFT)؟ — يعيد الورقة أو undefined
 * rc.13 (P0-1): نظاما الجرد كلاهما يحجبان — أوراق شاشة الفترات (counts.* → stock_count)
 * وأوراق شاشة الجرد (stockcount.* → stock_counts). مسودة في أي منهما تمنع حركات المخزون.
 */
export function activeStockCount(db: BakeryDb): { id: number; label: string } | undefined {
  const a = db.get<{ id: number; count_no: string }>(
    "SELECT id, count_no FROM stock_count WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1"
  )
  if (a) return { id: Number(a.id), label: a.count_no }
  const b = db.get<{ id: number; period_ym: string }>(
    "SELECT id, period_ym FROM stock_counts WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1"
  )
  if (b) return { id: Number(b.id), label: `جرد ${b.period_ym}` }
  return undefined
}

/**
 * الحاجز الموحد: يرمي 423 إن وُجد جرد نشط. يُستدعى من addStockMovement تلقائيًا،
 * ومن بداية كل معالج كتابة مخزنية (رسائل أوضح قبل أي كتابة جزئية).
 */
export function assertNoActiveStockCount(db: BakeryDb): void {
  const c = activeStockCount(db)
  if (c) {
    throw new ApiError(`${STOCK_COUNT_LOCK_MESSAGE} — الورقة: ${c.label}`, 423)
  }
}

/** حركة مخزون موحدة (تُستدعى داخل معاملة) — الحاجز الموحد للجرد النشط مفروض هنا */
export function addStockMovement(
  db: BakeryDb,
  args: {
    productId: number
    qtyMilli: number // موقعة
    type: string
    refType?: string | null
    refId?: number | null
    unitCostMinor?: number | null
    note?: string | null
    date?: string
    userId?: number | null
  }
): void {
  // rc.12 (P0-1): كل حركة مخزنية تمر من هنا — منع أي كتابة أثناء جرد نشط.
  // الاستثناء الوحيد: حركات الاعتماد نفسه لأنها إتمام الجرد وتحدث داخل نفس المعاملة —
  // rc.13: استثناء بصيغتي refType ('StockCount' لأوراق counts.* و'stock_count' لأوراق stockcount.*)
  if (args.refType !== 'StockCount' && args.refType !== 'stock_count') {
    assertNoActiveStockCount(db)
  }
  db.run(
    `INSERT INTO stock_movements (product_id, qty_milli, type, ref_type, ref_id, unit_cost_minor, note, date, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.productId,
      args.qtyMilli,
      args.type,
      args.refType ?? null,
      args.refId ?? null,
      args.unitCostMinor ?? null,
      args.note ?? null,
      args.date ?? db.today(),
      args.userId ?? null,
      db.now()
    ]
  )
}

/** قيد دفتر عميل (موجب يزيد الدين) */
export function addCustomerLedger(
  db: BakeryDb,
  args: { customerId: number; refType: string; refId?: number | null; amountMinor: number; note?: string | null }
): void {
  db.run(
    `INSERT INTO customer_ledger (customer_id, ref_type, ref_id, amount_minor, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [args.customerId, args.refType, args.refId ?? null, args.amountMinor, args.note ?? null, db.now()]
  )
}

/** قيد دفتر مورد (موجب يزيد ما علينا) */
export function addSupplierLedger(
  db: BakeryDb,
  args: { supplierId: number; refType: string; refId?: number | null; amountMinor: number; note?: string | null }
): void {
  db.run(
    `INSERT INTO supplier_ledger (supplier_id, ref_type, ref_id, amount_minor, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [args.supplierId, args.refType, args.refId ?? null, args.amountMinor, args.note ?? null, db.now()]
  )
}

/** حركة صندوق (موجبة = دخول نقدي) */
export function addCashMovement(
  db: BakeryDb,
  args: {
    type: string
    amountMinor: number
    refType?: string | null
    refId?: number | null
    note?: string | null
    date?: string
    userId?: number | null
    shiftId?: number | null
  }
): void {
  db.run(
    `INSERT INTO cash_movements (date, shift_id, type, ref_type, ref_id, amount_minor, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.date ?? db.today(),
      args.shiftId ?? currentShiftId(db),
      args.type,
      args.refType ?? null,
      args.refId ?? null,
      args.amountMinor,
      args.note ?? null,
      args.userId ?? null,
      db.now()
    ]
  )
}

/** تحقق مخزون: يمنع السالب ما لم يُسمح في الإعدادات */
export function assertStock(db: BakeryDb, productId: number, deltaMilli: number, productName: string): void {
  if (deltaMilli >= 0) return
  const balance = stockBalance(db, productId)
  if (balance + deltaMilli < 0) {
    if (getBoolSetting(db, 'allow_negative_stock', false)) return
    throw new ApiError(`المخزون غير كافٍ للمنتج «${productName}» — الرصيد الحالي ${balance / 1000}`)
  }
}

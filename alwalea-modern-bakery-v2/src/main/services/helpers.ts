// =============================================================
// مخبز الولاء الحديث — مساعدات مشتركة للخدمات
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

/** حركة مخزون موحدة (تُستدعى داخل معاملة) */
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

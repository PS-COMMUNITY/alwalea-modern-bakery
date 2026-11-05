// =============================================================
// مخبز الولاء الحديث — العملاء والموردون + الدفاتر والدفعات
// أرصدة الأطراف فقط عبر قيود الدفاتر (amount_minor موقعة).
// =============================================================
import { ApiError, reqStr, optStr, reqInt, reqMinor, obj } from '../validate'
import type { PartyRow, LedgerRow } from '../../shared/types'
import {
  SvcCtx,
  customerBalance,
  supplierBalance,
  addCustomerLedger,
  addSupplierLedger,
  addCashMovement
} from './helpers'
import { assertMonthOpen } from './period'

// ---------- العملاء ----------
export function listCustomers(ctx: SvcCtx, payload: Record<string, unknown>): Array<PartyRow> {
  const q = optStr(payload.q, 'بحث', 120)
  const includeInactive = payload.includeInactive === true
  const conditions: string[] = []
  const params: unknown[] = []
  if (!includeInactive) conditions.push('c.active = 1')
  if (q) {
    conditions.push('(c.name LIKE ? OR c.phone LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return ctx.db.query<PartyRow>(
    `SELECT c.id, c.name, c.phone, c.address, c.note, c.active,
            (SELECT COALESCE(SUM(l.amount_minor), 0) FROM customer_ledger l WHERE l.customer_id = c.id) AS balance_minor
     FROM customers c ${where} ORDER BY c.name LIMIT 1000`,
    params
  )
}

export function getCustomer(ctx: SvcCtx, payload: Record<string, unknown>): PartyRow {
  const id = reqInt(payload.id, 'المعرف', 1)
  const row = ctx.db.get<PartyRow>(
    `SELECT c.id, c.name, c.phone, c.address, c.note, c.active,
            (SELECT COALESCE(SUM(l.amount_minor), 0) FROM customer_ledger l WHERE l.customer_id = c.id) AS balance_minor
     FROM customers c WHERE c.id = ?`,
    [id]
  )
  if (!row) throw new ApiError('العميل غير موجود', 404)
  return row
}

interface PartyInput {
  name: string
  phone: string | null
  address: string | null
  note: string | null
}

function readPartyInput(payload: Record<string, unknown>): PartyInput {
  const src = obj(payload, 'payload')
  return {
    name: reqStr(src.name, 'الاسم', 200),
    phone: optStr(src.phone, 'الهاتف', 30),
    address: optStr(src.address, 'العنوان', 300),
    note: optStr(src.note, 'ملاحظة', 300)
  }
}

export function createCustomer(ctx: SvcCtx, payload: Record<string, unknown>): PartyRow {
  const input = readPartyInput(payload)
  return ctx.db.tx(() => {
    ctx.db.run('INSERT INTO customers (name, phone, address, note, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [
      input.name,
      input.phone,
      input.address,
      input.note,
      ctx.db.now()
    ])
    const id = ctx.db.lastId()
    ctx.audit('customer.create', 'customer', id, { name: input.name })
    return getCustomer(ctx, { id })
  })
}

export function updateCustomer(ctx: SvcCtx, payload: Record<string, unknown>): PartyRow {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    // rc.12-merge: التعديل الجزئي (اسم/هاتف فقط) كان يعيد تنشيط عميل معطّل إجباريًا
    // (undefined → 1) — عند غياب active من الحمولة نحافظ على قيمة existing
    const existing = getCustomer(ctx, { id })
    const input = readPartyInput(payload)
    const active = payload.active === undefined ? Number(existing.active) : payload.active === false ? 0 : 1
    ctx.db.run('UPDATE customers SET name = ?, phone = ?, address = ?, note = ?, active = ? WHERE id = ?', [
      input.name,
      input.phone,
      input.address,
      input.note,
      active,
      id
    ])
    ctx.audit('customer.update', 'customer', id, null)
    return getCustomer(ctx, { id })
  })
}

export function customerStatement(ctx: SvcCtx, payload: Record<string, unknown>): { customer: PartyRow; rows: LedgerRow[]; balanceMinor: number } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const customer = getCustomer(ctx, { id })
  const conditions = ['l.customer_id = ?']
  const params: unknown[] = [id]
  if (from) {
    // rc.12-merge: created_at مخزّن UTC — localtime يوحد التاريخ مع توقيت الجهاز المحلي
    conditions.push("date(l.created_at, 'localtime') >= ?")
    params.push(from)
  }
  if (to) {
    conditions.push("date(l.created_at, 'localtime') <= ?")
    params.push(to)
  }
  const rows = ctx.db.query<{ id: number; created_at: string; ref_type: string; ref_id: number | null; amount_minor: number; note: string | null }>(
    `SELECT l.id, l.created_at, l.ref_type, l.ref_id, l.amount_minor, l.note
     FROM customer_ledger l WHERE ${conditions.join(' AND ')}
     ORDER BY l.created_at, l.id`,
    params
  )
  let running = 0
  const ledger: LedgerRow[] = rows.map((r) => {
    running += Number(r.amount_minor)
    return { ...r, amount_minor: Number(r.amount_minor), balance_minor: running }
  })
  return { customer, rows: ledger, balanceMinor: customerBalance(ctx.db, id) }
}

/** تسجيل دفعة من عميل: تخصم من دفتره وتدخل الصندوق */
export function customerPayment(ctx: SvcCtx, payload: Record<string, unknown>): { balanceMinor: number } {
  const id = reqInt(payload.customerId, 'العميل', 1)
  const amountMinor = reqMinor(payload.amountMinor, 'المبلغ')
  if (amountMinor <= 0) throw new ApiError('مبلغ الدفعة يجب أن يكون أكبر من صفر')
  const note = optStr(payload.note, 'ملاحظة', 300)
  return ctx.db.tx(() => {
    getCustomer(ctx, { id })
    // حاجز الشهر المقفل: تحصيل بتاريخ الآن
    assertMonthOpen(ctx.db, new Date())
    addCustomerLedger(ctx.db, { customerId: id, refType: 'PAYMENT', amountMinor: -amountMinor, note })
    addCashMovement(ctx.db, { type: 'COLLECTION', amountMinor, refType: 'customer', refId: id, note: note ?? 'تحصيل دفعة عميل' })
    ctx.audit('customer.payment', 'customer', id, { amountMinor })
    return { balanceMinor: customerBalance(ctx.db, id) }
  })
}

/**
 * rc.12 — طلب المالك: حذف عميل أُضيف بالخطأ.
 * حذف نهائي فقط إن لم يكن له أي أثر مالي/مبيعات إطلاقًا —
 * وإلا يُرفض بأسماء الأسباب (الدفتر/فواتير/جولات) ويُقترح التعطيل.
 */
export function deleteCustomer(ctx: SvcCtx, payload: Record<string, unknown>): { id: number; deleted: true } {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    getCustomer(ctx, { id })
    const reasons: string[] = []
    const ledger = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM customer_ledger WHERE customer_id = ?', [id])
    if (Number(ledger?.c ?? 0) > 0) reasons.push(`قيود دفتر (${ledger?.c})`)
    const sales = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM sales WHERE customer_id = ?', [id])
    if (Number(sales?.c ?? 0) > 0) reasons.push(`فواتير بيع (${sales?.c})`)
    const trips = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM trip_sales WHERE customer_id = ?', [id])
    if (Number(trips?.c ?? 0) > 0) reasons.push(`مبيعات جولات (${trips?.c})`)
    if (reasons.length > 0) {
      throw new ApiError(`لا يمكن حذف العميل — له أثر محاسبي موثق: ${reasons.join('، ')}. استخدم «تعطيل» بدلًا من الحذف`, 409)
    }
    ctx.db.run('DELETE FROM customers WHERE id = ?', [id])
    ctx.audit('customer.delete', 'customer', id, null)
    return { id, deleted: true as const }
  })
}

/** rc.12 — تسوية يدوية موقعة على دفتر العميل (بدون نقد) */
export function customerAdjust(ctx: SvcCtx, payload: Record<string, unknown>): { balanceMinor: number } {
  const id = reqInt(payload.customerId, 'العميل', 1)
  const amountMinor = reqInt(payload.amountMinor, 'المبلغ الموقع', -1_000_000_000, 1_000_000_000)
  if (amountMinor === 0) throw new ApiError('قيمة التسوية لا يمكن أن تكون صفرًا')
  const reason = reqStr(payload.reason, 'سبب التسوية', 300)
  return ctx.db.tx(() => {
    getCustomer(ctx, { id })
    // حاجز الشهر المقفل: تسوية دفتر بتاريخ الآن
    assertMonthOpen(ctx.db, new Date())
    addCustomerLedger(ctx.db, { customerId: id, refType: 'ADJUSTMENT', amountMinor, note: reason })
    ctx.audit('customer.adjust', 'customer', id, { amountMinor, reason })
    return { balanceMinor: customerBalance(ctx.db, id) }
  })
}

// ---------- الموردون ----------
export function listSuppliers(ctx: SvcCtx, payload: Record<string, unknown>): Array<PartyRow> {
  const q = optStr(payload.q, 'بحث', 120)
  const includeInactive = payload.includeInactive === true
  const conditions: string[] = []
  const params: unknown[] = []
  if (!includeInactive) conditions.push('s.active = 1')
  if (q) {
    conditions.push('(s.name LIKE ? OR s.phone LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return ctx.db.query<PartyRow>(
    `SELECT s.id, s.name, s.phone, s.address, s.note, s.active,
            (SELECT COALESCE(SUM(l.amount_minor), 0) FROM supplier_ledger l WHERE l.supplier_id = s.id) AS balance_minor
     FROM suppliers s ${where} ORDER BY s.name LIMIT 1000`,
    params
  )
}

export function getSupplier(ctx: SvcCtx, payload: Record<string, unknown>): PartyRow {
  const id = reqInt(payload.id, 'المعرف', 1)
  const row = ctx.db.get<PartyRow>(
    `SELECT s.id, s.name, s.phone, s.address, s.note, s.active,
            (SELECT COALESCE(SUM(l.amount_minor), 0) FROM supplier_ledger l WHERE l.supplier_id = s.id) AS balance_minor
     FROM suppliers s WHERE s.id = ?`,
    [id]
  )
  if (!row) throw new ApiError('المورد غير موجود', 404)
  return row
}

export function createSupplier(ctx: SvcCtx, payload: Record<string, unknown>): PartyRow {
  const input = readPartyInput(payload)
  return ctx.db.tx(() => {
    ctx.db.run('INSERT INTO suppliers (name, phone, address, note, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [
      input.name,
      input.phone,
      input.address,
      input.note,
      ctx.db.now()
    ])
    const id = ctx.db.lastId()
    ctx.audit('supplier.create', 'supplier', id, { name: input.name })
    return getSupplier(ctx, { id })
  })
}

export function updateSupplier(ctx: SvcCtx, payload: Record<string, unknown>): PartyRow {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    // rc.12-merge: نفس إصلاح updateCustomer — التعديل الجزئي لا يعيد تنشيط مورد معطّل
    const existing = getSupplier(ctx, { id })
    const input = readPartyInput(payload)
    const active = payload.active === undefined ? Number(existing.active) : payload.active === false ? 0 : 1
    ctx.db.run('UPDATE suppliers SET name = ?, phone = ?, address = ?, note = ?, active = ? WHERE id = ?', [
      input.name,
      input.phone,
      input.address,
      input.note,
      active,
      id
    ])
    ctx.audit('supplier.update', 'supplier', id, null)
    return getSupplier(ctx, { id })
  })
}

export function supplierStatement(ctx: SvcCtx, payload: Record<string, unknown>): { supplier: PartyRow; rows: LedgerRow[]; balanceMinor: number } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const supplier = getSupplier(ctx, { id })
  // rc.12-merge: كشف المورد كان يتجاهل فلاتر الفترة from/to كليًا (بعكس كشف العميل) —
  // الآن نفس السلوك مع localtime لتوحيد التاريخ المحلي
  const conditions = ['l.supplier_id = ?']
  const params: unknown[] = [id]
  if (from) {
    conditions.push("date(l.created_at, 'localtime') >= ?")
    params.push(from)
  }
  if (to) {
    conditions.push("date(l.created_at, 'localtime') <= ?")
    params.push(to)
  }
  const rows = ctx.db.query<{ id: number; created_at: string; ref_type: string; ref_id: number | null; amount_minor: number; note: string | null }>(
    `SELECT l.id, l.created_at, l.ref_type, l.ref_id, l.amount_minor, l.note
     FROM supplier_ledger l WHERE ${conditions.join(' AND ')}
     ORDER BY l.created_at, l.id`,
    params
  )
  let running = 0
  const ledger: LedgerRow[] = rows.map((r) => {
    running += Number(r.amount_minor)
    return { ...r, amount_minor: Number(r.amount_minor), balance_minor: running }
  })
  return { supplier, rows: ledger, balanceMinor: supplierBalance(ctx.db, id) }
}

/**
 * rc.12 — طلب المالك: حذف مورد أُضيف بالخطأ.
 * حذف نهائي فقط إن لم يكن له أي أثر مالي/مشتريات — وإلا يُرفض ويُقترح التعطيل.
 */
export function deleteSupplier(ctx: SvcCtx, payload: Record<string, unknown>): { id: number; deleted: true } {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    getSupplier(ctx, { id })
    const reasons: string[] = []
    const ledger = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM supplier_ledger WHERE supplier_id = ?', [id])
    if (Number(ledger?.c ?? 0) > 0) reasons.push(`قيود دفتر (${ledger?.c})`)
    const purchases = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM purchases WHERE supplier_id = ?', [id])
    if (Number(purchases?.c ?? 0) > 0) reasons.push(`فواتير شراء (${purchases?.c})`)
    if (reasons.length > 0) {
      throw new ApiError(`لا يمكن حذف المورد — له أثر محاسبي موثق: ${reasons.join('، ')}. استخدم «تعطيل» بدلًا من الحذف`, 409)
    }
    ctx.db.run('DELETE FROM suppliers WHERE id = ?', [id])
    ctx.audit('supplier.delete', 'supplier', id, null)
    return { id, deleted: true as const }
  })
}

/** rc.12 — دفعة لمورد: تخصم من دفتره وتخرج من الصندوق */
export function supplierPayment(ctx: SvcCtx, payload: Record<string, unknown>): { balanceMinor: number } {
  const id = reqInt(payload.supplierId, 'المورد', 1)
  const amountMinor = reqMinor(payload.amountMinor, 'المبلغ')
  if (amountMinor <= 0) throw new ApiError('مبلغ الدفعة يجب أن يكون أكبر من صفر')
  const note = optStr(payload.note, 'ملاحظة', 300)
  return ctx.db.tx(() => {
    getSupplier(ctx, { id })
    // حاجز الشهر المقفل: دفعة مورد بتاريخ الآن
    assertMonthOpen(ctx.db, new Date())
    addSupplierLedger(ctx.db, { supplierId: id, refType: 'PAYMENT', amountMinor: -amountMinor, note })
    addCashMovement(ctx.db, { type: 'SUPPLIER_PAYMENT', amountMinor: -amountMinor, refType: 'supplier', refId: id, note: note ?? 'دفعة مورد' })
    ctx.audit('supplier.payment', 'supplier', id, { amountMinor })
    return { balanceMinor: supplierBalance(ctx.db, id) }
  })
}

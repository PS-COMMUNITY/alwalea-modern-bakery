// =============================================================
// مخبز الولاء الحديث — المبيعات (ذرية) + الإلغاء العكسي الموثق
// فاتورة + بنود + مدفوعات + حركات مخزون SALE− + دفتر عميل للآجل
// + حركة صندوق للنقد. clientRef يمنع الترحيل المزدوج.
// =============================================================
import { ApiError, reqStr, optStr, reqInt, reqMinor, reqMilli, reqDate, reqEnum, reqArr, obj } from '../validate'
import { lineTotalMinor, percentOfBp } from '../../shared/money'
import type { SaleRow, SaleDetail } from '../../shared/types'
import {
  SvcCtx,
  addCustomerLedger,
  addCashMovement,
  addStockMovement,
  assertStock,
  currentShiftId,
  getIntSetting,
  getBoolSetting,
  nextDocNo
} from './helpers'
import { requireProductLite } from './catalog'

interface ItemInput {
  productId: number
  qtyMilli: number
  unitPriceMinor: number | null
  discountMinor: number
}

function readItems(payload: Record<string, unknown>): ItemInput[] {
  const raw = reqArr(payload.items, 'بنود الفاتورة')
  return raw.map((r, i) => {
    const item = obj(r, `البند ${i + 1}`)
    return {
      productId: reqInt(item.productId, 'المنتج', 1),
      qtyMilli: reqMilli(item.qtyMilli, 'الكمية'),
      unitPriceMinor: item.unitPriceMinor === undefined || item.unitPriceMinor === null ? null : reqMinor(item.unitPriceMinor, 'سعر الوحدة'),
      discountMinor: item.discountMinor === undefined || item.discountMinor === null ? 0 : reqMinor(item.discountMinor, 'خصم السطر')
    }
  })
}

export function createSale(ctx: SvcCtx, payload: Record<string, unknown>): SaleDetail {
  const db = ctx.db
  const items = readItems(payload)
  const customerId = payload.customerId === undefined || payload.customerId === null ? null : reqInt(payload.customerId, 'العميل', 1)
  const invoiceDiscount = payload.discountMinor === undefined || payload.discountMinor === null ? 0 : reqMinor(payload.discountMinor, 'خصم الفاتورة')
  const note = optStr(payload.note, 'ملاحظة', 500)
  const clientRef = optStr(payload.clientRef, 'مرجع العميل', 120)
  const date = payload.date === undefined || payload.date === null ? db.today() : reqDate(payload.date, 'التاريخ')
  const paymentsRaw = payload.payments === undefined || payload.payments === null ? [] : reqArr(payload.payments, 'المدفوعات')
  const payments = paymentsRaw.map((r, i) => {
    const p = obj(r, `الدفع ${i + 1}`)
    return {
      method: reqEnum(p.method, 'طريقة الدفع', ['CASH', 'CREDIT'] as const),
      amountMinor: reqMinor(p.amountMinor, 'مبلغ الدفعة')
    }
  })

  return db.tx(() => {
    // منع الترحيل المزدوج عبر clientRef
    if (clientRef) {
      const existing = db.get<{ id: number }>('SELECT id FROM sales WHERE client_ref = ?', [clientRef])
      if (existing) return getSale(ctx, { id: Number(existing.id) })
    }

    if (customerId !== null) {
      const c = db.get('SELECT id FROM customers WHERE id = ?', [customerId])
      if (!c) throw new ApiError('العميل غير موجود', 404)
    }

    // تجميع السطور
    let subtotal = 0
    const lines = items.map((it) => {
      const product = requireProductLite(ctx, it.productId)
      const unitPrice = it.unitPriceMinor ?? Number(product.price_minor)
      if (it.discountMinor > it.qtyMilli * unitPrice) throw new ApiError(`خصم السطر أكبر من قيمته للمنتج «${product.name}»`)
      const line = lineTotalMinor(it.qtyMilli, unitPrice, it.discountMinor)
      subtotal += line
      return { ...it, product, unitPrice, line }
    })
    if (subtotal <= 0) throw new ApiError('إجمالي الفاتورة يجب أن يكون أكبر من صفر')
    if (invoiceDiscount > subtotal) throw new ApiError('خصم الفاتورة أكبر من الإجمالي')
    const base = subtotal - invoiceDiscount
    const taxBp = getBoolSetting(db, 'tax_enabled', false) ? getIntSetting(db, 'tax_bp', 0) : 0
    const tax = taxBp > 0 ? percentOfBp(base, taxBp) : 0
    const total = base + tax

    const paid = payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amountMinor, 0)
    const creditPayments = payments.filter((p) => p.method === 'CREDIT').reduce((s, p) => s + p.amountMinor, 0)
    if (payments.some((p) => p.amountMinor <= 0)) throw new ApiError('مبالغ الدفع يجب أن تكون أكبر من صفر')
    let credit = total - paid - creditPayments
    if (credit < 0) throw new ApiError('المبلغ المدفوع أكبر من إجمالي الفاتورة')
    const cashPortion = paid
    if (credit > 0 && customerId === null) throw new ApiError('البيع الآجل يتطلب تحديد العميل')

    const status = credit === 0 ? 'PAID' : paid + creditPayments > 0 ? 'PARTIAL' : 'CREDIT'

    // تحقق المخزون قبل الكتابة
    for (const line of lines) {
      if (Number(line.product.track_stock) === 1) {
        assertStock(db, line.product.id, -line.qtyMilli, line.product.name)
      }
    }

    const invoiceNo = nextDocNo(db, 'S', date)
    const shiftId = currentShiftId(db)
    db.run(
      `INSERT INTO sales (invoice_no, date, customer_id, subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, credit_minor, status, source, client_ref, note, shift_id, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POS', ?, ?, ?, ?, ?)`,
      [invoiceNo, date, customerId, subtotal, invoiceDiscount, tax, total, paid + creditPayments, credit, status, clientRef, note, shiftId, ctx.user?.id ?? null, db.now()]
    )
    const saleId = db.lastId()

    for (const line of lines) {
      db.run(
        `INSERT INTO sale_items (sale_id, product_id, qty_milli, unit_price_minor, discount_minor, line_total_minor)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [saleId, line.product.id, line.qtyMilli, line.unitPrice, line.discountMinor, line.line]
      )
      if (Number(line.product.track_stock) === 1) {
        addStockMovement(db, {
          productId: line.product.id,
          qtyMilli: -line.qtyMilli,
          type: 'SALE',
          refType: 'sale',
          refId: saleId,
          note: invoiceNo,
          date,
          userId: ctx.user?.id ?? null
        })
      }
    }

    for (const p of payments) {
      db.run('INSERT INTO sale_payments (sale_id, method, amount_minor, shift_id, created_at) VALUES (?, ?, ?, ?, ?)', [
        saleId,
        p.method,
        p.amountMinor,
        shiftId,
        db.now()
      ])
      if (p.method === 'CASH') {
        addCashMovement(db, { type: 'SALE', amountMinor: p.amountMinor, refType: 'sale', refId: saleId, note: invoiceNo, date, userId: ctx.user?.id ?? null })
      }
    }

    if (credit > 0 && customerId !== null) {
      addCustomerLedger(db, { customerId, refType: 'SALE', refId: saleId, amountMinor: credit, note: `آجل فاتورة ${invoiceNo}` })
    }

    ctx.audit('sale.create', 'sale', saleId, { invoiceNo, total, paid: cashPortion, credit })

    return getSale(ctx, { id: saleId })
  })
}

export function listSales(ctx: SvcCtx, payload: Record<string, unknown>): SaleRow[] {
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const status = optStr(payload.status, 'الحالة', 20)
  const q = optStr(payload.q, 'بحث', 60)
  const conditions: string[] = []
  const params: unknown[] = []
  if (from) {
    conditions.push('s.date >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('s.date <= ?')
    params.push(to)
  }
  if (status) {
    conditions.push('s.status = ?')
    params.push(status)
  }
  if (q) {
    conditions.push('s.invoice_no LIKE ?')
    params.push(`%${q}%`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return ctx.db.query<SaleRow>(
    `SELECT s.id, s.invoice_no, s.date, s.customer_id, c.name AS customer_name, s.total_minor, s.paid_minor, s.credit_minor, s.status, s.source, s.created_at
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     ${where} ORDER BY s.id DESC LIMIT 300`,
    params
  )
}

export function getSale(ctx: SvcCtx, payload: Record<string, unknown>): SaleDetail {
  const id = reqInt(payload.id, 'المعرف', 1)
  const sale = ctx.db.get<
    SaleRow & { subtotal_minor: number; discount_minor: number; tax_minor: number; note: string | null }
  >(
    `SELECT s.id, s.invoice_no, s.date, s.customer_id, c.name AS customer_name, s.subtotal_minor, s.discount_minor, s.tax_minor,
            s.total_minor, s.paid_minor, s.credit_minor, s.status, s.source, s.note, s.created_at, s.cancelled_at, s.cancel_reason
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`,
    [id]
  )
  if (!sale) throw new ApiError('الفاتورة غير موجودة', 404)
  const items = ctx.db.query<{
    id: number
    product_id: number
    product_name: string
    qty_milli: number
    unit_price_minor: number
    discount_minor: number
    line_total_minor: number
  }>(
    `SELECT si.id, si.product_id, p.name AS product_name, si.qty_milli, si.unit_price_minor, si.discount_minor, si.line_total_minor
     FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id`,
    [id]
  )
  const payments = ctx.db.query<{ id: number; method: string; amount_minor: number }>(
    'SELECT id, method, amount_minor FROM sale_payments WHERE sale_id = ? ORDER BY id',
    [id]
  )
  return {
    ...sale,
    subtotal_minor: Number(sale.subtotal_minor),
    discount_minor: Number(sale.discount_minor),
    tax_minor: Number(sale.tax_minor),
    total_minor: Number(sale.total_minor),
    paid_minor: Number(sale.paid_minor),
    credit_minor: Number(sale.credit_minor),
    items: items.map((i) => ({ ...i, qty_milli: Number(i.qty_milli) })),
    payments: payments.map((p) => ({ ...p, amount_minor: Number(p.amount_minor) }))
  }
}

/** إلغاء موثق: حركات عكسية — لا حذف */
export function cancelSale(ctx: SvcCtx, payload: Record<string, unknown>): SaleDetail {
  const id = reqInt(payload.id, 'المعرف', 1)
  const reason = reqStr(payload.reason, 'سبب الإلغاء', 300)
  return ctx.db.tx(() => {
    const sale = getSale(ctx, { id })
    if (sale.status === 'CANCELLED') throw new ApiError('الفاتورة ملغاة مسبقًا', 409)

    for (const item of sale.items) {
      const product = requireProductLite(ctx, item.product_id)
      if (Number(product.track_stock) === 1) {
        // إرجاع الكمية للمخزون بحركة عكسية موثقة
        addStockMovement(ctx.db, {
          productId: item.product_id,
          qtyMilli: item.qty_milli, // موجب = إرجاع
          type: 'SALE_RETURN',
          refType: 'sale_cancel',
          refId: id,
          note: `إلغاء ${sale.invoice_no}: ${reason}`,
          userId: ctx.user?.id ?? null
        })
      }
    }

    if (sale.credit_minor > 0 && sale.customer_id !== null) {
      addCustomerLedger(ctx.db, {
        customerId: sale.customer_id,
        refType: 'SALE_CANCEL',
        refId: id,
        amountMinor: -sale.credit_minor,
        note: `إلغاء آجل ${sale.invoice_no}`
      })
    }

    if (sale.paid_minor > 0) {
      addCashMovement(ctx.db, {
        type: 'ADJUSTMENT',
        amountMinor: -sale.paid_minor,
        refType: 'sale_cancel',
        refId: id,
        note: `رد نقدي إلغاء ${sale.invoice_no}: ${reason}`,
        userId: ctx.user?.id ?? null
      })
    }

    ctx.db.run('UPDATE sales SET status = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?', [
      'CANCELLED',
      ctx.db.now(),
      reason,
      id
    ])
    ctx.audit('sale.cancel', 'sale', id, { invoiceNo: sale.invoice_no, reason })
    return getSale(ctx, { id })
  })
}

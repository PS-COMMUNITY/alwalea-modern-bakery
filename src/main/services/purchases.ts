// =============================================================
// مخبز الولاء الحديث — المشتريات (ذرية) + إلغاء عكسي + دفعات موردين
// دخول مخزون PURCHASE+ + دفتر مورد + تكلفة متوسط مرجح + حركة صندوق للمدفوع
// =============================================================
import { ApiError, reqStr, optStr, reqInt, reqMinor, reqMilli, reqDate, reqArr, obj } from '../validate'
import { lineTotalMinor } from '../../shared/money'
import {
  SvcCtx,
  addSupplierLedger,
  addCashMovement,
  addStockMovement,
  nextDocNo,
  currentShiftId
} from './helpers'
import { assertMonthOpen } from './period'

interface PurchaseLine {
  productId: number
  qtyMilli: number
  unitCostMinor: number
  line: number
}

function readItems(payload: Record<string, unknown>): Array<{ productId: number; qtyMilli: number; unitCostMinor: number }> {
  const raw = reqArr(payload.items, 'بنود الفاتورة')
  return raw.map((r, i) => {
    const item = obj(r, `البند ${i + 1}`)
    return {
      productId: reqInt(item.productId, 'المنتج', 1),
      qtyMilli: reqMilli(item.qtyMilli, 'الكمية'),
      unitCostMinor: reqMinor(item.unitCostMinor, 'تكلفة الوحدة')
    }
  })
}

export function createPurchase(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const db = ctx.db
  const supplierId = reqInt(payload.supplierId, 'المورد', 1)
  const items = readItems(payload)
  const discount = payload.discountMinor === undefined || payload.discountMinor === null ? 0 : reqMinor(payload.discountMinor, 'الخصم')
  const paidMinor = payload.paidMinor === undefined || payload.paidMinor === null ? 0 : reqMinor(payload.paidMinor, 'المدفوع')
  const note = optStr(payload.note, 'ملاحظة', 500)
  const clientRef = optStr(payload.clientRef, 'مرجع المستند', 120)
  const date = payload.date === undefined || payload.date === null ? db.today() : reqDate(payload.date, 'التاريخ')

  return db.tx(() => {
    if (clientRef) {
      const existing = db.get<{ id: number }>('SELECT id FROM purchases WHERE client_ref = ?', [clientRef])
      if (existing) return getPurchase(ctx, { id: Number(existing.id) })
    }
    // حاجز الشهر المقفل: بتاريخ الفاتورة — بعد فحص clientRef وقبل المعالجة
    assertMonthOpen(db, date)
    const supplier = db.get('SELECT id, name FROM suppliers WHERE id = ?', [supplierId])
    if (!supplier) throw new ApiError('المورد غير موجود', 404)

    let subtotal = 0
    const lines: PurchaseLine[] = items.map((it) => {
      const product = db.get<{ id: number; name: string; track_stock: number }>('SELECT id, name, track_stock FROM products WHERE id = ?', [it.productId])
      if (!product) throw new ApiError('المنتج غير موجود', 404)
      const line = lineTotalMinor(it.qtyMilli, it.unitCostMinor)
      subtotal += line
      return { ...it, line }
    })
    if (subtotal <= 0) throw new ApiError('إجمالي الفاتورة يجب أن يكون أكبر من صفر')
    if (discount > subtotal) throw new ApiError('الخصم أكبر من الإجمالي')
    const total = subtotal - discount
    if (paidMinor > total) throw new ApiError('المدفوع أكبر من الإجمالي')
    const credit = total - paidMinor
    const status = credit === 0 ? 'PAID' : paidMinor > 0 ? 'PARTIAL' : 'CREDIT'

    const invoiceNo = nextDocNo(db, 'P', date)

    // متوسط مرجح للتكلفة: نحتاج الرصيد الحالي والتكلفة قبل الإدخال
    const costSnapshots = lines.map((l) => {
      const p = db.get<{ balance: number; cost: number }>(
        `SELECT (SELECT COALESCE(SUM(qty_milli),0) FROM stock_movements WHERE product_id = ?) AS balance,
                (SELECT cost_minor FROM products WHERE id = ?) AS cost`,
        [l.productId, l.productId]
      )
      return { productId: l.productId, balance: Number(p?.balance ?? 0), cost: Number(p?.cost ?? 0) }
    })

    db.run(
      `INSERT INTO purchases (invoice_no, date, supplier_id, subtotal_minor, discount_minor, total_minor, paid_minor, status, client_ref, note, prev_cost_minor, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceNo, date, supplierId, subtotal, discount, total, paidMinor, status, clientRef, note, null, ctx.user?.id ?? null, db.now()]
    )
    const purchaseId = db.lastId()

    lines.forEach((l, idx) => {
      db.run(
        `INSERT INTO purchase_items (purchase_id, product_id, qty_milli, unit_cost_minor, line_total_minor) VALUES (?, ?, ?, ?, ?)`,
        [purchaseId, l.productId, l.qtyMilli, l.unitCostMinor, l.line]
      )
      const snap = costSnapshots[idx]
      if (!snap) throw new ApiError('خطأ داخلي: لقطة التكلفة مفقودة')
      // تحديث تكلفة المنتج بالمتوسط المرجح (بناءً على الرصيد قبل الإدخال)
      if (snap.balance + l.qtyMilli > 0) {
        const newCost = Math.round((snap.balance * snap.cost + l.qtyMilli * l.unitCostMinor) / (snap.balance + l.qtyMilli))
        db.run('UPDATE products SET cost_minor = ?, updated_at = ? WHERE id = ?', [newCost, db.now(), l.productId])
      }
      addStockMovement(db, {
        productId: l.productId,
        qtyMilli: l.qtyMilli,
        type: 'PURCHASE',
        refType: 'purchase',
        refId: purchaseId,
        unitCostMinor: l.unitCostMinor,
        note: invoiceNo,
        date,
        userId: ctx.user?.id ?? null
      })
    })

    addSupplierLedger(db, { supplierId, refType: 'PURCHASE', refId: purchaseId, amountMinor: total, note: `فاتورة شراء ${invoiceNo}` })
    if (paidMinor > 0) {
      db.run('INSERT INTO purchase_payments (purchase_id, method, amount_minor, created_at) VALUES (?, ?, ?, ?)', [
        purchaseId,
        'CASH',
        paidMinor,
        db.now()
      ])
      addSupplierLedger(db, { supplierId, refType: 'PAYMENT', refId: purchaseId, amountMinor: -paidMinor, note: `دفعة مع الفاتورة ${invoiceNo}` })
      addCashMovement(db, {
        type: 'PURCHASE',
        amountMinor: -paidMinor,
        refType: 'purchase',
        refId: purchaseId,
        note: `دفع فاتورة شراء ${invoiceNo}`,
        date,
        userId: ctx.user?.id ?? null,
        shiftId: currentShiftId(db)
      })
    }

    ctx.audit('purchase.create', 'purchase', purchaseId, { invoiceNo, total, paidMinor, credit })
    return getPurchase(ctx, { id: purchaseId })
  })
}

export function listPurchases(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const conditions: string[] = []
  const params: unknown[] = []
  if (from) {
    conditions.push('p.date >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('p.date <= ?')
    params.push(to)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return ctx.db.query(
    `SELECT p.id, p.invoice_no, p.date, p.supplier_id, s.name AS supplier_name, p.subtotal_minor, p.discount_minor,
            p.total_minor, p.paid_minor, p.status, p.created_at
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id ${where} ORDER BY p.id DESC LIMIT 300`,
    params
  )
}

export function getPurchase(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const id = reqInt(payload.id, 'المعرف', 1)
  const p = ctx.db.get<Record<string, number | string | null>>(
    `SELECT p.id, p.invoice_no, p.date, p.supplier_id, s.name AS supplier_name, p.subtotal_minor, p.discount_minor,
            p.total_minor, p.paid_minor, p.status, p.note, p.created_at, p.cancelled_at, p.cancel_reason
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`,
    [id]
  )
  if (!p) throw new ApiError('فاتورة الشراء غير موجودة', 404)
  const items = ctx.db.query(
    `SELECT pi.id, pi.product_id, pr.name AS product_name, pi.qty_milli, pi.unit_cost_minor, pi.line_total_minor
     FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id`,
    [id]
  )
  const payments = ctx.db.query('SELECT id, method, amount_minor FROM purchase_payments WHERE purchase_id = ? ORDER BY id', [id])
  return { ...p, items, payments }
}

export function cancelPurchase(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const id = reqInt(payload.id, 'المعرف', 1)
  const reason = reqStr(payload.reason, 'سبب الإلغاء', 300)
  return ctx.db.tx(() => {
    const p = getPurchase(ctx, { id }) as {
      id: number
      invoice_no: string
      date: string
      status: string
      total_minor: number
      paid_minor: number
      supplier_id: number
      items: Array<{ product_id: number; qty_milli: number; unit_cost_minor: number }>
    }
    if (p.status === 'CANCELLED') throw new ApiError('فاتورة الشراء ملغاة مسبقًا', 409)
    // حاجز الشهر المقفل: بتاريخ الفاتورة الأصلية — بعد جلب السجل وقبل أي كتابة
    assertMonthOpen(ctx.db, p.date)

    // تحقق إمكانية الإرجاع (لا مخزون سالب عند الإلغاء)
    for (const item of p.items) {
      const balance = Number(ctx.db.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE product_id = ?', [item.product_id])?.s ?? 0)
      if (balance < item.qty_milli) {
        throw new ApiError('لا يمكن الإلغاء: الكمية المستهلكة من المخزون أكبر من المتاح للإرجاع')
      }
    }

    for (const item of p.items) {
      addStockMovement(ctx.db, {
        productId: item.product_id,
        qtyMilli: -item.qty_milli,
        type: 'PURCHASE_RETURN',
        refType: 'purchase_cancel',
        refId: id,
        unitCostMinor: item.unit_cost_minor,
        note: `إلغاء ${p.invoice_no}: ${reason}`,
        userId: ctx.user?.id ?? null
      })
    }

    addSupplierLedger(ctx.db, { supplierId: Number(p.supplier_id), refType: 'PURCHASE_CANCEL', refId: id, amountMinor: -Number(p.total_minor), note: `إلغاء فاتورة ${p.invoice_no}` })
    if (Number(p.paid_minor) > 0) {
      addCashMovement(ctx.db, {
        type: 'ADJUSTMENT',
        amountMinor: Number(p.paid_minor),
        refType: 'purchase_cancel',
        refId: id,
        note: `استرداد دفع إلغاء شراء ${p.invoice_no}: ${reason}`,
        userId: ctx.user?.id ?? null
      })
    }
    ctx.db.run('UPDATE purchases SET status = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?', ['CANCELLED', ctx.db.now(), reason, id])
    ctx.audit('purchase.cancel', 'purchase', id, { invoiceNo: p.invoice_no, reason })
    return getPurchase(ctx, { id })
  })
}

/** دفعة للمورد منسدلة على حسابه (لا ترتبط بفاتورة محددة) */
export function paySupplierViaPurchase(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const supplierId = reqInt(payload.supplierId, 'المورد', 1)
  const amountMinor = reqMinor(payload.amountMinor, 'المبلغ')
  if (amountMinor <= 0) throw new ApiError('مبلغ الدفعة يجب أن يكون أكبر من صفر')
  const note = optStr(payload.note, 'ملاحظة', 300)
  return ctx.db.tx(() => {
    const s = ctx.db.get('SELECT id FROM suppliers WHERE id = ?', [supplierId])
    if (!s) throw new ApiError('المورد غير موجود', 404)
    // حاجز الشهر المقفل: دفعة بتاريخ الآن
    assertMonthOpen(ctx.db, new Date())
    addSupplierLedger(ctx.db, { supplierId, refType: 'PAYMENT', amountMinor: -amountMinor, note })
    addCashMovement(ctx.db, { type: 'SUPPLIER_PAYMENT', amountMinor: -amountMinor, refType: 'supplier', refId: supplierId, note: note ?? 'دفعة مورد' })
    ctx.audit('supplier.payment', 'supplier', supplierId, { amountMinor })
    return { done: true }
  })
}

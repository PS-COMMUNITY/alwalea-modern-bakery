import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { lineTotalMinor, fromMinor } from '@/lib/bakery/money'
import { PAY_METHODS, posInt, resolveRange, pagination, nextNumberTx } from '../_lib/bakery'

export const dynamic = 'force-dynamic'

/** GET /api/purchases — قائمة فواتير الشراء مع فلاتر وترقيم صفحات (مصادقة فقط) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const url = new URL(req.url)

    const range = resolveRange(url)
    if (range.error) return fail(400, range.error)

    const where: Record<string, unknown> = {}
    if (range.from || range.to) {
      where.date = {}
      if (range.from) (where.date as Record<string, Date>).gte = range.from
      if (range.to) (where.date as Record<string, Date>).lte = range.to
    }
    const q = str(url.searchParams.get('q') ?? '', 100)
    if (q) where.OR = [{ invoiceNo: { contains: q } }, { supplierName: { contains: q } }]
    const status = url.searchParams.get('status')
    if (status) {
      if (status !== 'COMPLETED' && status !== 'CANCELLED') return fail(400, 'حالة الفاتورة غير صالحة (COMPLETED أو CANCELLED)')
      where.status = status
    }
    const supplierId = str(url.searchParams.get('supplierId') ?? '', 50)
    if (supplierId) where.supplierId = supplierId

    const { page, pageSize, skip, take } = pagination(url)
    const [rows, total] = await Promise.all([
      db.purchase.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        include: { _count: { select: { items: true } } },
      }),
      db.purchase.count({ where }),
    ])

    return ok({ items: rows, total, page, pageSize })
  })
}

/**
 * POST /api/purchases — ترحيل فاتورة شراء (perm: purchases.manage)
 * ذرّية كاملة: بنود + دخول مخزون + تحديث التكلفة بمتوسط مرجح + دفتر المورد + المدفوعات والصندوق.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'purchases.manage')
    if ('response' in r) return r.response
    const user = r.user
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    // ===== منع الترحيل المزدوج عبر clientRef =====
    const clientRef = str(body.clientRef, 100)
    if (clientRef) {
      const existing = await db.purchase.findUnique({ where: { clientRef }, include: { items: true, payments: true } })
      if (existing) return ok(existing)
    }

    // ===== المورد =====
    const supplierId = str(body.supplierId, 50)
    if (!supplierId) return fail(400, 'تحديد المورد مطلوب')
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } })
    if (!supplier) return fail(404, 'المورد غير موجود')

    // ===== البنود =====
    if (!Array.isArray(body.items)) return fail(400, 'بنود الفاتورة مطلوبة')
    if (body.items.length === 0) return fail(400, 'يجب إضافة بند واحد على الأقل')

    const productIds: string[] = []
    for (const raw of body.items) {
      const pid = str(raw?.productId, 50)
      if (!pid) return fail(400, 'معرف المنتج مطلوب في كل بند')
      productIds.push(pid)
    }
    const products = await db.product.findMany({ where: { id: { in: productIds } } })
    const productMap = new Map(products.map(p => [p.id, p]))

    let subtotal = 0
    const lines: { productId: string; productName: string; qtyMilli: number; costMinor: number; lineTotal: number }[] = []
    for (const raw of body.items) {
      const pid = str(raw.productId, 50)!
      const p = productMap.get(pid)
      if (!p) return fail(404, 'المنتج غير موجود')
      if (!p.active) return fail(400, `المنتج "${p.name}" غير مفعّل`)

      const qty = posInt(raw.qtyMilli)
      if (qty === null) return fail(400, `الكمية غير صالحة للمنتج "${p.name}" (عدد صحيح أكبر من صفر بوحدة الألفية)`)

      const cost = int(raw.costMinor)
      if (cost === null) return fail(400, `تكلفة الوحدة مطلوبة ويجب أن تكون عددًا صحيحًا ≥ 0 للمنتج "${p.name}"`)

      const lineTotal = lineTotalMinor(qty, cost)
      subtotal += lineTotal
      lines.push({ productId: p.id, productName: p.name, qtyMilli: qty, costMinor: cost, lineTotal })
    }

    // ===== خصم الفاتورة =====
    let discount = 0
    if (body.discountMinor !== undefined && body.discountMinor !== null) {
      const d = int(body.discountMinor)
      if (d === null) return fail(400, 'خصم الفاتورة يجب أن يكون عددًا صحيحًا ≥ 0')
      discount = d
    }
    if (discount > subtotal) return fail(400, 'خصم الفاتورة أكبر من مجموع البنود')

    const total = subtotal - discount

    // ===== المدفوعات =====
    const paymentsRaw = Array.isArray(body.payments) ? body.payments : []
    const payments: { method: string; amountMinor: number }[] = []
    let paid = 0
    for (const p of paymentsRaw) {
      const amount = posInt(p?.amountMinor)
      if (amount === null) return fail(400, 'مبلغ الدفعة يجب أن يكون عددًا صحيحًا أكبر من صفر')
      if (!PAY_METHODS.includes(p.method)) return fail(400, 'طريقة الدفع غير صالحة (CASH أو CARD أو TRANSFER أو CHEQUE)')
      paid += amount
      payments.push({ method: p.method, amountMinor: amount })
    }
    if (paid > total) return fail(409, 'المدفوع أكبر من الإجمالي')

    const note = str(body.note, 500)
    const bodyShiftId = str(body.shiftId, 50)

    // ===== المعاملة التفاعلية الواحدة =====
    const response = await db.$transaction(
      async tx => {
        const invoiceNo = await nextNumberTx(tx, 'P')

        // الوردية المفتوحة بهذا المعرف (للنقد فقط)
        let openShiftId: string | undefined
        if (bodyShiftId) {
          const openShift = await tx.shift.findFirst({ where: { id: bodyShiftId, status: 'OPEN' } })
          openShiftId = openShift?.id
        }

        const purchase = await tx.purchase.create({
          data: {
            invoiceNo,
            supplierId: supplier.id,
            supplierName: supplier.name,
            subtotalMinor: subtotal,
            discountMinor: discount,
            totalMinor: total,
            paidMinor: paid,
            paymentStatus: paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID',
            status: 'COMPLETED',
            clientRef: clientRef ?? undefined,
            shiftId: bodyShiftId ?? undefined,
            note: note ?? undefined,
            userId: user.id,
          },
        })

        // تتبع التكلفة الجارية لكل منتج (للبنود المكررة)
        const runningCost = new Map<string, number>(products.map(p => [p.id, p.costMinor]))

        for (const l of lines) {
          await tx.purchaseItem.create({
            data: {
              purchaseId: purchase.id,
              productId: l.productId,
              productName: l.productName,
              qtyMilli: l.qtyMilli,
              costMinor: l.costMinor,
              lineTotalMinor: l.lineTotal,
            },
          })

          await tx.stockMovement.create({
            data: {
              productId: l.productId,
              qtyMilli: l.qtyMilli,
              type: 'PURCHASE',
              refType: 'Purchase',
              refId: purchase.id,
              unitCostMinor: l.costMinor,
              userId: user.id,
            },
          })

          // تحديث تكلفة المنتج بمتوسط مرجح
          const agg = await tx.stockMovement.aggregate({ where: { productId: l.productId }, _sum: { qtyMilli: true } })
          const oldQty = (agg._sum.qtyMilli ?? 0) - l.qtyMilli // الرصيد قبل هذه الحركة
          const oldCost = runningCost.get(l.productId) ?? 0
          const newCost = oldQty > 0 ? Math.round((oldQty * oldCost + l.qtyMilli * l.costMinor) / (oldQty + l.qtyMilli)) : l.costMinor
          await tx.product.update({ where: { id: l.productId }, data: { costMinor: newCost } })
          runningCost.set(l.productId, newCost)
        }

        // قيد دفتر المورد: الفاتورة تزيد المستحقات
        await tx.supplierLedgerEntry.create({
          data: {
            supplierId: supplier.id,
            type: 'INVOICE',
            amountMinor: total,
            refType: 'Purchase',
            refId: purchase.id,
            userId: user.id,
          },
        })

        // المدفوعات: قيد دفتر + صندوق إن نقدًا
        for (const p of payments) {
          const pp = await tx.purchasePayment.create({
            data: {
              purchaseId: purchase.id,
              supplierId: supplier.id,
              method: p.method,
              amountMinor: p.amountMinor,
              shiftId: p.method === 'CASH' && openShiftId ? openShiftId : undefined,
              userId: user.id,
            },
          })
          await tx.supplierLedgerEntry.create({
            data: {
              supplierId: supplier.id,
              type: 'PAYMENT',
              amountMinor: -p.amountMinor,
              refType: 'PurchasePayment',
              refId: pp.id,
              userId: user.id,
            },
          })
          if (p.method === 'CASH' && openShiftId) {
            await tx.cashMovement.create({
              data: {
                shiftId: openShiftId,
                type: 'PURCHASE_PAYMENT',
                amountMinor: -p.amountMinor,
                refType: 'PurchasePayment',
                refId: pp.id,
                userId: user.id,
              },
            })
          }
        }

        const full = await tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { items: true, payments: true } })
        return { full, purchaseId: purchase.id, invoiceNo }
      },
      { isolationLevel: 'Serializable' }
    )

    // رد خطأ من داخل المعاملة (لم يتم إنشاء شيء)
    if (response instanceof NextResponse) return response

    await audit({
      userId: user.id,
      username: user.username,
      action: 'PURCHASE',
      entityType: 'Purchase',
      entityId: response.purchaseId,
      details: { invoiceNo: response.invoiceNo, totalMinor: total, paidMinor: paid, supplierName: supplier.name },
    })

    return ok(response.full)
  })
}

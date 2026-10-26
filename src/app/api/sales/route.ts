import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'
import { audit, getSettings, customerDebtMinor } from '@/lib/bakery/core'
import { hasPerm } from '@/lib/bakery/permissions'
import { lineTotalMinor, percentOfBp, fromMinor, fromMilli } from '@/lib/bakery/money'
import { PAY_METHODS, posInt, resolveRange, pagination, nextNumberTx, stockOfTx } from '../_lib/bakery'
import { assertMonthOpen } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

/** GET /api/sales — قائمة فواتير البيع مع فلاتر وترقيم صفحات (مصادقة فقط) */
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
    if (q) where.OR = [{ invoiceNo: { contains: q } }, { customerName: { contains: q } }]
    const status = url.searchParams.get('status')
    if (status) {
      if (status !== 'COMPLETED' && status !== 'CANCELLED') return fail(400, 'حالة الفاتورة غير صالحة (COMPLETED أو CANCELLED)')
      where.status = status
    }
    const customerId = str(url.searchParams.get('customerId') ?? '', 50)
    if (customerId) where.customerId = customerId

    const { page, pageSize, skip, take } = pagination(url)
    const [rows, total] = await Promise.all([
      db.sale.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        include: { _count: { select: { items: true } } },
      }),
      db.sale.count({ where }),
    ])

    return ok({ items: rows, total, page, pageSize })
  })
}

/**
 * POST /api/sales — ترحيل فاتورة بيع (perm: pos.use)
 * ذرّية كاملة: تحقق بنود/مخزون/ائتمان ثم Sale + Items + StockMovements + دفتر العميل + الصندوق.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'pos.use')
    if ('response' in r) return r.response
    const user = r.user
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    // ===== منع الترحيل المزدوج عبر clientRef =====
    const clientRef = str(body.clientRef, 100)
    if (clientRef) {
      const existing = await db.sale.findUnique({ where: { clientRef }, include: { items: true, payments: true } })
      if (existing) return ok(existing)
    }

    // حاجز الشهر المقفل: فاتورة جديدة بتاريخ الآن
    await assertMonthOpen(new Date())

    // ===== البنود =====
    if (!Array.isArray(body.items)) return fail(400, 'بنود الفاتورة مطلوبة')
    if (body.items.length === 0) return fail(400, 'يجب إضافة بند واحد على الأقل')

    const settings = await getSettings()
    const customer = body.customerId ? await db.customer.findUnique({ where: { id: str(body.customerId, 50) ?? '' } }) : null
    if (body.customerId && !customer) return fail(404, 'العميل غير موجود')

    // جلب المنتجات دفعة واحدة
    const productIds: string[] = []
    for (const raw of body.items) {
      const pid = str(raw?.productId, 50)
      if (!pid) return fail(400, 'معرف المنتج مطلوب في كل بند')
      productIds.push(pid)
    }
    const products = await db.product.findMany({ where: { id: { in: productIds } } })
    const productMap = new Map(products.map(p => [p.id, p]))

    let subtotal = 0
    const lines: { productId: string; productName: string; qtyMilli: number; priceMinor: number; discountMinor: number; lineTotal: number; costMinor: number; trackStock: boolean }[] = []
    for (const raw of body.items) {
      const pid = str(raw.productId, 50)!
      const p = productMap.get(pid)
      if (!p) return fail(404, 'المنتج غير موجود')
      if (!p.active) return fail(400, `المنتج "${p.name}" غير مفعّل`)

      const qty = posInt(raw.qtyMilli)
      if (qty === null) return fail(400, `الكمية غير صالحة للمنتج "${p.name}" (عدد صحيح أكبر من صفر بوحدة الألفية)`)

      let price: number
      if (raw.priceMinor !== undefined && raw.priceMinor !== null) {
        const custom = int(raw.priceMinor)
        if (custom === null) return fail(400, `السعر غير صالح للمنتج "${p.name}"`)
        price = custom
      } else {
        price = customer?.defaultPriceType === 'WHOLESALE' && p.wholesalePriceMinor !== null && p.wholesalePriceMinor !== undefined
          ? p.wholesalePriceMinor
          : p.priceMinor
      }

      let lineDisc = 0
      if (raw.discountMinor !== undefined && raw.discountMinor !== null) {
        const d = int(raw.discountMinor)
        if (d === null) return fail(400, `خصم السطر غير صالح للمنتج "${p.name}"`)
        lineDisc = d
      }

      const lineTotal = lineTotalMinor(qty, price, lineDisc)
      subtotal += lineTotal
      lines.push({ productId: p.id, productName: p.name, qtyMilli: qty, priceMinor: price, discountMinor: lineDisc, lineTotal, costMinor: p.costMinor, trackStock: p.trackStock })
    }

    // ===== خصم الفاتورة =====
    let discount = 0
    if (body.discountMinor !== undefined && body.discountMinor !== null) {
      const d = int(body.discountMinor)
      if (d === null) return fail(400, 'خصم الفاتورة يجب أن يكون عددًا صحيحًا ≥ 0')
      discount = d
    }
    if (discount > 0 && !hasPerm(user.role, 'sales.discount')) {
      return fail(403, 'ليس لديك صلاحية لمنح خصم على الفاتورة')
    }
    if (discount > subtotal) return fail(400, 'خصم الفاتورة أكبر من مجموع البنود')

    // ===== الضريبة والإجمالي =====
    const tax = settings.taxEnabled ? percentOfBp(subtotal - discount, settings.taxRateBp) : 0
    const total = subtotal - discount + tax

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

    const creditMinor = total - paid
    if (creditMinor < 0) return fail(409, 'المدفوع أكبر من الإجمالي')

    // ===== البيع الآجل =====
    if (creditMinor > 0 && settings.requireCustomerForCredit && !customer) {
      return fail(409, 'البيع الآجل يتطلب تحديد العميل')
    }
    if (customer && creditMinor > 0 && customer.creditLimitMinor !== null && customer.creditLimitMinor !== undefined) {
      const debt = await customerDebtMinor(customer.id)
      if (debt + creditMinor > customer.creditLimitMinor) {
        return fail(409, `تجاوز حد الائتمان للعميل "${customer.name}" — الحد: ${fromMinor(customer.creditLimitMinor)}، الدين الحالي: ${fromMinor(debt)}، الآجل المطلوب: ${fromMinor(creditMinor)}`)
      }
    }

    const note = str(body.note, 500)
    const bodyShiftId = str(body.shiftId, 50)

    // ===== المعاملة التفاعلية الواحدة =====
    const response = await db.$transaction(
      async tx => {
        // فحص المخزون داخل المعاملة
        const qtyByProduct = new Map<string, number>()
        for (const l of lines) {
          if (!l.trackStock) continue
          qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) ?? 0) + l.qtyMilli)
        }
        const negativeAllowedNames: string[] = []
        for (const [pid, qty] of qtyByProduct) {
          const balance = await stockOfTx(tx, pid)
          if (balance - qty < 0) {
            if (!settings.negativeStockAllowed) {
              const p = productMap.get(pid)!
              return fail(409, `الرصيد غير كافٍ للمنتج "${p.name}" (المتاح: ${fromMilli(balance)})`)
            }
            negativeAllowedNames.push(productMap.get(pid)!.name)
          }
        }

        const invoiceNo = await nextNumberTx(tx, 'S')

        // الوردية المفتوحة: بالمعرف المرسل إن وجد، وإلا أحدث وردية مفتوحة
        // (توحيد مع مسار تحصيل العملاء — كي لا تفوت مبيعات نقدية من الصندوق إن لم يرسل الوجهة shiftId)
        let openShiftId: string | undefined
        const openShift = bodyShiftId
          ? await tx.shift.findFirst({ where: { id: bodyShiftId, status: 'OPEN' } })
          : await tx.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } })
        openShiftId = openShift?.id

        const sale = await tx.sale.create({
          data: {
            invoiceNo,
            customerId: customer?.id,
            customerName: customer?.name ?? 'عميل نقدي',
            source: 'POS',
            subtotalMinor: subtotal,
            discountMinor: discount,
            taxMinor: tax,
            totalMinor: total,
            paidMinor: paid,
            creditMinor,
            paymentStatus: paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID',
            status: 'COMPLETED',
            clientRef: clientRef ?? undefined,
            shiftId: bodyShiftId ?? undefined,
            note: note ?? undefined,
            userId: user.id,
          },
        })

        for (const l of lines) {
          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: l.productId,
              productName: l.productName,
              qtyMilli: l.qtyMilli,
              priceMinor: l.priceMinor,
              discountMinor: l.discountMinor,
              costMinor: l.costMinor,
              lineTotalMinor: l.lineTotal,
            },
          })
          const wentNegative = negativeAllowedNames.includes(l.productName)
          await tx.stockMovement.create({
            data: {
              productId: l.productId,
              qtyMilli: -l.qtyMilli,
              type: 'SALE',
              refType: 'Sale',
              refId: sale.id,
              unitCostMinor: l.costMinor,
              note: wentNegative ? 'بيع برصيد سالب (مسموح بالإعدادات)' : undefined,
              userId: user.id,
            },
          })
        }

        // قيد دفتر العميل للآجل
        if (customer && creditMinor > 0) {
          await tx.customerLedgerEntry.create({
            data: {
              customerId: customer.id,
              type: 'INVOICE',
              amountMinor: creditMinor,
              refType: 'Sale',
              refId: sale.id,
              userId: user.id,
            },
          })
        }

        // المدفوعات + صندوق النقد
        for (const p of payments) {
          const sp = await tx.salePayment.create({
            data: {
              saleId: sale.id,
              customerId: customer?.id,
              method: p.method,
              amountMinor: p.amountMinor,
              shiftId: p.method === 'CASH' && openShiftId ? openShiftId : undefined,
              userId: user.id,
            },
          })
          if (p.method === 'CASH' && openShiftId) {
            await tx.cashMovement.create({
              data: {
                shiftId: openShiftId,
                type: 'SALE_CASH',
                amountMinor: p.amountMinor,
                refType: 'SalePayment',
                refId: sp.id,
                userId: user.id,
              },
            })
          }
        }

        const full = await tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true, payments: true } })
        return { full, saleId: sale.id, invoiceNo }
      },
      { isolationLevel: 'Serializable' }
    )

    // رد خطأ من داخل المعاملة (لم يتم إنشاء شيء)
    if (response instanceof NextResponse) return response

    // سجل التدقيق (خارج المعاملة)
    await audit({
      userId: user.id,
      username: user.username,
      action: 'SALE',
      entityType: 'Sale',
      entityId: response.saleId,
      details: { invoiceNo: response.invoiceNo, totalMinor: total, paidMinor: paid, creditMinor },
    })

    return ok(response.full)
  })
}

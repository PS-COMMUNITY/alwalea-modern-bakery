import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit, supplierDueMinor } from '@/lib/bakery/core'
import { PAY_METHODS, posInt } from '../../../_lib/bakery'
import { assertMonthOpen } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

/**
 * POST /api/suppliers/[id]/payments — دفعة للمورد (perm: suppliers.pay)
 * { amountMinor > 0, method, note? } — PurchasePayment بلا فاتورة + قيد دفتر + صندوق إن نقدًا
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'suppliers.pay')
    if ('response' in r) return r.response
    const { id } = await params
    const supplier = await db.supplier.findUnique({ where: { id } })
    if (!supplier) return fail(404, 'المورد غير موجود')

    // حاجز الشهر المقفل: دفعة بتاريخ الآن
    await assertMonthOpen(new Date())

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const amountMinor = posInt(body.amountMinor)
    if (amountMinor === null) return fail(400, 'المبلغ يجب أن يكون عددًا صحيحًا أكبر من صفر')
    if (!PAY_METHODS.includes(body.method)) return fail(400, 'طريقة الدفع غير صالحة (CASH أو CARD أو TRANSFER أو CHEQUE)')
    const note = str(body.note, 300)

    const dueBefore = await supplierDueMinor(id)
    const warning = amountMinor > dueBefore ? 'المبلغ أكبر من المستحق الحالي للمورد' : undefined

    const payment = await db.$transaction(async tx => {
      // الوردية المفتوحة (للنقد فقط)
      let openShiftId: string | undefined
      if (body.method === 'CASH') {
        const openShift = await tx.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } })
        openShiftId = openShift?.id
      }

      const payment = await tx.purchasePayment.create({
        data: {
          purchaseId: null,
          supplierId: id,
          method: body.method,
          amountMinor,
          note,
          shiftId: openShiftId,
          userId: r.user.id,
        },
      })

      // قيد دفتر: الدفعة تنقص المستحقات (سالب)
      await tx.supplierLedgerEntry.create({
        data: {
          supplierId: id,
          type: 'PAYMENT',
          amountMinor: -amountMinor,
          refType: 'PAYMENT',
          refId: payment.id,
          note,
          userId: r.user.id,
        },
      })

      // صرف من الصندوق عند وجود وردية مفتوحة
      if (body.method === 'CASH' && openShiftId) {
        await tx.cashMovement.create({
          data: {
            shiftId: openShiftId,
            type: 'PURCHASE_PAYMENT',
            amountMinor: -amountMinor,
            refType: 'PurchasePayment',
            refId: payment.id,
            note,
            userId: r.user.id,
          },
        })
      }

      return payment
    })

    await audit({
      userId: r.user.id,
      username: r.user.username,
      action: 'PAYMENT',
      entityType: 'Supplier',
      entityId: id,
      details: { paymentId: payment.id, amountMinor, method: body.method, supplierName: supplier.name },
    })

    return ok({
      payment,
      dueMinorBefore: dueBefore,
      dueMinorAfter: dueBefore - amountMinor,
      ...(warning ? { warning } : {}),
    })
  })
}

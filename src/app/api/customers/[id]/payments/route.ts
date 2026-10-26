import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit, customerDebtMinor } from '@/lib/bakery/core'
import { PAY_METHODS, posInt } from '../../../_lib/bakery'
import { assertMonthOpen } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

/**
 * POST /api/customers/[id]/payments — تسجيل دفعة من عميل (perm: customers.collect)
 * { amountMinor > 0, method: CASH|CARD|TRANSFER|CHEQUE, note? }
 * مسموح بالدفع الأكبر من الدين (دفع مقدَّم) مع تحذير في الاستجابة.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'customers.collect')
    if ('response' in r) return r.response
    const { id } = await params
    const customer = await db.customer.findUnique({ where: { id } })
    if (!customer) return fail(404, 'العميل غير موجود')

    // حاجز الشهر المقفل: تحصيل بتاريخ الآن
    await assertMonthOpen(new Date())

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const amountMinor = posInt(body.amountMinor)
    if (amountMinor === null) return fail(400, 'المبلغ يجب أن يكون عددًا صحيحًا أكبر من صفر')
    if (!PAY_METHODS.includes(body.method)) return fail(400, 'طريقة الدفع غير صالحة (CASH أو CARD أو TRANSFER أو CHEQUE)')
    const note = str(body.note, 300)

    const debtBefore = await customerDebtMinor(id)
    const warning = amountMinor > debtBefore ? 'المبلغ أكبر من الدين الحالي' : undefined

    const result = await db.$transaction(async tx => {
      // الوردية المفتوحة (للنقد فقط)
      let openShiftId: string | undefined
      if (body.method === 'CASH') {
        const openShift = await tx.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } })
        openShiftId = openShift?.id
      }

      const payment = await tx.salePayment.create({
        data: {
          saleId: null,
          customerId: id,
          method: body.method,
          amountMinor,
          note,
          shiftId: openShiftId,
          userId: r.user.id,
        },
      })

      // قيد دفتر: الدفعة تنقص الدين (سالب)
      const ledgerEntry = await tx.customerLedgerEntry.create({
        data: {
          customerId: id,
          type: 'PAYMENT',
          amountMinor: -amountMinor,
          refType: 'PAYMENT',
          refId: payment.id,
          note,
          userId: r.user.id,
        },
      })

      // نقدية الصندوق عند وجود وردية مفتوحة
      if (body.method === 'CASH' && openShiftId) {
        await tx.cashMovement.create({
          data: {
            shiftId: openShiftId,
            type: 'CUSTOMER_PAYMENT',
            amountMinor,
            refType: 'SalePayment',
            refId: payment.id,
            note,
            userId: r.user.id,
          },
        })
      }

      return { payment, ledgerEntry }
    })

    await audit({
      userId: r.user.id,
      username: r.user.username,
      action: 'PAYMENT',
      entityType: 'Customer',
      entityId: id,
      details: { paymentId: result.payment.id, amountMinor, method: body.method, customerName: customer.name },
    })

    return ok({
      payment: result.payment,
      debtMinorBefore: debtBefore,
      debtMinorAfter: debtBefore - amountMinor,
      ...(warning ? { warning } : {}),
    })
  })
}

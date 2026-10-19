import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { fromMinor } from '@/lib/bakery/money'
import { PAY_METHODS, posInt } from '../../../_lib/bakery'

export const dynamic = 'force-dynamic'

/**
 * POST /api/purchases/[id]/payments — دفعة مرتبطة بفاتورة شراء (perm: suppliers.pay)
 * { method, amountMinor > 0, note? } — لا تتجاوز المتبقي (total − مدفوعات الفاتورة السابقة).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'suppliers.pay')
    if ('response' in r) return r.response
    const user = r.user
    const { id } = await params

    const purchase = await db.purchase.findUnique({ where: { id } })
    if (!purchase) return fail(404, 'فاتورة الشراء غير موجودة')
    if (purchase.status === 'CANCELLED') return fail(409, 'لا يمكن الدفع على فاتورة ملغاة')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const amountMinor = posInt(body.amountMinor)
    if (amountMinor === null) return fail(400, 'المبلغ يجب أن يكون عددًا صحيحًا أكبر من صفر')
    if (!PAY_METHODS.includes(body.method)) return fail(400, 'طريقة الدفع غير صالحة (CASH أو CARD أو TRANSFER أو CHEQUE)')
    const note = str(body.note, 300)
    const ref = str(body.ref, 100)

    // المتبقي = الإجمالي − مجموع مدفوعات الفاتورة السابقة
    const agg = await db.purchasePayment.aggregate({ where: { purchaseId: id }, _sum: { amountMinor: true } })
    const paidSoFar = agg._sum.amountMinor ?? 0
    const remaining = purchase.totalMinor - paidSoFar
    if (amountMinor > remaining) {
      return fail(409, `المبلغ يتجاوز المتبقي على الفاتورة (المتبقي: ${fromMinor(remaining)})`)
    }

    const payment = await db.$transaction(async tx => {
      // الوردية: بالمعرف المرسل إن كانت مفتوحة، وإلا أي وردية مفتوحة (للنقد فقط)
      let openShiftId: string | undefined
      if (body.method === 'CASH') {
        const bodyShiftId = str(body.shiftId, 50)
        const shift = bodyShiftId
          ? await tx.shift.findFirst({ where: { id: bodyShiftId, status: 'OPEN' } })
          : await tx.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } })
        openShiftId = shift?.id
      }

      const payment = await tx.purchasePayment.create({
        data: {
          purchaseId: purchase.id,
          supplierId: purchase.supplierId,
          method: body.method,
          amountMinor,
          ref,
          note,
          shiftId: openShiftId,
          userId: user.id,
        },
      })

      // قيد دفتر المورد: الدفعة تنقص المستحقات
      await tx.supplierLedgerEntry.create({
        data: {
          supplierId: purchase.supplierId,
          type: 'PAYMENT',
          amountMinor: -amountMinor,
          refType: 'PurchasePayment',
          refId: payment.id,
          note,
          userId: user.id,
        },
      })

      // صرف من الصندوق إن نقدًا ووردية مفتوحة
      if (body.method === 'CASH' && openShiftId) {
        await tx.cashMovement.create({
          data: {
            shiftId: openShiftId,
            type: 'PURCHASE_PAYMENT',
            amountMinor: -amountMinor,
            refType: 'PurchasePayment',
            refId: payment.id,
            note,
            userId: user.id,
          },
        })
      }

      // تحديث مدفوعات الفاتورة وحالتها
      const newPaid = paidSoFar + amountMinor
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          paidMinor: newPaid,
          paymentStatus: newPaid >= purchase.totalMinor ? 'PAID' : 'PARTIAL',
        },
      })

      return payment
    })

    await audit({
      userId: user.id,
      username: user.username,
      action: 'PAYMENT',
      entityType: 'Purchase',
      entityId: purchase.id,
      details: { paymentId: payment.id, invoiceNo: purchase.invoiceNo, amountMinor, method: body.method, supplierName: purchase.supplierName },
    })

    return ok({ payment, paidMinor: paidSoFar + amountMinor, remainingMinor: remaining - amountMinor })
  })
}

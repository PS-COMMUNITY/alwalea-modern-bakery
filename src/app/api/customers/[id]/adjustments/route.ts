import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit, customerDebtMinor } from '@/lib/bakery/core'
import { signedInt } from '../../../_lib/bakery'

export const dynamic = 'force-dynamic'

/**
 * POST /api/customers/[id]/adjustments — تسوية دفتر عميل (متاحة للمالك فقط)
 * { amountMinor: موقعة ≠ 0, reason: مطلوب }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    if (r.user.role !== 'OWNER') return fail(403, 'هذه العملية متاحة للمالك فقط')

    const { id } = await params
    const customer = await db.customer.findUnique({ where: { id } })
    if (!customer) return fail(404, 'العميل غير موجود')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const amountMinor = signedInt(body.amountMinor)
    if (amountMinor === null || amountMinor === 0) {
      return fail(400, 'المبلغ يجب أن يكون عددًا صحيحًا لا يساوي صفر (موجب لزيادة الدين وسالب لإنقاصه)')
    }
    const reason = str(body.reason, 300)
    if (!reason) return fail(400, 'سبب التسوية مطلوب')

    const debtBefore = await customerDebtMinor(id)

    const entry = await db.$transaction(async tx =>
      tx.customerLedgerEntry.create({
        data: {
          customerId: id,
          type: 'ADJUSTMENT',
          amountMinor,
          refType: 'ADJUSTMENT',
          note: reason,
          userId: r.user.id,
        },
      })
    )

    await audit({
      userId: r.user.id,
      username: r.user.username,
      action: 'ADJUSTMENT',
      entityType: 'Customer',
      entityId: id,
      details: { entryId: entry.id, amountMinor, reason, customerName: customer.name },
    })

    return ok({ entry, debtMinorBefore: debtBefore, debtMinorAfter: debtBefore + amountMinor })
  })
}

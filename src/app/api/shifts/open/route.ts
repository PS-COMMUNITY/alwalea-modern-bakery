import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** POST /api/shifts/open — فتح وردية جديدة (صلاحية: shifts.use) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'shifts.use')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => ({}))
    const openingCashMinor = body && body.openingCashMinor !== undefined ? int(body.openingCashMinor) : 0
    if (openingCashMinor === null) return fail(400, 'نقدية الافتتاح يجب أن تكون رقمًا صحيحًا غير سالب')

    const existing = await db.shift.findFirst({ where: { status: 'OPEN' } })
    if (existing) return fail(409, 'توجد وردية مفتوحة بالفعل')

    const shift = await db.$transaction(async tx => {
      const created = await tx.shift.create({
        data: { openingCashMinor, status: 'OPEN', userId: r.user.id },
      })
      await tx.cashMovement.create({
        data: {
          shiftId: created.id,
          type: 'OPENING_CASH',
          amountMinor: openingCashMinor,
          note: 'نقدية افتتاح الوردية',
          userId: r.user.id,
        },
      })
      return created
    })

    await audit({ userId: r.user.id, username: r.user.username, action: 'SHIFT_OPEN', entityType: 'Shift', entityId: shift.id, details: { openingCashMinor } })
    return ok(shift)
  })
}

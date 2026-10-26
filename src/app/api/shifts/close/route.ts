import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { assertMonthOpen } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

/**
 * POST /api/shifts/close — إغلاق الوردية المفتوحة (صلاحية: shifts.close)
 * مسموح لصاحب الوردية نفسه أو OWNER.
 * expected = الافتتاحي + مجموع الحركات الموقعة، difference = المعدود − المتوقع
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'shifts.close')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const countedCashMinor = int(body.countedCashMinor)
    if (countedCashMinor === null) return fail(400, 'النقد المعدود مطلوب ويجب أن يكون رقمًا صحيحًا غير سالب')
    const notes = str(body.notes, 500)

    const shift = await db.shift.findFirst({ where: { status: 'OPEN' } })
    if (!shift) return fail(409, 'لا توجد وردية مفتوحة')

    // حاجز الشهر المقفل: تسوية صندوق بتاريخ الآن
    await assertMonthOpen(new Date())
    if (shift.userId !== r.user.id && r.user.role !== 'OWNER') {
      return fail(403, 'لا يمكنك إغلاق وردية فتحها مستخدم آخر')
    }

    const movements = await db.cashMovement.findMany({ where: { shiftId: shift.id } })
    const expected = shift.openingCashMinor + movements.reduce((s, m) => s + m.amountMinor, 0)
    const difference = countedCashMinor - expected

    const closed = await db.shift.update({
      where: { id: shift.id },
      data: {
        closedAt: new Date(),
        expectedCashMinor: expected,
        countedCashMinor,
        differenceMinor: difference,
        status: 'CLOSED',
        closedByUserId: r.user.id,
        notes: notes ?? shift.notes,
      },
    })

    await audit({
      userId: r.user.id, username: r.user.username, action: 'SHIFT_CLOSE', entityType: 'Shift', entityId: shift.id,
      details: { openingCashMinor: shift.openingCashMinor, expectedCashMinor: expected, countedCashMinor, differenceMinor: difference },
    })
    return ok(closed)
  })
}

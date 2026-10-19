import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/shifts/current — الوردية المفتوحة مع مجموع حركاتها وتوقع الرصيد */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'shifts.view')
    if ('response' in r) return r.response
    const shift = await db.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } })
    if (!shift) return ok({ shift: null, expectedCashMinor: 0, movementsTotalMinor: 0 })

    const movements = await db.cashMovement.findMany({ where: { shiftId: shift.id }, orderBy: { date: 'asc' } })
    const movementsTotalMinor = movements.reduce((s, m) => s + m.amountMinor, 0)
    const expectedCashMinor = shift.openingCashMinor + movementsTotalMinor

    const user = await db.user.findUnique({ where: { id: shift.userId }, select: { id: true, displayName: true, username: true } })

    // مجاميع حسب النوع
    const byType: Record<string, number> = {}
    for (const m of movements) byType[m.type] = (byType[m.type] ?? 0) + m.amountMinor

    return ok({
      shift: { ...shift, user },
      expectedCashMinor,
      movementsTotalMinor,
      movementsCount: movements.length,
      byType,
    })
  })
}

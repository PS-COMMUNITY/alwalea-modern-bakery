import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/shifts/[id] — وردية مع كل حركاتها النقدية ومجاميعها حسب النوع */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'shifts.view')
    if ('response' in r) return r.response
    const { id } = await params
    const shift = await db.shift.findUnique({ where: { id } })
    if (!shift) return fail(404, 'الوردية غير موجودة')

    const movements = await db.cashMovement.findMany({
      where: { shiftId: id },
      orderBy: { date: 'asc' },
    })
    const movementsTotalMinor = movements.reduce((s, m) => s + m.amountMinor, 0)

    const byType: Record<string, { totalMinor: number; count: number }> = {}
    for (const m of movements) {
      const cur = byType[m.type] ?? { totalMinor: 0, count: 0 }
      cur.totalMinor += m.amountMinor
      cur.count += 1
      byType[m.type] = cur
    }

    const userIds = [shift.userId, shift.closedByUserId].filter((x): x is string => !!x)
    const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true } })
    const byId = new Map(users.map(u => [u.id, u]))

    return ok({
      shift: {
        ...shift,
        user: byId.get(shift.userId) ?? null,
        closedBy: shift.closedByUserId ? byId.get(shift.closedByUserId) ?? null : null,
      },
      movements,
      movementsTotalMinor,
      expectedCashMinor: shift.status === 'OPEN'
        ? shift.openingCashMinor + movementsTotalMinor
        : shift.expectedCashMinor,
      differenceMinor: shift.differenceMinor,
      byType,
    })
  })
}

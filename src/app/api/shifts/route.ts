import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/shifts — سجل الورديات مع المستخدمين (الأحدث أولًا) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'shifts.view')
    if ('response' in r) return r.response
    const shifts = await db.shift.findMany({ orderBy: { openedAt: 'desc' } })
    const userIds = [...new Set(shifts.flatMap(s => [s.userId, s.closedByUserId].filter((x): x is string => !!x)))]
    const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true } })
    const byId = new Map(users.map(u => [u.id, u]))
    return ok(shifts.map(s => ({
      ...s,
      user: byId.get(s.userId) ? { id: s.userId, displayName: byId.get(s.userId)!.displayName, username: byId.get(s.userId)!.username } : null,
      closedBy: s.closedByUserId && byId.get(s.closedByUserId) ? { id: s.closedByUserId, displayName: byId.get(s.closedByUserId)!.displayName, username: byId.get(s.closedByUserId)!.username } : null,
    })))
  })
}

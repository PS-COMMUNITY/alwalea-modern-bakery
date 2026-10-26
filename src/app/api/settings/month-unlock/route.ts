import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { isValidMonthKey } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

/**
 * POST /api/settings/month-unlock — فك قفل شهر بسبب إلزامي (perm: settings.manage)
 * { month: "YYYY-MM", reason: إلزامي }
 * - السبب إلزامي ويُسجل في سجل التدقيق (MONTH_UNLOCK).
 * - فك القفل لا يحذف أي حركة قديمة — يفتح الشهر للتصحيح فقط.
 * - يمكن إعادة إقفال الشهر بعد التصحيح عبر POST /api/settings/month-close.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'settings.manage')
    if ('response' in r) return r.response
    const user = r.user
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const month = str(body.month, 7)
    if (!isValidMonthKey(month)) return fail(400, 'صيغة الشهر يجب أن تكون YYYY-MM')

    const reason = str(body.reason, 500)
    if (!reason) return fail(400, 'سبب فك القفل إلزامي ويُسجل في سجل التدقيق')

    const row = await db.periodClose.findUnique({ where: { month } })
    if (!row) return fail(404, 'هذا الشهر غير مقفل أصلًا')
    if (!row.locked) return fail(409, 'هذا الشهر غير مقفل حاليًا')

    const updated = await db.periodClose.update({
      where: { month },
      data: {
        locked: false,
        unlockedAt: new Date(),
        unlockedByUserId: user.id,
        unlockedByName: user.displayName,
        unlockReason: reason,
      },
    })

    await audit({
      userId: user.id,
      username: user.username,
      action: 'MONTH_UNLOCK',
      entityType: 'PeriodClose',
      entityId: updated.id,
      details: { month, reason, previousCloseCount: updated.closeCount },
    })

    return ok({ month, locked: updated.locked, unlockReason: updated.unlockReason, unlockedAt: updated.unlockedAt })
  })
}

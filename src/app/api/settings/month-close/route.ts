import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { isValidMonthKey, monthKeyOf } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

/**
 * POST /api/settings/month-close — إقفال شهر مالي (perm: settings.manage)
 * { month: "YYYY-MM" }
 * بعد الإقفال تُرفض كل كتابة مالية/مخزنية بتاريخ داخل هذا الشهر برسالة الحاجز الحرفية.
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

    const row = await db.periodClose.upsert({
      where: { month },
      create: { month, locked: true, closedByUserId: user.id, closedByName: user.displayName },
      update: {
        locked: true,
        closedAt: new Date(),
        closedByUserId: user.id,
        closedByName: user.displayName,
        closeCount: { increment: 1 },
      },
    })

    await audit({
      userId: user.id,
      username: user.username,
      action: 'MONTH_CLOSE',
      entityType: 'PeriodClose',
      entityId: row.id,
      details: { month, closeCount: row.closeCount },
    })

    return ok({ month, locked: row.locked, closeCount: row.closeCount, closedAt: row.closedAt })
  })
}

/**
 * GET /api/settings/month-close?month=YYYY-MM — حالة شهر محدد أو قائمة الشهور المقفلة
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const month = req.nextUrl.searchParams.get('month')
    if (month && isValidMonthKey(month)) {
      const row = await db.periodClose.findUnique({ where: { month } })
      return ok({ month, locked: row?.locked ?? false, row: row ?? null })
    }
    const rows = await db.periodClose.findMany({ where: { locked: true }, orderBy: { month: 'desc' } })
    return ok({ lockedMonths: rows.map(x => x.month), rows })
  })
}

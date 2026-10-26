import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/settings/periods — سجل إقفال الشهور (perm: settings.manage)
 * كل صف: الشهر، حالته، من أقفل/فك، سبب فك القفل الأخير، وعدد مرات الإقفال.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'settings.manage')
    if ('response' in r) return r.response
    const rows = await db.periodClose.findMany({ orderBy: { month: 'desc' }, take: 60 })
    return ok({
      rows: rows.map(p => ({
        id: p.id,
        month: p.month,
        locked: p.locked,
        closedAt: p.closedAt,
        closedByName: p.closedByName,
        unlockedAt: p.unlockedAt,
        unlockedByName: p.unlockedByName,
        unlockReason: p.unlockReason,
        closeCount: p.closeCount,
      })),
    })
  })
}

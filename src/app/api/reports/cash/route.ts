import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/reports/cash?from&to — حركات الصندوق في الفترة مجمعة حسب النوع (reports.financial) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'reports.financial')
    if ('response' in r) return r.response
    const sp = req.nextUrl.searchParams
    const where: { date?: { gte?: Date; lte?: Date } } = {}
    const fromS = sp.get('from'), toS = sp.get('to')
    if (fromS) {
      const d = new Date(`${fromS}T00:00:00`)
      if (isNaN(d.getTime())) return fail(400, 'تاريخ البداية غير صالح')
      where.date = { gte: d }
    }
    if (toS) {
      const d = new Date(`${toS}T23:59:59.999`)
      if (isNaN(d.getTime())) return fail(400, 'تاريخ النهاية غير صالح')
      where.date = { ...(where.date ?? {}), lte: d }
    }

    const movements = await db.cashMovement.findMany({ where, select: { type: true, amountMinor: true } })

    const typeMap = new Map<string, { type: string; totalMinor: number; count: number }>()
    for (const m of movements) {
      const cur = typeMap.get(m.type) ?? { type: m.type, totalMinor: 0, count: 0 }
      cur.totalMinor += m.amountMinor
      cur.count += 1
      typeMap.set(m.type, cur)
    }
    const byType = [...typeMap.values()].sort((a, b) => b.totalMinor - a.totalMinor)
    const netMinor = movements.reduce((s, m) => s + m.amountMinor, 0)
    const inflowMinor = movements.filter(m => m.amountMinor > 0).reduce((s, m) => s + m.amountMinor, 0)
    const outflowMinor = movements.filter(m => m.amountMinor < 0).reduce((s, m) => s + m.amountMinor, 0)

    return ok({ netMinor, inflowMinor, outflowMinor, movementsCount: movements.length, byType })
  })
}

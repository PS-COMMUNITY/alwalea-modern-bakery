import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/reports/distribution?from&to — نتائج جولات الفترة مجمعة حسب المندوب (reports.operations) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'reports.operations')
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

    const trips = await db.distributionTrip.findMany({
      where,
      include: {
        rep: { select: { id: true, name: true } },
        loads: { select: { qtyMilli: true } },
        sales: { select: { qtyMilli: true, lineTotalMinor: true, paymentType: true } },
        returns: { select: { qtyMilli: true, condition: true } },
      },
      orderBy: { date: 'desc' },
    })

    const repMap = new Map<string, {
      repId: string; repName: string; tripsCount: number
      loadedMilli: number; soldMilli: number
      returnedGoodMilli: number; returnedDamagedMilli: number
      cashMinor: number; creditMinor: number
    }>()
    for (const t of trips) {
      const cur = repMap.get(t.repId) ?? {
        repId: t.repId, repName: t.rep.name, tripsCount: 0,
        loadedMilli: 0, soldMilli: 0, returnedGoodMilli: 0, returnedDamagedMilli: 0, cashMinor: 0, creditMinor: 0,
      }
      cur.tripsCount += 1
      cur.loadedMilli += t.loads.reduce((s, l) => s + l.qtyMilli, 0)
      cur.soldMilli += t.sales.reduce((s, x) => s + x.qtyMilli, 0)
      cur.returnedGoodMilli += t.returns.filter(x => x.condition === 'GOOD').reduce((s, x) => s + x.qtyMilli, 0)
      cur.returnedDamagedMilli += t.returns.filter(x => x.condition === 'DAMAGED').reduce((s, x) => s + x.qtyMilli, 0)
      cur.cashMinor += t.sales.filter(x => x.paymentType === 'CASH').reduce((s, x) => s + x.lineTotalMinor, 0)
      cur.creditMinor += t.sales.filter(x => x.paymentType === 'CREDIT').reduce((s, x) => s + x.lineTotalMinor, 0)
      repMap.set(t.repId, cur)
    }

    const byRep = [...repMap.values()].sort((a, b) => (b.cashMinor + b.creditMinor) - (a.cashMinor + a.creditMinor))
    const totals = {
      tripsCount: trips.length,
      settledCount: trips.filter(t => t.status === 'SETTLED').length,
      openCount: trips.filter(t => t.status === 'OPEN').length,
      loadedMilli: byRep.reduce((s, x) => s + x.loadedMilli, 0),
      soldMilli: byRep.reduce((s, x) => s + x.soldMilli, 0),
      returnedGoodMilli: byRep.reduce((s, x) => s + x.returnedGoodMilli, 0),
      returnedDamagedMilli: byRep.reduce((s, x) => s + x.returnedDamagedMilli, 0),
      cashMinor: byRep.reduce((s, x) => s + x.cashMinor, 0),
      creditMinor: byRep.reduce((s, x) => s + x.creditMinor, 0),
    }

    return ok({ totals, byRep, trips: trips.map(t => ({ id: t.id, tripNo: t.tripNo, date: t.date, status: t.status, repName: t.rep.name })) })
  })
}

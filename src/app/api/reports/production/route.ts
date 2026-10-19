import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/reports/production?from&to — دفعات الفترة مع الهدر وكفاءة التحويل (reports.operations) */
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

    const batches = await db.productionBatch.findMany({
      where,
      include: {
        recipe: { select: { id: true, name: true, outputProduct: { select: { id: true, name: true, baseUnit: true } } } },
      },
      orderBy: { date: 'desc' },
    })

    const items = batches.map(b => ({
      id: b.id,
      batchNo: b.batchNo,
      date: b.date,
      status: b.status,
      recipeName: b.recipe.name,
      outputProductName: b.recipe.outputProduct.name,
      plannedQtyMilli: b.plannedQtyMilli,
      actualQtyMilli: b.actualQtyMilli,
      wasteQtyMilli: b.wasteQtyMilli,
      materialsCostMinor: b.materialsCostMinor,
      unitCostMinor: b.unitCostMinor,
      efficiencyPercent: b.plannedQtyMilli > 0 ? Math.round((b.actualQtyMilli * 100) / b.plannedQtyMilli) : 0,
      wastePercent: (b.actualQtyMilli + b.wasteQtyMilli) > 0
        ? Math.round((b.wasteQtyMilli * 100) / (b.actualQtyMilli + b.wasteQtyMilli))
        : 0,
    }))

    const completed = items.filter(x => x.status === 'COMPLETED')
    const totals = {
      batchesCount: completed.length,
      plannedQtyMilli: completed.reduce((s, x) => s + x.plannedQtyMilli, 0),
      actualQtyMilli: completed.reduce((s, x) => s + x.actualQtyMilli, 0),
      wasteQtyMilli: completed.reduce((s, x) => s + x.wasteQtyMilli, 0),
      materialsCostMinor: completed.reduce((s, x) => s + x.materialsCostMinor, 0),
      avgEfficiencyPercent: completed.length
        ? Math.round(completed.reduce((s, x) => s + x.efficiencyPercent, 0) / completed.length)
        : 0,
    }

    return ok({ totals, items })
  })
}

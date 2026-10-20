import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/reports/inventory-valuation — قيمة المخزون لكل منتج (الرصيد × التكلفة) + الإجمالي (reports.operations) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'reports.operations')
    if ('response' in r) return r.response

    const products = await db.product.findMany({
      select: { id: true, name: true, type: true, baseUnit: true, costMinor: true, active: true, trackStock: true },
      orderBy: { name: 'asc' },
    })
    const balances = await db.stockMovement.groupBy({ by: ['productId'], _sum: { qtyMilli: true } })
    const balanceMap = new Map(balances.map(b => [b.productId, b._sum.qtyMilli ?? 0]))

    const items = products.map(p => {
      const balanceMilli = balanceMap.get(p.id) ?? 0
      return {
        productId: p.id,
        name: p.name,
        type: p.type,
        baseUnit: p.baseUnit,
        costMinor: p.costMinor,
        active: p.active,
        trackStock: p.trackStock,
        balanceMilli,
        valueMinor: Math.round((balanceMilli * p.costMinor) / 1000),
      }
    }).sort((a, b) => b.valueMinor - a.valueMinor)

    const totalValueMinor = items.reduce((s, x) => s + x.valueMinor, 0)
    return ok({ totalValueMinor, itemsCount: items.length, items })
  })
}

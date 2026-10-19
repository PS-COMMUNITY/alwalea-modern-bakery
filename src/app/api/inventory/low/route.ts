import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/inventory/low — المنتجات التي رصيدها ≤ الحد الأدنى أو ≤ صفر (مصادقة فقط) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response

    const products = await db.product.findMany({ where: { trackStock: true }, orderBy: { name: 'asc' } })
    const sums = await db.stockMovement.groupBy({
      by: ['productId'],
      where: { productId: { in: products.map(p => p.id) } },
      _sum: { qtyMilli: true },
    })
    const stockMap = new Map(sums.map(s => [s.productId, s._sum.qtyMilli ?? 0]))

    const items = products
      .map(p => {
        const qtyMilli = stockMap.get(p.id) ?? 0
        return {
          productId: p.id,
          name: p.name,
          code: p.code,
          baseUnit: p.baseUnit,
          active: p.active,
          qtyMilli,
          minStockMilli: p.minStockMilli,
          diffMilli: qtyMilli - p.minStockMilli,
        }
      })
      .filter(p => p.qtyMilli <= p.minStockMilli || p.qtyMilli <= 0)

    return ok({ items, total: items.length })
  })
}

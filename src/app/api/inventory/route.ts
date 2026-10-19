import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/inventory — أرصدة كل المنتجات مع قيمة المخزون (مصادقة فقط) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response

    const products = await db.product.findMany({
      orderBy: { name: 'asc' },
      include: { category: true },
    })
    const sums = await db.stockMovement.groupBy({ by: ['productId'], _sum: { qtyMilli: true } })
    const stockMap = new Map(sums.map(s => [s.productId, s._sum.qtyMilli ?? 0]))

    const items = products.map(p => {
      const qtyMilli = stockMap.get(p.id) ?? 0
      return {
        productId: p.id,
        name: p.name,
        code: p.code,
        barcode: p.barcode,
        type: p.type,
        baseUnit: p.baseUnit,
        trackStock: p.trackStock,
        active: p.active,
        category: p.category ? { id: p.category.id, name: p.category.name } : null,
        costMinor: p.costMinor,
        minStockMilli: p.minStockMilli,
        qtyMilli,
        // قيمة المخزون = الرصيد × التكلفة / 1000 (مقربة)
        stockValueMinor: Math.round((qtyMilli * p.costMinor) / 1000),
      }
    })

    return ok({ items, total: items.length })
  })
}

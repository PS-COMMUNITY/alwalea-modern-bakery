import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/distribution/trips/[id] — الجولة كاملة:
 * الحمولة والمبيعات والمرتجعات + المحسوب:
 * loaded/sold/returnedGood/returnedDamaged/remaining/cashCollected/creditTotal
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.view')
    if ('response' in r) return r.response
    const { id } = await params

    const trip = await db.distributionTrip.findUnique({
      where: { id },
      include: {
        rep: { select: { id: true, name: true, phone: true } },
        route: { select: { id: true, name: true } },
        loads: { include: { product: { select: { id: true, name: true, baseUnit: true } } }, orderBy: { id: 'asc' } },
        sales: {
          include: { product: { select: { id: true, name: true, baseUnit: true } } },
          orderBy: { createdAt: 'asc' },
        },
        returns: {
          include: { product: { select: { id: true, name: true, baseUnit: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!trip) return fail(404, 'الجولة غير موجودة')

    // جدول لكل منتج: محمّل/مبيع/مرتجع صالح/مرتجع تالف/متبقٍ
    const map = new Map<string, { productId: string; productName: string; baseUnit: string; loadedMilli: number; soldMilli: number; returnedGoodMilli: number; returnedDamagedMilli: number }>()
    const ensure = (productId: string, productName: string, baseUnit: string) => {
      let row = map.get(productId)
      if (!row) {
        row = { productId, productName, baseUnit, loadedMilli: 0, soldMilli: 0, returnedGoodMilli: 0, returnedDamagedMilli: 0 }
        map.set(productId, row)
      }
      return row
    }
    for (const l of trip.loads) ensure(l.productId, l.product.name, l.product.baseUnit).loadedMilli += l.qtyMilli
    for (const s of trip.sales) ensure(s.productId, s.product.name, s.product.baseUnit).soldMilli += s.qtyMilli
    for (const rt of trip.returns) {
      const row = ensure(rt.productId, rt.product.name, rt.product.baseUnit)
      if (rt.condition === 'GOOD') row.returnedGoodMilli += rt.qtyMilli
      else row.returnedDamagedMilli += rt.qtyMilli
    }
    const perProduct = [...map.values()].map(row => ({
      ...row,
      remainingMilli: row.loadedMilli - row.soldMilli - row.returnedGoodMilli - row.returnedDamagedMilli,
    }))

    const cashCollectedMinor = trip.sales.filter(s => s.paymentType === 'CASH').reduce((sum, s) => sum + s.lineTotalMinor, 0)
    const creditTotalMinor = trip.sales.filter(s => s.paymentType === 'CREDIT').reduce((sum, s) => sum + s.lineTotalMinor, 0)

    const { loads, sales, returns, ...tripRest } = trip
    return ok({
      trip: tripRest,
      loads,
      sales,
      returns,
      computed: {
        perProduct,
        loadedMilli: perProduct.reduce((s, x) => s + x.loadedMilli, 0),
        soldMilli: perProduct.reduce((s, x) => s + x.soldMilli, 0),
        returnedGoodMilli: perProduct.reduce((s, x) => s + x.returnedGoodMilli, 0),
        returnedDamagedMilli: perProduct.reduce((s, x) => s + x.returnedDamagedMilli, 0),
        remainingMilli: perProduct.reduce((s, x) => s + x.remainingMilli, 0),
        cashCollectedMinor,
        creditTotalMinor,
        totalCollectedMinor: cashCollectedMinor + creditTotalMinor,
      },
    })
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

class BizError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type SaleInput = { productId: string; qtyMilli: number; priceMinor: number; customerId?: string; paymentType: 'CASH' | 'CREDIT' }

function parseItems(raw: unknown): SaleInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const items: SaleInput[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') return null
    const o = it as Record<string, unknown>
    const productId = str(o.productId, 60)
    const qtyMilli = int(o.qtyMilli)
    const priceMinor = int(o.priceMinor)
    const paymentType = o.paymentType === 'CASH' || o.paymentType === 'CREDIT' ? o.paymentType : null
    const customerId = str(o.customerId, 60) ?? undefined
    if (!productId || !qtyMilli || qtyMilli <= 0 || priceMinor === null || priceMinor < 0 || !paymentType) return null
    if (paymentType === 'CREDIT' && !customerId) return null
    items.push({ productId, qtyMilli, priceMinor, customerId, paymentType })
  }
  return items
}

/**
 * POST /api/distribution/trips/[id]/sales — تسجيل بيع من عهدة الجولة (صلاحية: distribution.manage)
 * لا حركة مخزون الآن (الشحنة خرجت عند التحميل)، والنقد يجمع في عهدة الجولة
 * ويُرحّل كفاتورة Sale حقيقية عند التسوية.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const items = parseItems(body.items)
    if (!items) return fail(400, 'بنود البيع غير صالحة (كل بند: productId وqtyMilli وpriceMinor، وللبيع الآجل customerId إلزامي)')

    try {
      const created = await db.$transaction(async tx => {
        const trip = await tx.distributionTrip.findUnique({ where: { id } })
        if (!trip) throw new BizError(404, 'الجولة غير موجودة')
        if (trip.status !== 'OPEN') throw new BizError(409, 'لا يمكن البيع: الجولة مسواة مسبقًا')

        const rows: { id: string; productId: string; qtyMilli: number; priceMinor: number; lineTotalMinor: number; paymentType: string; customerName: string }[] = []
        for (const it of items) {
          const product = await tx.product.findUnique({ where: { id: it.productId } })
          if (!product) throw new BizError(404, 'أحد منتجات البيع غير موجود')
          if (!product.active) throw new BizError(409, `المنتج ${product.name} غير مفعل`)

          let customerName = 'عميل نقدي'
          let customerId: string | undefined
          if (it.paymentType === 'CREDIT') {
            const customer = await tx.customer.findUnique({ where: { id: it.customerId! } })
            if (!customer) throw new BizError(404, 'العميل المحدد للبيع الآجل غير موجود')
            if (!customer.active) throw new BizError(409, `العميل ${customer.name} غير مفعل`)
            customerName = customer.name
            customerId = customer.id
          }

          const lineTotalMinor = Math.round((it.qtyMilli * it.priceMinor) / 1000)
          const row = await tx.tripSale.create({
            data: {
              tripId: trip.id,
              productId: product.id,
              customerId,
              customerName,
              qtyMilli: it.qtyMilli,
              priceMinor: it.priceMinor,
              lineTotalMinor,
              paymentType: it.paymentType,
            },
          })
          rows.push({ id: row.id, productId: product.id, qtyMilli: it.qtyMilli, priceMinor: it.priceMinor, lineTotalMinor, paymentType: it.paymentType, customerName })
        }
        return rows
      })

      await audit({
        userId: r.user.id, username: r.user.username, action: 'TRIP_SALE', entityType: 'DistributionTrip', entityId: id,
        details: {
          itemsCount: created.length,
          cashMinor: created.filter(x => x.paymentType === 'CASH').reduce((s, x) => s + x.lineTotalMinor, 0),
          creditMinor: created.filter(x => x.paymentType === 'CREDIT').reduce((s, x) => s + x.lineTotalMinor, 0),
        },
      })
      return ok({ sales: created })
    } catch (e) {
      if (e instanceof BizError) return fail(e.status, e.message)
      throw e
    }
  })
}

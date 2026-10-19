import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

class BizError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type ReturnInput = { productId: string; qtyMilli: number; condition: 'GOOD' | 'DAMAGED'; note?: string }

function parseItems(raw: unknown): ReturnInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const items: ReturnInput[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') return null
    const o = it as Record<string, unknown>
    const productId = str(o.productId, 60)
    const qtyMilli = int(o.qtyMilli)
    const condition = o.condition === 'GOOD' || o.condition === 'DAMAGED' ? o.condition : null
    if (!productId || !qtyMilli || qtyMilli <= 0 || !condition) return null
    items.push({ productId, qtyMilli, condition, note: str(o.note, 300) ?? undefined })
  }
  return items
}

/**
 * POST /api/distribution/trips/[id]/returns — تسجيل مرتجعات الجولة
 * TripReturn فقط — الحركة المخزنية تتم عند التسوية.
 * المرتجع لا يتجاوز الكمية المتبقية بالعهدة (المحمّل − المبيع − المرتجع).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const items = parseItems(body.items)
    if (!items) return fail(400, 'بنود المرتجع غير صالحة (كل بند: productId وqtyMilli وcondition = GOOD أو DAMAGED)')

    try {
      const created = await db.$transaction(async tx => {
        const trip = await tx.distributionTrip.findUnique({ where: { id }, include: { loads: true, sales: true, returns: true } })
        if (!trip) throw new BizError(404, 'الجولة غير موجودة')
        if (trip.status !== 'OPEN') throw new BizError(409, 'لا يمكن تسجيل مرتجعات: الجولة مسواة مسبقًا')

        // المتبقي بالعهدة لكل منتج
        const remain = new Map<string, number>()
        for (const l of trip.loads) remain.set(l.productId, (remain.get(l.productId) ?? 0) + l.qtyMilli)
        for (const s of trip.sales) remain.set(s.productId, (remain.get(s.productId) ?? 0) - s.qtyMilli)
        for (const rt of trip.returns) remain.set(rt.productId, (remain.get(rt.productId) ?? 0) - rt.qtyMilli)

        const rows: { id: string; productId: string; qtyMilli: number; condition: string }[] = []
        for (const it of items) {
          const product = await tx.product.findUnique({ where: { id: it.productId } })
          if (!product) throw new BizError(404, 'أحد منتجات المرتجع غير موجود')
          const remaining = remain.get(it.productId) ?? 0
          if (it.qtyMilli > remaining) {
            throw new BizError(409, `المرتجع يتجاوز الكمية المتبقية بالعهدة من المنتج ${product.name} (المتبقي: ${(remaining / 1000).toString()})`)
          }
          remain.set(it.productId, remaining - it.qtyMilli)
          const row = await tx.tripReturn.create({
            data: {
              tripId: trip.id,
              productId: it.productId,
              qtyMilli: it.qtyMilli,
              condition: it.condition,
              note: it.note,
            },
          })
          rows.push({ id: row.id, productId: it.productId, qtyMilli: it.qtyMilli, condition: it.condition })
        }
        return rows
      })

      await audit({
        userId: r.user.id, username: r.user.username, action: 'TRIP_RETURN', entityType: 'DistributionTrip', entityId: id,
        details: {
          goodMilli: created.filter(x => x.condition === 'GOOD').reduce((s, x) => s + x.qtyMilli, 0),
          damagedMilli: created.filter(x => x.condition === 'DAMAGED').reduce((s, x) => s + x.qtyMilli, 0),
        },
      })
      return ok({ returns: created })
    } catch (e) {
      if (e instanceof BizError) return fail(e.status, e.message)
      throw e
    }
  })
}

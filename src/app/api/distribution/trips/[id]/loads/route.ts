import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

type Tx = Prisma.TransactionClient

class BizError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function fmtQty(milli: number): string {
  const v = milli / 1000
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)))
}

type LoadInput = { productId: string; qtyMilli: number }

function parseLoads(raw: unknown): LoadInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const loads: LoadInput[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') return null
    const productId = str((it as Record<string, unknown>).productId, 60)
    const qtyMilli = int((it as Record<string, unknown>).qtyMilli)
    if (!productId || !qtyMilli || qtyMilli <= 0) return null
    loads.push({ productId, qtyMilli })
  }
  return loads
}

/** POST /api/distribution/trips/[id]/loads — إضافة تحميل لجولة OPEN فقط (نفس منطق التحميل) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const loads = parseLoads(body.loads)
    if (!loads) return fail(400, 'بنود التحميل غير صالحة (مطلوب مصفوفة loads غير فارغة، كل بند: productId وqtyMilli أكبر من صفر)')

    try {
      const result = await db.$transaction(async tx => {
        const trip = await tx.distributionTrip.findUnique({ where: { id } })
        if (!trip) throw new BizError(404, 'الجولة غير موجودة')
        if (trip.status !== 'OPEN') throw new BizError(409, 'لا يمكن التحميل: الجولة مسواة مسبقًا')

        for (const l of loads) {
          const product = await tx.product.findUnique({ where: { id: l.productId } })
          if (!product) throw new BizError(404, 'أحد المنتجات المطلوب تحميلها غير موجود')
          if (!product.active) throw new BizError(409, `المنتج ${product.name} غير مفعل`)
          const agg = await tx.stockMovement.aggregate({ where: { productId: product.id }, _sum: { qtyMilli: true } })
          const avail = agg._sum.qtyMilli ?? 0
          if (avail - l.qtyMilli < 0) {
            throw new BizError(409, `الكمية غير كافية من المنتج ${product.name} (المتاح: ${fmtQty(avail)})`)
          }
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              qtyMilli: -l.qtyMilli,
              type: 'TRIP_OUT',
              refType: 'DistributionTrip',
              refId: trip.id,
              note: `تحميل إضافي على جولة ${trip.tripNo}`,
              userId: r.user.id,
            },
          })
          await tx.tripLoad.create({ data: { tripId: trip.id, productId: product.id, qtyMilli: l.qtyMilli } })
        }
        return tx.tripLoad.findMany({ where: { tripId: trip.id } })
      })

      await audit({ userId: r.user.id, username: r.user.username, action: 'TRIP_LOAD', entityType: 'DistributionTrip', entityId: id, details: { addedCount: loads.length, addedMilli: loads.reduce((s, l) => s + l.qtyMilli, 0) } })
      return ok({ loads: result })
    } catch (e) {
      if (e instanceof BizError) return fail(e.status, e.message)
      throw e
    }
  })
}

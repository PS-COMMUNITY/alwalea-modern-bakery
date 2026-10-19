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

async function txNextNumber(tx: Tx, prefix: string): Promise<string> {
  const day = new Date()
  const key = `${prefix}-${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`
  const seq = await tx.sequence.upsert({
    where: { id: key },
    create: { id: key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${key}-${String(seq.value).padStart(4, '0')}`
}

function fmtQty(milli: number): string {
  const v = milli / 1000
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)))
}

type LoadInput = { productId: string; qtyMilli: number }

function parseLoads(raw: unknown): LoadInput[] | null {
  if (!Array.isArray(raw)) return null
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

/** منطق تحميل المواد على الجولة (خصم مخزون TRIP_OUT + TripLoad) */
async function loadItems(tx: Tx, tripId: string, tripNo: string, loads: LoadInput[], userId: string) {
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
        refId: tripId,
        note: `تحميل على جولة ${tripNo}`,
        userId,
      },
    })
    await tx.tripLoad.create({ data: { tripId, productId: product.id, qtyMilli: l.qtyMilli } })
  }
}

/** GET /api/distribution/trips — قائمة الجولات (فلاتر repId/status/from/to) مع مجموعات */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.view')
    if ('response' in r) return r.response
    const sp = req.nextUrl.searchParams
    const where: Prisma.DistributionTripWhereInput = {}
    const repId = sp.get('repId')
    const status = sp.get('status')
    const fromS = sp.get('from'), toS = sp.get('to')
    if (repId) where.repId = repId
    if (status && ['OPEN', 'SETTLED'].includes(status)) where.status = status
    const dateRange: { gte?: Date; lte?: Date } = {}
    if (fromS) {
      const d = new Date(`${fromS}T00:00:00`)
      if (isNaN(d.getTime())) return fail(400, 'تاريخ البداية غير صالح')
      dateRange.gte = d
    }
    if (toS) {
      const d = new Date(`${toS}T23:59:59.999`)
      if (isNaN(d.getTime())) return fail(400, 'تاريخ النهاية غير صالح')
      dateRange.lte = d
    }
    if (Object.keys(dateRange).length) where.date = dateRange

    const trips = await db.distributionTrip.findMany({
      where,
      include: {
        rep: { select: { id: true, name: true } },
        route: { select: { id: true, name: true } },
        loads: true,
        sales: true,
        returns: true,
      },
      orderBy: { date: 'desc' },
    })

    const items = trips.map(t => {
      const loadedMilli = t.loads.reduce((s, l) => s + l.qtyMilli, 0)
      const soldMilli = t.sales.reduce((s, x) => s + x.qtyMilli, 0)
      const returnedGoodMilli = t.returns.filter(x => x.condition === 'GOOD').reduce((s, x) => s + x.qtyMilli, 0)
      const returnedDamagedMilli = t.returns.filter(x => x.condition === 'DAMAGED').reduce((s, x) => s + x.qtyMilli, 0)
      const cashMinor = t.sales.filter(x => x.paymentType === 'CASH').reduce((s, x) => s + x.lineTotalMinor, 0)
      const creditMinor = t.sales.filter(x => x.paymentType === 'CREDIT').reduce((s, x) => s + x.lineTotalMinor, 0)
      const { loads, sales, returns, ...rest } = t
      return { ...rest, loadedMilli, soldMilli, returnedGoodMilli, returnedDamagedMilli, cashMinor, creditMinor, loadsCount: loads.length, salesCount: sales.length, returnsCount: returns.length }
    })
    return ok(items)
  })
}

/** POST /api/distribution/trips — فتح جولة توزيع مع تحميل (صلاحية: distribution.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const repId = str(body.repId, 60)
    const routeId = str(body.routeId, 60)
    const loads = body.loads === undefined ? [] : parseLoads(body.loads)
    if (!repId) return fail(400, 'المندوب مطلوب')
    if (loads === null) return fail(400, 'بنود التحميل غير صالحة (كل بند: productId وqtyMilli أكبر من صفر)')

    let date: Date | undefined
    if (body.date !== undefined && body.date !== null) {
      const s = String(body.date)
      date = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s)
      if (isNaN(date.getTime())) return fail(400, 'تاريخ الجولة غير صالح')
    }

    try {
      const trip = await db.$transaction(async tx => {
        const rep = await tx.distributionRep.findUnique({ where: { id: repId } })
        if (!rep) throw new BizError(404, 'المندوب غير موجود')
        if (!rep.active) throw new BizError(409, 'المندوب غير مفعل')
        if (routeId) {
          const route = await tx.distributionRoute.findUnique({ where: { id: routeId } })
          if (!route) throw new BizError(404, 'خط التوزيع غير موجود')
        }

        const tripNo = await txNextNumber(tx, 'TRP')
        const created = await tx.distributionTrip.create({
          data: {
            tripNo,
            repId,
            routeId: routeId ?? undefined,
            date,
            status: 'OPEN',
            userId: r.user.id,
          },
        })
        await loadItems(tx, created.id, tripNo, loads, r.user.id)
        return tx.distributionTrip.findUnique({
          where: { id: created.id },
          include: { rep: { select: { id: true, name: true } }, loads: true },
        })
      })

      await audit({ userId: r.user.id, username: r.user.username, action: 'TRIP', entityType: 'DistributionTrip', entityId: trip?.id, details: { tripNo: trip?.tripNo, repId, loadsCount: loads.length, loadedMilli: loads.reduce((s, l) => s + l.qtyMilli, 0) } })
      return ok(trip)
    } catch (e) {
      if (e instanceof BizError) return fail(e.status, e.message)
      throw e
    }
  })
}

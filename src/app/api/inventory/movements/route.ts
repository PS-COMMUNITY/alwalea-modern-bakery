import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { resolveRange, pagination, MOVEMENT_TYPES } from '../../_lib/bakery'

export const dynamic = 'force-dynamic'

/** GET /api/inventory/movements — سجل حركات المخزون مع فلاتر وترقيم صفحات (مصادقة فقط) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const url = new URL(req.url)

    const range = resolveRange(url)
    if (range.error) return fail(400, range.error)

    const where: Record<string, unknown> = {}
    if (range.from || range.to) {
      where.date = {}
      if (range.from) (where.date as Record<string, Date>).gte = range.from
      if (range.to) (where.date as Record<string, Date>).lte = range.to
    }
    const productId = str(url.searchParams.get('productId') ?? '', 50)
    if (productId) where.productId = productId
    const type = url.searchParams.get('type')
    if (type) {
      if (!MOVEMENT_TYPES.includes(type as (typeof MOVEMENT_TYPES)[number])) return fail(400, 'نوع الحركة غير صالح')
      where.type = type
    }

    const { page, pageSize, skip, take } = pagination(url)
    const [rows, total] = await Promise.all([
      db.stockMovement.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        include: { product: { select: { id: true, name: true, baseUnit: true } } },
      }),
      db.stockMovement.count({ where }),
    ])

    return ok({ items: rows, total, page, pageSize })
  })
}

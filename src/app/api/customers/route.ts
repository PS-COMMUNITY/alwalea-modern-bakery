import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/customers — بحث وفلترة مع دين كل عميل (مصادقة فقط) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const url = new URL(req.url)

    const where: Record<string, unknown> = {}
    const q = str(url.searchParams.get('q') ?? '', 100)
    if (q) where.OR = [{ name: { contains: q } }, { phone: { contains: q } }]
    const active = url.searchParams.get('active')
    if (active === 'true') where.active = true
    if (active === 'false') where.active = false

    const customers = await db.customer.findMany({ where, orderBy: { name: 'asc' } })
    const ids = customers.map(c => c.id)
    const sums = ids.length
      ? await db.customerLedgerEntry.groupBy({ by: ['customerId'], where: { customerId: { in: ids } }, _sum: { amountMinor: true } })
      : []
    const debtMap = new Map(sums.map(s => [s.customerId, s._sum.amountMinor ?? 0]))

    const items = customers.map(c => ({ ...c, debtMinor: debtMap.get(c.id) ?? 0 }))
    return ok({ items, total: items.length })
  })
}

/** POST /api/customers — إضافة عميل (perm: customers.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'customers.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const name = str(body.name, 200)
    if (!name) return fail(400, 'اسم العميل مطلوب')

    const data: {
      name: string
      phone?: string
      address?: string
      notes?: string
      creditLimitMinor?: number
      defaultPriceType?: string
    } = { name }
    const phone = str(body.phone, 30)
    if (phone) data.phone = phone
    const address = str(body.address, 300)
    if (address) data.address = address
    const notes = str(body.notes, 500)
    if (notes) data.notes = notes

    if ('creditLimitMinor' in body && body.creditLimitMinor !== null) {
      const limit = int(body.creditLimitMinor)
      if (limit === null) return fail(400, 'حد الائتمان يجب أن يكون عددًا صحيحًا ≥ 0')
      data.creditLimitMinor = limit
    }
    if ('defaultPriceType' in body && body.defaultPriceType !== null) {
      if (body.defaultPriceType !== 'RETAIL' && body.defaultPriceType !== 'WHOLESALE') {
        return fail(400, 'نوع السعر الافتراضي يجب أن يكون RETAIL أو WHOLESALE')
      }
      data.defaultPriceType = body.defaultPriceType
    }

    const created = await db.customer.create({ data })
    return ok(created)
  })
}

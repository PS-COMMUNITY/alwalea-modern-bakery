import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/suppliers — بحث وفلترة مع مستحقات كل مورد (perm: suppliers.view) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'suppliers.view')
    if ('response' in r) return r.response
    const url = new URL(req.url)

    const where: Record<string, unknown> = {}
    const q = str(url.searchParams.get('q') ?? '', 100)
    if (q) where.OR = [{ name: { contains: q } }, { phone: { contains: q } }]
    const active = url.searchParams.get('active')
    if (active === 'true') where.active = true
    if (active === 'false') where.active = false

    const suppliers = await db.supplier.findMany({ where, orderBy: { name: 'asc' } })
    const ids = suppliers.map(s => s.id)
    const sums = ids.length
      ? await db.supplierLedgerEntry.groupBy({ by: ['supplierId'], where: { supplierId: { in: ids } }, _sum: { amountMinor: true } })
      : []
    const dueMap = new Map(sums.map(s => [s.supplierId, s._sum.amountMinor ?? 0]))

    const items = suppliers.map(s => ({ ...s, dueMinor: dueMap.get(s.id) ?? 0 }))
    return ok({ items, total: items.length })
  })
}

/** POST /api/suppliers — إضافة مورد (perm: suppliers.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'suppliers.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const name = str(body.name, 200)
    if (!name) return fail(400, 'اسم المورد مطلوب')

    const data: {
      name: string
      phone?: string
      address?: string
      notes?: string
    } = { name }
    const phone = str(body.phone, 30)
    if (phone) data.phone = phone
    const address = str(body.address, 300)
    if (address) data.address = address
    const notes = str(body.notes, 500)
    if (notes) data.notes = notes

    const created = await db.supplier.create({ data })
    return ok(created)
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'
import { customerDebtMinor } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** GET /api/customers/[id] — بطاقة عميل مع الدين الحالي (مصادقة فقط) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const { id } = await params
    const customer = await db.customer.findUnique({ where: { id } })
    if (!customer) return fail(404, 'العميل غير موجود')

    const [debtMinor, recentEntries] = await Promise.all([
      customerDebtMinor(id),
      db.customerLedgerEntry.findMany({ where: { customerId: id }, orderBy: { date: 'desc' }, take: 20 }),
    ])

    return ok({ customer, debtMinor, recentEntries })
  })
}

/** PUT /api/customers/[id] — تعديل بيانات عميل / تعطيل (لا حذف نهائي) (perm: customers.manage) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'customers.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const customer = await db.customer.findUnique({ where: { id } })
    if (!customer) return fail(404, 'العميل غير موجود')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const data: Record<string, unknown> = {}
    if ('name' in body) {
      const name = str(body.name, 200)
      if (!name) return fail(400, 'اسم العميل مطلوب')
      data.name = name
    }
    if ('phone' in body) data.phone = body.phone === null ? null : str(body.phone, 30)
    if ('address' in body) data.address = body.address === null ? null : str(body.address, 300)
    if ('notes' in body) data.notes = body.notes === null ? null : str(body.notes, 500)
    if ('creditLimitMinor' in body) {
      if (body.creditLimitMinor === null) data.creditLimitMinor = null
      else {
        const limit = int(body.creditLimitMinor)
        if (limit === null) return fail(400, 'حد الائتمان يجب أن يكون عددًا صحيحًا ≥ 0')
        data.creditLimitMinor = limit
      }
    }
    if ('defaultPriceType' in body && body.defaultPriceType !== null) {
      if (body.defaultPriceType !== 'RETAIL' && body.defaultPriceType !== 'WHOLESALE') {
        return fail(400, 'نوع السعر الافتراضي يجب أن يكون RETAIL أو WHOLESALE')
      }
      data.defaultPriceType = body.defaultPriceType
    }
    if (typeof body.active === 'boolean') data.active = body.active

    const updated = await db.customer.update({ where: { id }, data })
    return ok(updated)
  })
}

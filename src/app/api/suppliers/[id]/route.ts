import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { supplierDueMinor } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** GET /api/suppliers/[id] — بطاقة مورد مع المستحقات الحالية (perm: suppliers.view) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'suppliers.view')
    if ('response' in r) return r.response
    const { id } = await params
    const supplier = await db.supplier.findUnique({ where: { id } })
    if (!supplier) return fail(404, 'المورد غير موجود')

    const [dueMinor, recentEntries] = await Promise.all([
      supplierDueMinor(id),
      db.supplierLedgerEntry.findMany({ where: { supplierId: id }, orderBy: { date: 'desc' }, take: 20 }),
    ])

    return ok({ supplier, dueMinor, recentEntries })
  })
}

/** PUT /api/suppliers/[id] — تعديل بيانات مورد / تعطيل (لا حذف نهائي) (perm: suppliers.manage) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'suppliers.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const supplier = await db.supplier.findUnique({ where: { id } })
    if (!supplier) return fail(404, 'المورد غير موجود')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const data: Record<string, unknown> = {}
    if ('name' in body) {
      const name = str(body.name, 200)
      if (!name) return fail(400, 'اسم المورد مطلوب')
      data.name = name
    }
    if ('phone' in body) data.phone = body.phone === null ? null : str(body.phone, 30)
    if ('address' in body) data.address = body.address === null ? null : str(body.address, 300)
    if ('notes' in body) data.notes = body.notes === null ? null : str(body.notes, 500)
    if (typeof body.active === 'boolean') data.active = body.active

    const updated = await db.supplier.update({ where: { id }, data })
    return ok(updated)
  })
}

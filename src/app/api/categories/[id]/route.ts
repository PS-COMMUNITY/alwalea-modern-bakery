import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** PUT /api/categories/[id] — تعديل اسم/تفعيل تصنيف (perm: categories.manage) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'categories.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const category = await db.category.findUnique({ where: { id } })
    if (!category) return fail(404, 'التصنيف غير موجود')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const data: { name?: string; active?: boolean } = {}
    if ('name' in body) {
      const name = str(body.name, 120)
      if (!name) return fail(400, 'اسم التصنيف مطلوب')
      if (name !== category.name) {
        const exists = await db.category.findUnique({ where: { name } })
        if (exists) return fail(409, 'اسم التصنيف موجود مسبقًا')
      }
      data.name = name
    }
    if (typeof body.active === 'boolean') data.active = body.active

    const updated = await db.category.update({ where: { id }, data })
    return ok(updated)
  })
}

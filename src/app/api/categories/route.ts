import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/categories — قائمة التصنيفات مع عدد المنتجات (مصادقة فقط) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const url = new URL(req.url)
    const active = url.searchParams.get('active')
    const where = active === 'true' ? { active: true } : active === 'false' ? { active: false } : {}
    const [items, total] = await Promise.all([
      db.category.findMany({
        where,
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: true } } },
      }),
      db.category.count({ where }),
    ])
    return ok({ items, total })
  })
}

/** POST /api/categories — إضافة تصنيف (perm: categories.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'categories.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const name = str(body.name, 120)
    if (!name) return fail(400, 'اسم التصنيف مطلوب')
    const exists = await db.category.findUnique({ where: { name } })
    if (exists) return fail(409, 'اسم التصنيف موجود مسبقًا')
    const created = await db.category.create({ data: { name } })
    return ok(created)
  })
}

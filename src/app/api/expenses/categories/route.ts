import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** GET /api/expenses/categories — تصنيفات المصروفات */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'expenses.view')
    if ('response' in r) return r.response
    const categories = await db.expenseCategory.findMany({
      include: { _count: { select: { expenses: true } } },
      orderBy: { name: 'asc' },
    })
    return ok(categories)
  })
}

/** POST /api/expenses/categories — إضافة تصنيف (صلاحية: expenses.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'expenses.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const name = str(body.name, 120)
    if (!name) return fail(400, 'اسم التصنيف مطلوب')
    const category = await db.expenseCategory.create({ data: { name } })
    await audit({ userId: r.user.id, username: r.user.username, action: 'EXPENSE_CATEGORY_CREATE', entityType: 'ExpenseCategory', entityId: category.id, details: { name } })
    return ok(category)
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/sales/[id] — فاتورة كاملة مع البنود والمدفوعات واسم المستخدم (مصادقة فقط) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const { id } = await params

    const sale = await db.sale.findUnique({ where: { id }, include: { items: true, payments: true } })
    if (!sale) return fail(404, 'الفاتورة غير موجودة')

    const creator = await db.user.findUnique({
      where: { id: sale.userId },
      select: { id: true, username: true, displayName: true },
    })

    return ok({ ...sale, user: creator })
  })
}

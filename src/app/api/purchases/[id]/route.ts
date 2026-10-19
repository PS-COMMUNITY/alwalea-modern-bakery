import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/purchases/[id] — فاتورة شراء كاملة مع البنود والمدفوعات (مصادقة فقط) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const { id } = await params

    const purchase = await db.purchase.findUnique({ where: { id }, include: { items: true, payments: true } })
    if (!purchase) return fail(404, 'فاتورة الشراء غير موجودة')

    const creator = await db.user.findUnique({
      where: { id: purchase.userId },
      select: { id: true, username: true, displayName: true },
    })

    return ok({ ...purchase, user: creator })
  })
}

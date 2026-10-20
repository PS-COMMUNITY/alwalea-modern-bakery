import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, hashPassword, ok, requirePerm } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** تعيين أو إزالة PIN اختياري للمستخدم (لنفسه أو المالك لأي مستخدم) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const { id } = await params
    const isSelf = r.user.id === id
    if (!isSelf && r.user.role !== 'OWNER') return fail(403, 'ليس لديك صلاحية لتعديل PIN مستخدم آخر')

    const body = await req.json().catch(() => null)
    const pin = body && typeof body.pin === 'string' ? body.pin : null

    const user = await db.user.findUnique({ where: { id } })
    if (!user) return fail(404, 'المستخدم غير موجود')

    if (!pin || pin === '') {
      await db.user.update({ where: { id }, data: { pinHash: null, pinSalt: null } })
      await audit({ userId: r.user.id, username: r.user.username, action: 'USER_UPDATE', entityType: 'User', entityId: id, details: { pinRemoved: true } })
      return ok({ pinSet: false })
    }
    if (!/^\d{4,8}$/.test(pin)) return fail(400, 'PIN يجب أن يكون من 4 إلى 8 أرقام')

    const { hash, salt } = hashPassword(pin)
    await db.user.update({ where: { id }, data: { pinHash: hash, pinSalt: salt } })
    await audit({ userId: r.user.id, username: r.user.username, action: 'USER_UPDATE', entityType: 'User', entityId: id, details: { pinSet: true } })
    return ok({ pinSet: true })
  })
}

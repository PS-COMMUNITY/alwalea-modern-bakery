import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, hashPassword, ok, requirePerm, verifyPassword } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** تغيير كلمة المرور: المالك لأي مستخدم، والمستخدم لنفسه */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const { id } = await params
    const isSelf = r.user.id === id
    if (!isSelf && r.user.role !== 'OWNER') return fail(403, 'ليس لديك صلاحية لتغيير كلمة مرور مستخدم آخر')

    const body = await req.json().catch(() => null)
    const newPassword = body && typeof body.newPassword === 'string' ? body.newPassword : ''
    if (newPassword.length < 4) return fail(400, 'كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف/أرقام')

    const user = await db.user.findUnique({ where: { id } })
    if (!user) return fail(404, 'المستخدم غير موجود')

    if (isSelf) {
      const current = body && typeof body.currentPassword === 'string' ? body.currentPassword : ''
      if (!verifyPassword(current, user.passwordHash, user.passwordSalt)) return fail(401, 'كلمة المرور الحالية غير صحيحة')
    }

    const { hash, salt } = hashPassword(newPassword)
    await db.user.update({ where: { id }, data: { passwordHash: hash, passwordSalt: salt, failedAttempts: 0, lockedUntil: null } })
    await db.session.deleteMany({ where: { userId: id } })
    await audit({ userId: r.user.id, username: r.user.username, action: 'USER_UPDATE', entityType: 'User', entityId: id, details: { passwordChanged: true, self: isSelf } })
    return ok()
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, hashPassword, ok, requirePerm, str } from '@/lib/bakery/auth'
import { ROLES } from '@/lib/bakery/permissions'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'users.manage')
    if ('response' in r) return r.response
    const users = await db.user.findMany({
      select: { id: true, username: true, displayName: true, role: true, active: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return ok(users)
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'users.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const username = str(body.username, 60)
    const displayName = str(body.displayName, 120)
    const role = str(body.role, 20)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!username || !/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) return fail(400, 'اسم المستخدم مطلوب (حروف إنجليزية وأرقام، 3 أحرف على الأقل)')
    if (!displayName) return fail(400, 'الاسم المعروض مطلوب')
    if (!role || !ROLES.includes(role as never)) return fail(400, 'الدور غير صالح')
    if (password.length < 4) return fail(400, 'كلمة المرور يجب ألا تقل عن 4 أحرف/أرقام')
    const dup = await db.user.findUnique({ where: { username } })
    if (dup) return fail(409, 'اسم المستخدم موجود مسبقًا')

    const { hash, salt } = hashPassword(password)
    const user = await db.user.create({ data: { username, displayName, role, passwordHash: hash, passwordSalt: salt } })
    await audit({ userId: r.user.id, username: r.user.username, action: 'USER_CREATE', entityType: 'User', entityId: user.id, details: { newUsername: username, role } })
    return ok({ id: user.id, username: user.username, displayName: user.displayName, role: user.role })
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, fail, handle, ok, SESSION_COOKIE, str, verifyPassword } from '@/lib/bakery/auth'
import { audit, getSettings } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json().catch(() => null)
    const username = body ? str(body.username, 60) : null
    const password = body && typeof body.password === 'string' ? body.password : ''
    if (!username || !password) return fail(400, 'اسم المستخدم وكلمة المرور مطلوبان')

    const s = await getSettings()
    if (!s.setupCompleted) return fail(409, 'يجب إكمال التهيئة أولًا')

    const user = await db.user.findUnique({ where: { username } })
    // رسالة عامة عمدًا (لا نكشف أيهما خاطئ)
    const genericFail = () => fail(401, 'بيانات الدخول غير صحيحة')
    if (!user || !user.active) {
      await audit({ username: username ?? undefined, action: 'LOGIN_FAILED', details: { reason: 'user_not_found_or_inactive' } })
      return genericFail()
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      return fail(423, `الحساب مقفل مؤقتًا، أعد المحاولة بعد ${mins} دقيقة`)
    }

    if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      const failed = user.failedAttempts + 1
      const lockedUntil = failed >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null
      await db.user.update({ where: { id: user.id }, data: { failedAttempts: lockedUntil ? 0 : failed, lockedUntil } })
      await audit({ userId: user.id, username, action: 'LOGIN_FAILED', details: { failedAttempts: failed, locked: !!lockedUntil } })
      if (lockedUntil) return fail(423, `تم قفل الحساب مؤقتًا بسبب تكرار المحاولات الفاشلة (${LOCK_MINUTES} دقائق)`)
      return genericFail()
    }

    await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } })
    const token = await createSession(user.id)
    await audit({ userId: user.id, username, action: 'LOGIN' })

    const res = ok({ id: user.id, username: user.username, displayName: user.displayName, role: user.role })
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 12 * 3600 })
    return res
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, fail, handle, ok, SESSION_COOKIE, verifyPassword } from '@/lib/bakery/auth'
import { audit, getSettings } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

/**
 * الدخول بكلمة مرور واحدة (وضع الحساب الواحد).
 * يُربط الجلسة دائمًا بحساب المالك النشط — لا اسم مستخدم ولا اختيار أدوار.
 * كلمة المرور تُتحقق مقابل التجزئة المخزنة (scrypt + salt مستقل) فقط، بلا أي كلمات ثابتة في الشيفرة.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json().catch(() => null)
    const password = body && typeof body.password === 'string' ? body.password : ''
    if (!password) return fail(400, 'كلمة المرور مطلوبة')

    const s = await getSettings()
    if (!s.setupCompleted) return fail(409, 'يجب إكمال التهيئة أولًا')

    // وضع الحساب الواحد: المالك النشط (الأحدث دخولًا إن وُجد أكثر من واحد)،
    // وإن لم يوجد مالك: المستخدم النشط الوحيد.
    const owners = await db.user.findMany({
      where: { role: 'OWNER', active: true },
      orderBy: [{ lastLoginAt: 'desc' }, { createdAt: 'asc' }],
      take: 1,
    })
    let user = owners[0] ?? null
    if (!user) {
      const singles = await db.user.findMany({
        where: { active: true },
        orderBy: { createdAt: 'asc' },
      })
      if (singles.length === 1) user = singles[0]
    }
    if (!user) return fail(409, 'تعذر تحديد حساب المالك — أعد التهيئة أو أنشئ حساب مالك من إدارة المستخدمين')

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      return fail(423, `الحساب مقفل مؤقتًا، أعد المحاولة بعد ${mins} دقيقة`)
    }

    if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      const failed = user.failedAttempts + 1
      const lockedUntil = failed >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null
      await db.user.update({ where: { id: user.id }, data: { failedAttempts: lockedUntil ? 0 : failed, lockedUntil } })
      await audit({ userId: user.id, username: user.username, action: 'LOGIN_FAILED', details: { failedAttempts: failed, locked: !!lockedUntil } })
      if (lockedUntil) return fail(423, `تم قفل الحساب مؤقتًا بسبب تكرار المحاولات الفاشلة (${LOCK_MINUTES} دقائق)`)
      return fail(401, 'كلمة المرور غير صحيحة — حاول مرة أخرى')
    }

    await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } })
    const token = await createSession(user.id)
    await audit({ userId: user.id, username: user.username, action: 'LOGIN' })

    const res = ok({ id: user.id, username: user.username, displayName: user.displayName, role: user.role })
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 12 * 3600 })
    return res
  })
}

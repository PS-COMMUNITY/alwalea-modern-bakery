import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, fail, handle, hashPassword, ok, SESSION_COOKIE, str } from '@/lib/bakery/auth'
import { audit, getSettings } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** تهيئة أول تشغيل: بيانات النشاط + حساب المالك (مرة واحدة فقط) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const s = await getSettings()
    const userCount = await db.user.count()
    if (s.setupCompleted && userCount > 0) return fail(409, 'تمت التهيئة مسبقًا')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const businessName = str(body.businessName, 120) ?? 'مخبز الولاء الحديث'
    const ownerName = str(body.ownerName, 120)
    const username = str(body.username, 60)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!username || !/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) return fail(400, 'اسم المستخدم مطلوب (حروف إنجليزية وأرقام، 3 أحرف على الأقل)')
    if (password.length < 8) return fail(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')

    const dup = await db.user.findUnique({ where: { username } })
    if (dup) return fail(409, 'اسم المستخدم موجود مسبقًا')

    const { hash, salt } = hashPassword(password)
    const user = await db.user.create({
      data: { username, displayName: ownerName ?? 'المالك', role: 'OWNER', passwordHash: hash, passwordSalt: salt },
    })

    await db.settings.update({
      where: { id: 1 },
      data: {
        businessName,
        ownerName,
        phone: str(body.phone, 30),
        address: str(body.address, 300),
        currencyCode: str(body.currencyCode, 8) ?? 'ILS',
        currencySymbol: str(body.currencySymbol, 8) ?? '₪',
        setupCompleted: true,
      },
    })

    await audit({ userId: user.id, username, action: 'SETUP', entityType: 'Settings', entityId: '1', details: { businessName } })

    const token = await createSession(user.id)
    const res = ok({ userId: user.id, displayName: user.displayName, role: user.role })
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 12 * 3600 })
    return res
  })
}

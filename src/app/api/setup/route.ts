import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, fail, handle, hashPassword, ok, SESSION_COOKIE, str } from '@/lib/bakery/auth'
import { audit, getSettings } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** كلمة المرور الأولية الافتراضية عند التهيئة (للتطوير وأول تشغيل) — تُخزَّن مُلبَّدة فورًا ويمكن تغييرها من الإعدادات */
export const DEFAULT_INITIAL_PASSWORD = '1234'
/** الحد الأدنى لكلمة المرور: 4 أرقام/أحرف (يُسمح بـ 1234) */
export const MIN_PASSWORD_LENGTH = 4

/** تهيئة أول تشغيل: بيانات النشاط + حساب المالك (مرة واحدة فقط) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const s = await getSettings()
    const userCount = await db.user.count()
    if (s.setupCompleted && userCount > 0) return fail(409, 'تمت التهيئة مسبقًا')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const businessName = str(body.businessName, 120) ?? 'مخبز الولاء الحديث'
    const ownerName = str(body.ownerName, 120) ?? 'المالك'
    // وضع الحساب الواحد: اسم المستخدم يُنشأ تلقائيًا (لا يُطلب من المستخدم)
    const username = str(body.username, 60) ?? 'owner'
    const password = typeof body.password === 'string' && body.password.length > 0 ? body.password : DEFAULT_INITIAL_PASSWORD
    if (password.length < MIN_PASSWORD_LENGTH) return fail(400, 'كلمة المرور يجب ألا تقل عن 4 أحرف/أرقام')

    if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) return fail(400, 'اسم المستخدم غير صالح')
    const dup = await db.user.findUnique({ where: { username } })
    if (dup) return fail(409, 'اسم المستخدم موجود مسبقًا')

    const { hash, salt } = hashPassword(password)
    const user = await db.user.create({
      data: { username, displayName: ownerName, role: 'OWNER', passwordHash: hash, passwordSalt: salt },
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

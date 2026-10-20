import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit, getSettings } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const s = await getSettings()
    return ok(s)
  })
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'settings.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const data: Record<string, unknown> = {}
    const businessName = str(body.businessName, 120)
    if (businessName) data.businessName = businessName
    if ('ownerName' in body) data.ownerName = str(body.ownerName, 120)
    if ('phone' in body) data.phone = str(body.phone, 30)
    if ('address' in body) data.address = str(body.address, 300)
    const currencyCode = str(body.currencyCode, 8)
    if (currencyCode) data.currencyCode = currencyCode
    const currencySymbol = str(body.currencySymbol, 8)
    if (currencySymbol) data.currencySymbol = currencySymbol
    if (typeof body.taxEnabled === 'boolean') data.taxEnabled = body.taxEnabled
    // التحقق الصريح: القيمة الحاضرة وغير الصالحة تُرفض برسالة عربية واضحة (لا تجاهل صامت)
    if ('taxRateBp' in body && body.taxRateBp !== null && body.taxRateBp !== undefined) {
      const v = body.taxRateBp
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10000)
        return fail(400, 'نسبة الضريبة غير صالحة (عدد صحيح من 0 إلى 10000 نقطة أساس — مثال: 1700 = 17%)')
      data.taxRateBp = v
    }
    if (typeof body.negativeStockAllowed === 'boolean') data.negativeStockAllowed = body.negativeStockAllowed
    if ('receiptWidth' in body && body.receiptWidth !== null && body.receiptWidth !== undefined) {
      const v = body.receiptWidth
      if (typeof v !== 'number' || ![58, 80].includes(v))
        return fail(400, 'عرض الإيصال يجب أن يكون 58 أو 80 مم')
      data.receiptWidth = v
    }
    if ('idleLockMinutes' in body && body.idleLockMinutes !== null && body.idleLockMinutes !== undefined) {
      const v = body.idleLockMinutes
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 240)
        return fail(400, 'مدة القفل التلقائي غير صالحة (من 1 إلى 240 دقيقة)')
      data.idleLockMinutes = v
    }
    if (typeof body.requireCustomerForCredit === 'boolean') data.requireCustomerForCredit = body.requireCustomerForCredit

    const s = await db.settings.update({ where: { id: 1 }, data })
    await audit({ userId: r.user.id, username: r.user.username, action: 'SETTINGS_UPDATE', entityType: 'Settings', entityId: '1', details: data })
    return ok(s)
  })
}

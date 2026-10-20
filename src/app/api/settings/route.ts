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
    if (typeof body.taxRateBp === 'number' && Number.isInteger(body.taxRateBp) && body.taxRateBp >= 0 && body.taxRateBp <= 10000) data.taxRateBp = body.taxRateBp
    if (typeof body.negativeStockAllowed === 'boolean') data.negativeStockAllowed = body.negativeStockAllowed
    if (typeof body.receiptWidth === 'number' && [58, 80].includes(body.receiptWidth)) data.receiptWidth = body.receiptWidth
    if (typeof body.idleLockMinutes === 'number' && Number.isInteger(body.idleLockMinutes) && body.idleLockMinutes >= 1 && body.idleLockMinutes <= 240) data.idleLockMinutes = body.idleLockMinutes
    if (typeof body.requireCustomerForCredit === 'boolean') data.requireCustomerForCredit = body.requireCustomerForCredit

    const s = await db.settings.update({ where: { id: 1 }, data })
    await audit({ userId: r.user.id, username: r.user.username, action: 'SETTINGS_UPDATE', entityType: 'Settings', entityId: '1', details: data })
    return ok(s)
  })
}

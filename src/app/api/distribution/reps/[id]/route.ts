import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** PUT /api/distribution/reps/[id] — تعديل مندوب (الاسم/الهاتف/التفعيل) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const rep = await db.distributionRep.findUnique({ where: { id } })
    if (!rep) return fail(404, 'المندوب غير موجود')
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const data: Record<string, unknown> = {}
    const name = str(body.name, 120)
    if (name) data.name = name
    if ('phone' in body) data.phone = str(body.phone, 30)
    if (typeof body.active === 'boolean') data.active = body.active

    const updated = await db.distributionRep.update({ where: { id }, data })
    await audit({ userId: r.user.id, username: r.user.username, action: 'REP_UPDATE', entityType: 'DistributionRep', entityId: id, details: data })
    return ok(updated)
  })
}

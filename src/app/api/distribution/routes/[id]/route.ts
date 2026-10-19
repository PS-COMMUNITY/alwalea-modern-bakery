import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** PUT /api/distribution/routes/[id] — تعديل خط توزيع */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const route = await db.distributionRoute.findUnique({ where: { id } })
    if (!route) return fail(404, 'الخط غير موجود')
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const data: Record<string, unknown> = {}
    const name = str(body.name, 120)
    if (name) data.name = name
    if (typeof body.active === 'boolean') data.active = body.active
    if ('repId' in body) {
      const repId = str(body.repId, 60)
      if (repId) {
        const rep = await db.distributionRep.findUnique({ where: { id: repId } })
        if (!rep) return fail(404, 'المندوب غير موجود')
      }
      data.repId = repId // null لإزالة الربط
    }

    const updated = await db.distributionRoute.update({ where: { id }, data })
    await audit({ userId: r.user.id, username: r.user.username, action: 'ROUTE_UPDATE', entityType: 'DistributionRoute', entityId: id, details: data })
    return ok(updated)
  })
}

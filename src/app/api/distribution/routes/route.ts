import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** GET /api/distribution/routes — قائمة خطوط التوزيع */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.view')
    if ('response' in r) return r.response
    const routes = await db.distributionRoute.findMany({
      include: { rep: { select: { id: true, name: true, active: true } } },
      orderBy: { name: 'asc' },
    })
    return ok(routes)
  })
}

/** POST /api/distribution/routes — إضافة خط توزيع (صلاحية: distribution.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const name = str(body.name, 120)
    if (!name) return fail(400, 'اسم الخط مطلوب')
    const repId = str(body.repId, 60)
    if (repId) {
      const rep = await db.distributionRep.findUnique({ where: { id: repId } })
      if (!rep) return fail(404, 'المندوب غير موجود')
    }
    const route = await db.distributionRoute.create({ data: { name, repId: repId ?? undefined } })
    await audit({ userId: r.user.id, username: r.user.username, action: 'ROUTE_CREATE', entityType: 'DistributionRoute', entityId: route.id, details: { name, repId } })
    return ok(route)
  })
}

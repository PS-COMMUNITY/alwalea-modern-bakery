import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** GET /api/distribution/reps — قائمة مندوبي التوزيع */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.view')
    if ('response' in r) return r.response
    const reps = await db.distributionRep.findMany({
      include: { routes: { select: { id: true, name: true, active: true } } },
      orderBy: { name: 'asc' },
    })
    return ok(reps)
  })
}

/** POST /api/distribution/reps — إضافة مندوب (صلاحية: distribution.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const name = str(body.name, 120)
    if (!name) return fail(400, 'اسم المندوب مطلوب')
    const rep = await db.distributionRep.create({ data: { name, phone: str(body.phone, 30) ?? undefined } })
    await audit({ userId: r.user.id, username: r.user.username, action: 'REP_CREATE', entityType: 'DistributionRep', entityId: rep.id, details: { name } })
    return ok(rep)
  })
}

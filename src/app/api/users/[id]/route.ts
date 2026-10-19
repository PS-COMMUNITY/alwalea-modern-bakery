import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { ROLES } from '@/lib/bakery/permissions'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** تعديل بيانات مستخدم: الاسم، الدور، التفعيل/التعطيل (لا حذف نهائي) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'users.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const user = await db.user.findUnique({ where: { id } })
    if (!user) return fail(404, 'المستخدم غير موجود')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const data: Record<string, unknown> = {}
    const displayName = str(body.displayName, 120)
    if (displayName) data.displayName = displayName
    if (typeof body.role === 'string') {
      if (!ROLES.includes(body.role as never)) return fail(400, 'الدور غير صالح')
      if (user.role === 'OWNER' && body.role !== 'OWNER') {
        const owners = await db.user.count({ where: { role: 'OWNER', active: true } })
        if (owners <= 1) return fail(409, 'لا يمكن إزالة دور المالك من آخر مالك نشط')
      }
      data.role = body.role
    }
    if (typeof body.active === 'boolean') {
      if (!body.active && user.id === r.user.id) return fail(400, 'لا يمكنك تعطيل حسابك الحالي')
      if (!body.active && user.role === 'OWNER') {
        const owners = await db.user.count({ where: { role: 'OWNER', active: true } })
        if (owners <= 1) return fail(409, 'لا يمكن تعطيل آخر مالك نشط')
      }
      data.active = body.active
      if (!body.active) await db.session.deleteMany({ where: { userId: id } })
    }

    const updated = await db.user.update({ where: { id }, data, select: { id: true, username: true, displayName: true, role: true, active: true } })
    await audit({ userId: r.user.id, username: r.user.username, action: 'USER_UPDATE', entityType: 'User', entityId: id, details: data })
    return ok(updated)
  })
}

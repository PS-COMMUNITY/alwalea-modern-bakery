import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/audit — سجل التدقيق (صلاحية: audit.view) فلاتر from/to/action/userId مع ترقيم */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'audit.view')
    if ('response' in r) return r.response
    const sp = req.nextUrl.searchParams

    const where: { date?: { gte?: Date; lte?: Date }; action?: string; userId?: string } = {}
    const fromS = sp.get('from'), toS = sp.get('to')
    if (fromS) {
      const d = new Date(`${fromS}T00:00:00`)
      if (isNaN(d.getTime())) return fail(400, 'تاريخ البداية غير صالح')
      where.date = { gte: d }
    }
    if (toS) {
      const d = new Date(`${toS}T23:59:59.999`)
      if (isNaN(d.getTime())) return fail(400, 'تاريخ النهاية غير صالح')
      where.date = { ...(where.date ?? {}), lte: d }
    }
    const action = sp.get('action')
    if (action) where.action = action
    const userId = sp.get('userId')
    if (userId) where.userId = userId

    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

    const [total, items] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return ok({ items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) })
  })
}

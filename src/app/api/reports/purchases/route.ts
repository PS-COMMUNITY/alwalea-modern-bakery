import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** GET /api/reports/purchases?from&to — مشتريات الفترة يوميًا وحسب المورد (reports.financial) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'reports.financial')
    if ('response' in r) return r.response
    const sp = req.nextUrl.searchParams
    const where: { date?: { gte?: Date; lte?: Date }; status?: string } = { status: 'COMPLETED' }
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

    const purchases = await db.purchase.findMany({
      where,
      select: { id: true, date: true, supplierId: true, supplierName: true, subtotalMinor: true, discountMinor: true, totalMinor: true, paidMinor: true },
    })

    const dayMap = new Map<string, { subtotalMinor: number; discountMinor: number; totalMinor: number; invoicesCount: number }>()
    const supMap = new Map<string, { supplierId: string; supplierName: string; invoicesCount: number; totalMinor: number; paidMinor: number }>()
    for (const p of purchases) {
      const dk = dayKey(p.date)
      const d = dayMap.get(dk) ?? { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, invoicesCount: 0 }
      d.subtotalMinor += p.subtotalMinor
      d.discountMinor += p.discountMinor
      d.totalMinor += p.totalMinor
      d.invoicesCount += 1
      dayMap.set(dk, d)

      const s = supMap.get(p.supplierId) ?? { supplierId: p.supplierId, supplierName: p.supplierName, invoicesCount: 0, totalMinor: 0, paidMinor: 0 }
      s.invoicesCount += 1
      s.totalMinor += p.totalMinor
      s.paidMinor += p.paidMinor
      supMap.set(p.supplierId, s)
    }

    const daily = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }))
    const bySupplier = [...supMap.values()].sort((a, b) => b.totalMinor - a.totalMinor)
    const totals = {
      invoicesCount: purchases.length,
      subtotalMinor: purchases.reduce((s, x) => s + x.subtotalMinor, 0),
      discountMinor: purchases.reduce((s, x) => s + x.discountMinor, 0),
      totalMinor: purchases.reduce((s, x) => s + x.totalMinor, 0),
      paidMinor: purchases.reduce((s, x) => s + x.paidMinor, 0),
    }

    return ok({ totals, daily, bySupplier })
  })
}

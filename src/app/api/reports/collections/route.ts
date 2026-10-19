import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** GET /api/reports/collections?from&to — التحصيلات مجمعة حسب اليوم وطريقة الدفع (reports.financial) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'reports.financial')
    if ('response' in r) return r.response
    const sp = req.nextUrl.searchParams
    const where: { date?: { gte?: Date; lte?: Date } } = {}
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

    const payments = await db.salePayment.findMany({
      where,
      select: { date: true, method: true, amountMinor: true },
    })

    const dayMap = new Map<string, { totalMinor: number; byMethod: Record<string, number> }>()
    const methodTotals: Record<string, number> = {}
    for (const p of payments) {
      const key = dayKey(p.date)
      const cur = dayMap.get(key) ?? { totalMinor: 0, byMethod: {} }
      cur.totalMinor += p.amountMinor
      cur.byMethod[p.method] = (cur.byMethod[p.method] ?? 0) + p.amountMinor
      dayMap.set(key, cur)
      methodTotals[p.method] = (methodTotals[p.method] ?? 0) + p.amountMinor
    }

    const daily = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }))
    const byMethod = Object.entries(methodTotals).map(([method, amountMinor]) => ({ method, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor)
    const totalMinor = payments.reduce((s, p) => s + p.amountMinor, 0)

    return ok({ totalMinor, paymentsCount: payments.length, daily, byMethod })
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** GET /api/reports/expenses?from&to — المصروفات مجمعة حسب اليوم والتصنيف (reports.financial) */
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

    const expenses = await db.expense.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
    })

    const dayMap = new Map<string, { totalMinor: number; count: number }>()
    const catMap = new Map<string, { categoryId: string; categoryName: string; totalMinor: number; count: number }>()
    for (const e of expenses) {
      const dk = dayKey(e.date)
      const d = dayMap.get(dk) ?? { totalMinor: 0, count: 0 }
      d.totalMinor += e.amountMinor
      d.count += 1
      dayMap.set(dk, d)

      const c = catMap.get(e.categoryId) ?? { categoryId: e.categoryId, categoryName: e.category.name, totalMinor: 0, count: 0 }
      c.totalMinor += e.amountMinor
      c.count += 1
      catMap.set(e.categoryId, c)
    }

    const daily = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }))
    const byCategory = [...catMap.values()].sort((a, b) => b.totalMinor - a.totalMinor)
    const totalMinor = expenses.reduce((s, e) => s + e.amountMinor, 0)

    return ok({ totalMinor, count: expenses.length, daily, byCategory })
  })
}

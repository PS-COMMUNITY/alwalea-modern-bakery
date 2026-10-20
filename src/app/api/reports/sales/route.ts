import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * GET /api/reports/sales?from&to — تقرير المبيعات (صلاحية: reports.financial)
 * يوميًا + حسب المنتج + حسب العميل — من الفواتير المكتملة فقط
 */
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

    const sales = await db.sale.findMany({
      where,
      select: { id: true, date: true, customerId: true, customerName: true, subtotalMinor: true, discountMinor: true, taxMinor: true, totalMinor: true, creditMinor: true },
    })
    const saleIds = sales.map(s => s.id)
    const items = saleIds.length
      ? await db.saleItem.findMany({
          where: { saleId: { in: saleIds } },
          select: { productId: true, productName: true, qtyMilli: true, lineTotalMinor: true },
        })
      : []

    // يوميًا
    const dailyMap = new Map<string, { subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; creditMinor: number; invoicesCount: number }>()
    for (const s of sales) {
      const key = dayKey(s.date)
      const cur = dailyMap.get(key) ?? { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, creditMinor: 0, invoicesCount: 0 }
      cur.subtotalMinor += s.subtotalMinor
      cur.discountMinor += s.discountMinor
      cur.taxMinor += s.taxMinor
      cur.totalMinor += s.totalMinor
      cur.creditMinor += s.creditMinor
      cur.invoicesCount += 1
      dailyMap.set(key, cur)
    }
    const daily = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }))

    // حسب المنتج
    const prodMap = new Map<string, { productId: string; productName: string; qtyMilli: number; totalMinor: number }>()
    for (const it of items) {
      const cur = prodMap.get(it.productId) ?? { productId: it.productId, productName: it.productName, qtyMilli: 0, totalMinor: 0 }
      cur.qtyMilli += it.qtyMilli
      cur.totalMinor += it.lineTotalMinor
      prodMap.set(it.productId, cur)
    }
    const byProduct = [...prodMap.values()].sort((a, b) => b.totalMinor - a.totalMinor)

    // حسب العميل
    const custMap = new Map<string, { customerId: string | null; customerName: string; invoicesCount: number; totalMinor: number; creditMinor: number }>()
    for (const s of sales) {
      const key = s.customerId ?? 'cash'
      const cur = custMap.get(key) ?? { customerId: s.customerId, customerName: s.customerName, invoicesCount: 0, totalMinor: 0, creditMinor: 0 }
      cur.invoicesCount += 1
      cur.totalMinor += s.totalMinor
      cur.creditMinor += s.creditMinor
      custMap.set(key, cur)
    }
    const byCustomer = [...custMap.values()].sort((a, b) => b.totalMinor - a.totalMinor)

    const totals = {
      invoicesCount: sales.length,
      subtotalMinor: sales.reduce((s, x) => s + x.subtotalMinor, 0),
      discountMinor: sales.reduce((s, x) => s + x.discountMinor, 0),
      taxMinor: sales.reduce((s, x) => s + x.taxMinor, 0),
      totalMinor: sales.reduce((s, x) => s + x.totalMinor, 0),
      creditMinor: sales.reduce((s, x) => s + x.creditMinor, 0),
    }

    return ok({ totals, daily, byProduct, byCustomer })
  })
}

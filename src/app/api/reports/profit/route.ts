import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/profit?from&to — تقرير الربحية بتعريف موثق (reports.financial)
 * التعريف:
 *  - إجمالي المبيعات: مجموع إجماليات الفواتير المكتملة في الفترة
 *  - COGS: مجموع (الكمية × تكلفة الوحدة المسجلة لحظة البيع / 1000) لبنود الفواتير المكتملة
 *  - الربح الإجمالي = المبيعات − COGS
 *  - المصروفات النقدية: مصروفات CASH المكتملة في الفترة
 *  - الفائض التقديري = الربح الإجمالي − المصروفات النقدية (تقديري وليس صافي ربح محاسبي)
 */
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

    const sales = await db.sale.findMany({
      where: { ...where, status: 'COMPLETED' },
      select: { id: true, totalMinor: true, discountMinor: true, creditMinor: true },
    })
    const saleIds = sales.map(s => s.id)
    const items = saleIds.length
      ? await db.saleItem.findMany({ where: { saleId: { in: saleIds } }, select: { qtyMilli: true, costMinor: true, priceMinor: true } })
      : []

    const salesTotalMinor = sales.reduce((s, x) => s + x.totalMinor, 0)
    const cogsMinor = items.reduce((s, x) => s + Math.round((x.qtyMilli * x.costMinor) / 1000), 0)
    const grossProfitMinor = salesTotalMinor - cogsMinor

    const expenses = await db.expense.aggregate({
      where: { ...where, status: 'COMPLETED', method: 'CASH' },
      _sum: { amountMinor: true },
      _count: true,
    })
    const cashExpensesMinor = expenses._sum.amountMinor ?? 0
    const estimatedSurplusMinor = grossProfitMinor - cashExpensesMinor

    return ok({
      definition: 'الفائض التقديري = إجمالي المبيعات − تكلفة البضاعة المباعة (COGS) − المصروفات النقدية المدفوعة. وهو رقم تقديري وليس صافي الربح المحاسبي؛ إذ لا يغطي الإهلاك أو الرواتب المستحقة أو فروقات الجرد أو المصروفات غير النقدية أو التزامات ضريبية.',
      period: { from: fromS ?? null, to: toS ?? null },
      sales: {
        invoicesCount: sales.length,
        totalMinor: salesTotalMinor,
        discountMinor: sales.reduce((s, x) => s + x.discountMinor, 0),
        creditMinor: sales.reduce((s, x) => s + x.creditMinor, 0),
      },
      cogsMinor,
      grossProfitMinor,
      cashExpensesMinor,
      cashExpensesCount: expenses._count,
      estimatedSurplusMinor,
      marginPercent: salesTotalMinor > 0 ? Math.round((grossProfitMinor * 100) / salesTotalMinor) : 0,
    })
  })
}

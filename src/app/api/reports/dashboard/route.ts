import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

function dayRange(base: Date): { from: Date; to: Date } {
  const from = new Date(base); from.setHours(0, 0, 0, 0)
  const to = new Date(base); to.setHours(23, 59, 59, 999)
  return { from, to }
}

/**
 * GET /api/reports/dashboard — لوحة اليوم (مصادقة فقط، لا صلاحية خاصة)
 * كل الأرقام من البيانات الفعلية — الحالات الفارغة أصفار
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response

    const now = new Date()
    const today = dayRange(now)
    const yesterdayBase = new Date(now); yesterdayBase.setDate(yesterdayBase.getDate() - 1)
    const yesterday = dayRange(yesterdayBase)

    const dayStats = async (range: { from: Date; to: Date }) => {
      const sales = await db.sale.aggregate({
        where: { date: { gte: range.from, lte: range.to }, status: 'COMPLETED' },
        _sum: { totalMinor: true, creditMinor: true },
        _count: true,
      })
      const collected = await db.salePayment.aggregate({
        where: { date: { gte: range.from, lte: range.to } },
        _sum: { amountMinor: true },
      })
      const expenses = await db.expense.aggregate({
        where: { date: { gte: range.from, lte: range.to }, status: 'COMPLETED' },
        _sum: { amountMinor: true },
      })
      return {
        salesTotalMinor: sales._sum.totalMinor ?? 0,
        invoicesCount: sales._count,
        creditMinor: sales._sum.creditMinor ?? 0,
        collectedMinor: collected._sum.amountMinor ?? 0,
        expensesMinor: expenses._sum.amountMinor ?? 0,
      }
    }

    const [todayStats, yesterdayStats] = await Promise.all([dayStats(today), dayStats(yesterday)])

    // تنبيهات المخزون: رصيد ≤ الحد الأدنى (منتجات مفعلة تتتبع المخزون)
    const products = await db.product.findMany({
      where: { active: true, trackStock: true },
      select: { id: true, name: true, baseUnit: true, minStockMilli: true },
    })
    const balances = await db.stockMovement.groupBy({ by: ['productId'], _sum: { qtyMilli: true } })
    const balanceMap = new Map(balances.map(b => [b.productId, b._sum.qtyMilli ?? 0]))
    const alerts = products
      .map(p => ({ productId: p.id, name: p.name, baseUnit: p.baseUnit, balanceMilli: balanceMap.get(p.id) ?? 0, minStockMilli: p.minStockMilli }))
      .filter(p => p.minStockMilli > 0 && p.balanceMilli <= p.minStockMilli)
      .sort((a, b) => (a.balanceMilli - a.minStockMilli) - (b.balanceMilli - b.minStockMilli))

    // ديون العملاء الإجمالية (مجموع الأرصدة الموجبة عبر groupBy)
    const ledger = await db.customerLedgerEntry.groupBy({ by: ['customerId'], _sum: { amountMinor: true } })
    let totalDebtMinor = 0
    let debtorsCount = 0
    for (const row of ledger) {
      const bal = row._sum.amountMinor ?? 0
      if (bal > 0) { totalDebtMinor += bal; debtorsCount++ }
    }

    // أحدث 5 فواتير
    const latestSales = await db.sale.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { date: 'desc' },
      take: 5,
      select: { id: true, invoiceNo: true, date: true, customerName: true, totalMinor: true, paymentStatus: true, source: true },
    })

    // عمليات مفتوحة
    const [openTrips, openShift] = await Promise.all([
      db.distributionTrip.count({ where: { status: 'OPEN' } }),
      db.shift.findFirst({ where: { status: 'OPEN' }, select: { id: true, openedAt: true, openingCashMinor: true } }),
    ])

    return ok({
      today: todayStats,
      yesterday: yesterdayStats,
      stockAlerts: { count: alerts.length, items: alerts.slice(0, 10) },
      latestSales,
      customerDebts: { totalMinor: totalDebtMinor, debtorsCount },
      openOperations: { openTripsCount: openTrips, openShift },
    })
  })
}

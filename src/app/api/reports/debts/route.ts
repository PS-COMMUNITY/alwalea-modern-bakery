import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/reports/debts — ديون العملاء الحالية (reports.financial) مرتبة تنازليًا */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'reports.financial')
    if ('response' in r) return r.response

    const ledger = await db.customerLedgerEntry.groupBy({
      by: ['customerId'],
      _sum: { amountMinor: true },
    })
    const balances = ledger
      .map(row => ({ customerId: row.customerId, balanceMinor: row._sum.amountMinor ?? 0 }))
      .filter(row => row.balanceMinor > 0)
      .sort((a, b) => b.balanceMinor - a.balanceMinor)

    const customers = balances.length
      ? await db.customer.findMany({ where: { id: { in: balances.map(b => b.customerId) } }, select: { id: true, name: true, phone: true } })
      : []
    const byId = new Map(customers.map(c => [c.id, c]))

    const items = balances.map(b => ({
      customerId: b.customerId,
      customerName: byId.get(b.customerId)?.name ?? '—',
      phone: byId.get(b.customerId)?.phone ?? null,
      debtMinor: b.balanceMinor,
    }))
    const totalDebtMinor = items.reduce((s, x) => s + x.debtMinor, 0)

    return ok({ totalDebtMinor, debtorsCount: items.length, items })
  })
}

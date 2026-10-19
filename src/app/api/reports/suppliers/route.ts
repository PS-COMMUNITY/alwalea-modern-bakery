import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** GET /api/reports/suppliers — أرصدة الموردين (المستحق لكل مورد) (reports.financial) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'reports.financial')
    if ('response' in r) return r.response

    const ledger = await db.supplierLedgerEntry.groupBy({
      by: ['supplierId'],
      _sum: { amountMinor: true },
    })
    const rows = ledger
      .map(row => ({ supplierId: row.supplierId, dueMinor: row._sum.amountMinor ?? 0 }))
      .sort((a, b) => b.dueMinor - a.dueMinor)

    const suppliers = rows.length
      ? await db.supplier.findMany({ where: { id: { in: rows.map(x => x.supplierId) } }, select: { id: true, name: true, phone: true } })
      : []
    const byId = new Map(suppliers.map(s => [s.id, s]))

    const items = rows.map(row => ({
      supplierId: row.supplierId,
      supplierName: byId.get(row.supplierId)?.name ?? '—',
      phone: byId.get(row.supplierId)?.phone ?? null,
      dueMinor: row.dueMinor,
    }))
    const totalDueMinor = items.filter(x => x.dueMinor > 0).reduce((s, x) => s + x.dueMinor, 0)

    return ok({ totalDueMinor, suppliersCount: items.length, items })
  })
}

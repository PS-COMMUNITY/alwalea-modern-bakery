import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'
import { resolveRange } from '../../../_lib/bakery'

export const dynamic = 'force-dynamic'

/**
 * GET /api/suppliers/[id]/statement?from&to
 * كشف حساب المورد: قيود الفترة مع رصيد متجمع ورصيد افتتاحي (perm: suppliers.view)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'suppliers.view')
    if ('response' in r) return r.response
    const { id } = await params
    const supplier = await db.supplier.findUnique({ where: { id } })
    if (!supplier) return fail(404, 'المورد غير موجود')

    const url = new URL(req.url)
    const range = resolveRange(url)
    if (range.error) return fail(400, range.error)

    const dateFilter: { gte?: Date; lte?: Date } = {}
    if (range.from) dateFilter.gte = range.from
    if (range.to) dateFilter.lte = range.to

    // الرصيد الافتتاحي = مجموع القيود قبل بداية الفترة
    const openingAgg = range.from
      ? await db.supplierLedgerEntry.aggregate({
          where: { supplierId: id, date: { lt: range.from } },
          _sum: { amountMinor: true },
        })
      : null
    let running = openingAgg?._sum.amountMinor ?? 0
    const openingBalanceMinor = running

    const entries = await db.supplierLedgerEntry.findMany({
      where: { supplierId: id, date: dateFilter },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    })
    const withBalance = entries.map(e => {
      running += e.amountMinor
      return { ...e, balanceMinor: running }
    })

    return ok({
      supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone },
      from: range.from ?? null,
      to: range.to ?? null,
      openingBalanceMinor,
      entries: withBalance,
      closingBalanceMinor: running,
    })
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'
import { resolveRange } from '../../../_lib/bakery'

export const dynamic = 'force-dynamic'

/**
 * GET /api/customers/[id]/statement?from&to
 * كشف حساب العميل: قيود الفترة مع رصيد متجمع ورصيد افتتاحي (مجموع ما قبل from)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const { id } = await params
    const customer = await db.customer.findUnique({ where: { id } })
    if (!customer) return fail(404, 'العميل غير موجود')

    const url = new URL(req.url)
    const range = resolveRange(url)
    if (range.error) return fail(400, range.error)

    const dateFilter: { gte?: Date; lte?: Date } = {}
    if (range.from) dateFilter.gte = range.from
    if (range.to) dateFilter.lte = range.to

    // الرصيد الافتتاحي = مجموع القيود قبل بداية الفترة
    const openingAgg = range.from
      ? await db.customerLedgerEntry.aggregate({
          where: { customerId: id, date: { lt: range.from } },
          _sum: { amountMinor: true },
        })
      : null
    let running = openingAgg?._sum.amountMinor ?? 0
    const openingBalanceMinor = running

    const entries = await db.customerLedgerEntry.findMany({
      where: { customerId: id, date: dateFilter },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    })
    const withBalance = entries.map(e => {
      running += e.amountMinor
      return { ...e, balanceMinor: running }
    })

    return ok({
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
      from: range.from ?? null,
      to: range.to ?? null,
      openingBalanceMinor,
      entries: withBalance,
      closingBalanceMinor: running,
    })
  })
}

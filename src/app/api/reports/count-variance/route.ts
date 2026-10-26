import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'
import { fromMilli } from '@/lib/bakery/money'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/count-variance?countId=... — تقرير فروق الجرد (perm: inventory.view)
 * صف لكل بند: الرصيد الدفتري، المجرود، الفرق بالكمية، قيمة الفرق بالتكلفة.
 * لا يعرض بنودًا لم تُجرد إلا في ملخص الإجماليات.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'inventory.view')
    if ('response' in r) return r.response
    const countId = req.nextUrl.searchParams.get('countId')
    if (!countId) return fail(400, 'معرف ورقة الجرد (countId) مطلوب')

    const c = await db.stockCount.findUnique({ where: { id: countId }, include: { items: { orderBy: { productName: 'asc' } } } })
    if (!c) return fail(404, 'ورقة الجرد غير موجودة')

    const items = c.items.filter(i => i.countedQtyMilli !== null)
    const rows = items.map(i => {
      const diff = i.countedQtyMilli! - i.systemQtyMilli
      return {
        productId: i.productId,
        productName: i.productName,
        systemQtyMilli: i.systemQtyMilli,
        countedQtyMilli: i.countedQtyMilli!,
        diffMilli: diff,
        unitCostMinor: i.unitCostMinor,
        diffValueMinor: diff * i.unitCostMinor,
        diffQtyLabel: fromMilli(diff),
        diffValueLabel: fromMilli(diff * i.unitCostMinor),
      }
    })
    const totalValueMinor = rows.reduce((s, x) => s + x.diffValueMinor, 0)

    return ok({
      count: {
        id: c.id, countNo: c.countNo, month: c.month, status: c.status,
        createdAt: c.createdAt, approvedAt: c.approvedAt, approvedByName: c.approvedByName,
      },
      summary: {
        itemsTotal: c.items.length,
        itemsCounted: items.length,
        itemsNotCounted: c.items.length - items.length,
        diffItems: rows.filter(x => x.diffMilli !== 0).length,
        totalDiffValueMinor: totalValueMinor,
        totalDiffValueLabel: fromMilli(totalValueMinor),
      },
      rows,
    })
  })
}

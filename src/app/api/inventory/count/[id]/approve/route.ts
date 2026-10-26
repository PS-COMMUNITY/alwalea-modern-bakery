import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { assertMonthOpen, isMonthLocked, MONTH_LOCKED_MESSAGE } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inventory/count/[id]/approve — اعتماد ورقة الجرد (perm: settings.manage)
 * { note?: سبب/ملاحظة اعتماد }
 * الاعتماد يسجل حركات ADJUSTMENT بفروق الجرد بتاريخ الآن:
 *  - الفرق = المجرود − الدفتري (صفر = لا حركة)
 *  - الحاجز: لا اعتماد إن كان شهر الورقة مقفلًا أو الشهر الحالي مقفلًا
 *  - الاعتماد نهائي: الورقة تصير APPROVED ولا تُعدل
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'settings.manage')
    if ('response' in r) return r.response
    const user = r.user
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const note = body ? str(body.note, 300) : null

    const c = await db.stockCount.findUnique({ where: { id }, include: { items: true } })
    if (!c) return fail(404, 'ورقة الجرد غير موجودة')
    if (c.status !== 'DRAFT') return fail(409, 'ورقة الجرد معتمدة مسبقًا')

    // حاجز الشهر المقفل: شهر الورقة + الشهر الحالي (حيث تُكتب الحركات)
    if (await isMonthLocked(c.month)) return fail(423, MONTH_LOCKED_MESSAGE)
    await assertMonthOpen(new Date())

    const diffs = c.items.filter(i => i.countedQtyMilli !== null && i.countedQtyMilli !== i.systemQtyMilli)
    const now = new Date()

    const result = await db.$transaction(async tx => {
      let movements = 0
      for (const i of diffs) {
        await tx.stockMovement.create({
          data: {
            productId: i.productId,
            qtyMilli: i.countedQtyMilli! - i.systemQtyMilli,
            type: 'ADJUSTMENT',
            refType: 'StockCount',
            refId: c.id,
            note: `جرد شهري ${c.countNo}${note ? ` — ${note}` : ''}`,
            userId: user.id,
          },
        })
        movements++
      }
      return await tx.stockCount.update({
        where: { id: c.id },
        data: {
          status: 'APPROVED',
          approvedAt: now,
          approvedByUserId: user.id,
          approvedByName: user.displayName,
        },
      })
    })

    await audit({
      userId: user.id, username: user.username, action: 'STOCK_COUNT_APPROVE',
      entityType: 'StockCount', entityId: c.id,
      details: {
        countNo: c.countNo, month: c.month,
        itemsTotal: c.items.length, diffItems: diffs.length,
        diffValueMinor: diffs.reduce((s, i) => s + (i.countedQtyMilli! - i.systemQtyMilli) * i.unitCostMinor, 0),
        note,
      },
    })

    return ok({
      id: result.id, countNo: result.countNo, status: result.status,
      approvedAt: result.approvedAt, adjustmentMovements: diffs.length,
    })
  })
}

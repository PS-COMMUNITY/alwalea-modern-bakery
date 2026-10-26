import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { assertMonthOpen } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

/** GET /api/inventory/count/[id] — تفاصيل ورقة جرد (perm: inventory.view) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'inventory.view')
    if ('response' in r) return r.response
    const { id } = await params
    const c = await db.stockCount.findUnique({ where: { id }, include: { items: { orderBy: { productName: 'asc' } } } })
    if (!c) return fail(404, 'ورقة الجرد غير موجودة')
    return ok({
      id: c.id, countNo: c.countNo, month: c.month, status: c.status, note: c.note,
      userName: c.userName, createdAt: c.createdAt, approvedAt: c.approvedAt, approvedByName: c.approvedByName,
      items: c.items.map(i => ({
        id: i.id, productId: i.productId, productName: i.productName,
        systemQtyMilli: i.systemQtyMilli, countedQtyMilli: i.countedQtyMilli,
        diffMilli: i.countedQtyMilli === null ? null : i.countedQtyMilli - i.systemQtyMilli,
        unitCostMinor: i.unitCostMinor,
      })),
    })
  })
}

/**
 * PUT /api/inventory/count/[id] — حفظ الكميات المجرودة (perm: inventory.adjust)
 * { items: [{ id, countedQtyMilli ≥ 0 | null }] } — على ورقة DRAFT فقط
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'inventory.adjust')
    if ('response' in r) return r.response
    const user = r.user
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.items)) return fail(400, 'بيانات غير صالحة')

    const c = await db.stockCount.findUnique({ where: { id } })
    if (!c) return fail(404, 'ورقة الجرد غير موجودة')

    // حاجز الشهر المقفل: تعديل الجرد داخل شهر مقفل ممنوع — الحاجز أولًا قبل فحص الحالة
    await assertMonthOpen(new Date())

    if (c.status !== 'DRAFT') return fail(409, 'لا يمكن تعديل ورقة جرد معتمدة')

    let updated = 0
    for (const raw of body.items) {
      const itemId = str(raw?.id, 50)
      if (!itemId) return fail(400, 'معرف البند مطلوب في كل عنصر')
      const item = await db.stockCountItem.findUnique({ where: { id: itemId } })
      if (!item || item.countId !== id) return fail(404, 'أحد البنود لا ينتمي لهذه الورقة')
      let counted: number | null = null
      if (raw?.countedQtyMilli !== undefined && raw?.countedQtyMilli !== null && raw.countedQtyMilli !== '') {
        counted = int(raw.countedQtyMilli)
        if (counted === null) return fail(400, 'الكمية المجرودة يجب أن تكون عددًا صحيحًا ≥ 0 أو فارغة')
      }
      await db.stockCountItem.update({ where: { id: itemId }, data: { countedQtyMilli: counted } })
      updated++
    }

    await audit({
      userId: user.id, username: user.username, action: 'STOCK_COUNT_SAVE',
      entityType: 'StockCount', entityId: id,
      details: { countNo: c.countNo, savedItems: updated },
    })

    return ok({ saved: updated })
  })
}

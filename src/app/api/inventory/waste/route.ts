import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit, stockOf } from '@/lib/bakery/core'
import { posInt } from '../../_lib/bakery'
import { fromMilli } from '@/lib/bakery/money'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inventory/waste — إعدام كمية من المخزون (perm: inventory.waste)
 * { productId, qtyMilli > 0, reason: مطلوب } — يجب أن يكفي الرصيد.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'inventory.waste')
    if ('response' in r) return r.response
    const user = r.user
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const productId = str(body.productId, 50)
    if (!productId) return fail(400, 'معرف المنتج مطلوب')
    const qty = posInt(body.qtyMilli)
    if (qty === null) return fail(400, 'الكمية يجب أن تكون عددًا صحيحًا أكبر من صفر')
    const reason = str(body.reason, 300)
    if (!reason) return fail(400, 'سبب الإعدام مطلوب')

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) return fail(404, 'المنتج غير موجود')

    const current = await stockOf(productId)
    if (product.trackStock && current - qty < 0) {
      return fail(409, `الرصيد غير كافٍ للمنتج "${product.name}" (المتاح: ${fromMilli(current)})`)
    }

    const movement = await db.$transaction(async tx =>
      tx.stockMovement.create({
        data: {
          productId,
          qtyMilli: -qty,
          type: 'WASTE',
          note: reason,
          unitCostMinor: product.costMinor,
          userId: user.id,
        },
      })
    )

    await audit({
      userId: user.id,
      username: user.username,
      action: 'WASTE',
      entityType: 'Product',
      entityId: productId,
      details: { productName: product.name, qtyMilli: qty, availableMilli: current, reason },
    })

    return ok({ movement })
  })
}

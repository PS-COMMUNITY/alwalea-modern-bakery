import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'
import { audit, stockOf } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inventory/adjust — جرد وتسوية فرق (perm: inventory.adjust)
 * { productId, countedQtyMilli ≥ 0, reason: مطلوب }
 * الفرق = المجرود − الحالي؛ إن اختلف يُسجل كحركة ADJUSTMENT.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'inventory.adjust')
    if ('response' in r) return r.response
    const user = r.user
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const productId = str(body.productId, 50)
    if (!productId) return fail(400, 'معرف المنتج مطلوب')
    const counted = int(body.countedQtyMilli)
    if (counted === null) return fail(400, 'الكمية المجرودة يجب أن تكون عددًا صحيحًا ≥ 0')
    const reason = str(body.reason, 300)
    if (!reason) return fail(400, 'سبب الجرد مطلوب')

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) return fail(404, 'المنتج غير موجود')

    const current = await stockOf(productId)
    const diff = counted - current

    let movementId: string | null = null
    if (diff !== 0) {
      const mv = await db.$transaction(async tx =>
        tx.stockMovement.create({
          data: {
            productId,
            qtyMilli: diff,
            type: 'ADJUSTMENT',
            note: reason,
            userId: user.id,
          },
        })
      )
      movementId = mv.id
    }

    await audit({
      userId: user.id,
      username: user.username,
      action: 'STOCK_ADJUST',
      entityType: 'Product',
      entityId: productId,
      details: { productName: product.name, currentMilli: current, countedMilli: counted, diffMilli: diff, reason },
    })

    return ok({
      productId,
      productName: product.name,
      currentMilli: current,
      countedMilli: counted,
      diffMilli: diff,
      movementId,
    })
  })
}

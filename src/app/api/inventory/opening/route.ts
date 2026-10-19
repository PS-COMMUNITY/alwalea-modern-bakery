import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { posInt } from '../../_lib/bakery'

export const dynamic = 'force-dynamic'

/**
 * POST /api/inventory/opening — رصيد افتتاحي (perm: inventory.opening)
 * { items: [{ productId, qtyMilli > 0, unitCostMinor? }] }
 * لكل بند: لا بد ألا تكون هناك أي حركات سابقة للمنتج. الكل في معاملة واحدة.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'inventory.opening')
    if ('response' in r) return r.response
    const user = r.user
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    if (!Array.isArray(body.items)) return fail(400, 'بنود الرصيد الافتتاحي مطلوبة')
    if (body.items.length === 0) return fail(400, 'يجب إضافة بند واحد على الأقل')

    // التحقق من المدخلات وجلب المنتجات
    const productIds: string[] = []
    const parsed: { productId: string; qtyMilli: number; unitCostMinor?: number }[] = []
    for (const raw of body.items) {
      const pid = str(raw?.productId, 50)
      if (!pid) return fail(400, 'معرف المنتج مطلوب في كل بند')
      const qty = posInt(raw?.qtyMilli)
      if (qty === null) return fail(400, 'الكمية يجب أن تكون عددًا صحيحًا أكبر من صفر')
      let unitCost: number | undefined
      if (raw.unitCostMinor !== undefined && raw.unitCostMinor !== null) {
        const c = int(raw.unitCostMinor)
        if (c === null) return fail(400, 'تكلفة الوحدة يجب أن تكون عددًا صحيحًا ≥ 0')
        unitCost = c
      }
      productIds.push(pid)
      parsed.push({ productId: pid, qtyMilli: qty, unitCostMinor: unitCost })
    }

    const products = await db.product.findMany({ where: { id: { in: productIds } } })
    const productMap = new Map(products.map(p => [p.id, p]))
    for (const item of parsed) {
      if (!productMap.has(item.productId)) return fail(404, 'المنتج غير موجود')
    }

    const createdIds = await db.$transaction(async tx => {
      const ids: string[] = []
      for (const item of parsed) {
        const p = productMap.get(item.productId)!
        // لا رصيد افتتاحي مكرر — الفحص داخل المعاملة يرى حركات البنود السابقة في نفس الطلب
        const count = await tx.stockMovement.count({ where: { productId: item.productId } })
        if (count > 0) return fail(409, `رصيد افتتاحي مسجل مسبقًا للمنتج "${p.name}"`)

        const mv = await tx.stockMovement.create({
          data: {
            productId: item.productId,
            qtyMilli: item.qtyMilli,
            type: 'OPENING',
            unitCostMinor: item.unitCostMinor,
            userId: user.id,
          },
        })
        ids.push(mv.id)

        if (item.unitCostMinor !== undefined) {
          await tx.product.update({ where: { id: item.productId }, data: { costMinor: item.unitCostMinor } })
        }
      }
      return ids
    })

    // رد خطأ من داخل المعاملة (لم يتم إنشاء شيء)
    if (createdIds instanceof NextResponse) return createdIds

    await audit({
      userId: user.id,
      username: user.username,
      action: 'OPENING',
      entityType: 'StockMovement',
      details: { count: createdIds.length, items: parsed },
    })

    return ok({ created: createdIds.length, movementIds: createdIds })
  })
}

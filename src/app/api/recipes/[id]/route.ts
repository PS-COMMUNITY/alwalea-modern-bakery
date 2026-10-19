import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

type ItemInput = { productId: string; qtyMilli: number }

function parseItems(raw: unknown): ItemInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const items: ItemInput[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') return null
    const productId = str((it as Record<string, unknown>).productId, 60)
    const qtyMilli = int((it as Record<string, unknown>).qtyMilli)
    if (!productId || !qtyMilli || qtyMilli <= 0) return null
    items.push({ productId, qtyMilli })
  }
  const ids = items.map(i => i.productId)
  if (new Set(ids).size !== ids.length) return null
  return items
}

/** تكلفة مواد الوصفة الحالية محسوبة من product.costMinor */
function materialsCost(items: { qtyMilli: number; product: { costMinor: number } }[]): number {
  return items.reduce((sum, it) => sum + Math.round((it.qtyMilli * it.product.costMinor) / 1000), 0)
}

/** GET /api/recipes/[id] — وصفة كاملة مع تكلفة المواد الحالية */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requirePerm(req, 'production.view')
    if ('response' in auth) return auth.response
    const { id } = await params
    const recipe = await db.recipe.findUnique({
      where: { id },
      include: {
        outputProduct: { select: { id: true, name: true, type: true, baseUnit: true, costMinor: true } },
        items: { include: { product: { select: { id: true, name: true, type: true, baseUnit: true, costMinor: true } } } },
      },
    })
    if (!recipe) return fail(404, 'الوصفة غير موجودة')
    const cost = materialsCost(recipe.items)
    return ok({
      ...recipe,
      materialsCostMinor: cost,
      unitCostMinor: recipe.outputQtyMilli > 0 ? Math.round((cost * 1000) / recipe.outputQtyMilli) : 0,
    })
  })
}

/** PUT /api/recipes/[id] — تعديل كامل مع استبدال البنود داخل معاملة */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'production.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const name = str(body.name, 150)
    const outputProductId = str(body.outputProductId, 60)
    const outputQtyMilli = int(body.outputQtyMilli)
    const items = parseItems(body.items)
    if (!name) return fail(400, 'اسم الوصفة مطلوب')
    if (!outputProductId) return fail(400, 'المنتج الناتج مطلوب')
    if (!outputQtyMilli || outputQtyMilli <= 0) return fail(400, 'كمية الناتج يجب أن تكون أكبر من صفر')
    if (!items) return fail(400, 'بنود الوصفة غير صالحة (مادة واحدة على الأقل بكمية صحيحة ودون تكرار)')
    if (items.some(i => i.productId === outputProductId)) {
      return fail(409, 'لا يمكن أن يكون الناتج نفسه ضمن مواد الوصفة')
    }

    const existing = await db.recipe.findUnique({ where: { id } })
    if (!existing) return fail(404, 'الوصفة غير موجودة')

    const allIds = [outputProductId, ...items.map(i => i.productId)]
    const products = await db.product.findMany({ where: { id: { in: allIds } } })
    if (products.length !== allIds.length) return fail(404, 'أحد المنتجات المشار إليها غير موجود')

    const updated = await db.$transaction(async tx => {
      await tx.recipeItem.deleteMany({ where: { recipeId: id } })
      await tx.recipeItem.createMany({ data: items.map(i => ({ recipeId: id, productId: i.productId, qtyMilli: i.qtyMilli })) })
      return tx.recipe.update({
        where: { id },
        data: { name, outputProductId, outputQtyMilli, notes: str(body.notes, 500) ?? undefined },
        include: {
          outputProduct: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
        },
      })
    })
    await audit({ userId: r.user.id, username: r.user.username, action: 'RECIPE_UPDATE', entityType: 'Recipe', entityId: id, details: { name, outputProductId, outputQtyMilli, itemsCount: items.length } })
    return ok(updated)
  })
}

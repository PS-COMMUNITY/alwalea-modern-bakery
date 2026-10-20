import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/** GET /api/recipes — قائمة الوصفات مع بنودها واسم الناتج */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'production.view')
    if ('response' in r) return r.response
    const recipes = await db.recipe.findMany({
      include: {
        outputProduct: { select: { id: true, name: true, type: true, baseUnit: true, costMinor: true } },
        items: { include: { product: { select: { id: true, name: true, type: true, baseUnit: true, costMinor: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return ok(recipes)
  })
}

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
  // منع تكرار المادة نفسها
  const ids = items.map(i => i.productId)
  if (new Set(ids).size !== ids.length) return null
  return items
}

/** POST /api/recipes — إنشاء وصفة (صلاحية: production.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'production.manage')
    if ('response' in r) return r.response
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

    // تحقق من وجود كل المنتجات
    const allIds = [outputProductId, ...items.map(i => i.productId)]
    const products = await db.product.findMany({ where: { id: { in: allIds } } })
    if (products.length !== allIds.length) return fail(404, 'أحد المنتجات المشار إليها غير موجود')
    if (items.some(i => i.productId === outputProductId)) {
      return fail(409, 'لا يمكن أن يكون الناتج نفسه ضمن مواد الوصفة')
    }

    const recipe = await db.recipe.create({
      data: {
        name,
        outputProductId,
        outputQtyMilli,
        notes: str(body.notes, 500) ?? undefined,
        items: { create: items.map(i => ({ productId: i.productId, qtyMilli: i.qtyMilli })) },
      },
      include: {
        outputProduct: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    })
    await audit({ userId: r.user.id, username: r.user.username, action: 'RECIPE_CREATE', entityType: 'Recipe', entityId: recipe.id, details: { name, outputProductId, outputQtyMilli, itemsCount: items.length } })
    return ok(recipe)
  })
}

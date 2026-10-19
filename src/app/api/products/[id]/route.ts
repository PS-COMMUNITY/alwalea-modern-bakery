import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { PRODUCT_TYPES } from '../../_lib/bakery'

export const dynamic = 'force-dynamic'

/** GET /api/products/[id] — بطاقة منتج كاملة مع آخر 50 حركة مخزون (مصادقة فقط) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const { id } = await params
    const product = await db.product.findUnique({ where: { id }, include: { category: true } })
    if (!product) return fail(404, 'المنتج غير موجود')

    const [movements, agg] = await Promise.all([
      db.stockMovement.findMany({
        where: { productId: id },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      db.stockMovement.aggregate({ where: { productId: id }, _sum: { qtyMilli: true } }),
    ])

    return ok({ product, stockMilli: agg._sum.qtyMilli ?? 0, movements })
  })
}

/** PUT /api/products/[id] — تعديل منتج / تعطيل (لا حذف نهائي) (perm: products.manage) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'products.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const product = await db.product.findUnique({ where: { id } })
    if (!product) return fail(404, 'المنتج غير موجود')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const data: Record<string, unknown> = {}

    if ('name' in body) {
      const name = str(body.name, 200)
      if (!name) return fail(400, 'اسم المنتج مطلوب')
      data.name = name
    }

    if ('priceMinor' in body && body.priceMinor !== null) {
      const price = int(body.priceMinor)
      if (price === null) return fail(400, 'سعر البيع يجب أن يكون عددًا صحيحًا ≥ 0')
      data.priceMinor = price
    }
    if ('costMinor' in body && body.costMinor !== null) {
      const cost = int(body.costMinor)
      if (cost === null) return fail(400, 'التكلفة يجب أن تكون عددًا صحيحًا ≥ 0')
      data.costMinor = cost
    }
    if ('minStockMilli' in body && body.minStockMilli !== null) {
      const min = int(body.minStockMilli)
      if (min === null) return fail(400, 'الحد الأدنى للمخزون يجب أن يكون عددًا صحيحًا ≥ 0')
      data.minStockMilli = min
    }
    if ('wholesalePriceMinor' in body) {
      if (body.wholesalePriceMinor === null) data.wholesalePriceMinor = null
      else {
        const wp = int(body.wholesalePriceMinor)
        if (wp === null) return fail(400, 'سعر الجملة يجب أن يكون عددًا صحيحًا ≥ 0')
        data.wholesalePriceMinor = wp
      }
    }

    if ('type' in body && body.type !== null) {
      if (!PRODUCT_TYPES.includes(body.type)) return fail(400, 'نوع المنتج يجب أن يكون RAW أو FINISHED أو TRADE')
      data.type = body.type
    }

    if ('categoryId' in body) {
      if (body.categoryId === null) data.categoryId = null
      else {
        const categoryId = str(body.categoryId, 50)
        if (!categoryId) return fail(400, 'معرف التصنيف غير صالح')
        const cat = await db.category.findUnique({ where: { id: categoryId } })
        if (!cat) return fail(400, 'التصنيف غير موجود')
        data.categoryId = categoryId
      }
    }

    if ('code' in body) {
      if (body.code === null) data.code = null
      else {
        const code = str(body.code, 50)
        if (!code) return fail(400, 'كود المنتج غير صالح')
        const dup = await db.product.findFirst({ where: { code, NOT: { id } } })
        if (dup) return fail(409, 'كود المنتج مستخدم مسبقًا')
        data.code = code
      }
    }
    if ('barcode' in body) {
      if (body.barcode === null) data.barcode = null
      else {
        const barcode = str(body.barcode, 80)
        if (!barcode) return fail(400, 'الباركود غير صالح')
        const dup = await db.product.findFirst({ where: { barcode, NOT: { id } } })
        if (dup) return fail(409, 'الباركود مستخدم مسبقًا')
        data.barcode = barcode
      }
    }

    if ('baseUnit' in body) {
      const unit = str(body.baseUnit, 30)
      if (!unit) return fail(400, 'وحدة القياس غير صالحة')
      data.baseUnit = unit
    }
    if (typeof body.trackStock === 'boolean') data.trackStock = body.trackStock
    if (typeof body.active === 'boolean') data.active = body.active

    const updated = await db.product.update({ where: { id }, data, include: { category: true } })

    // تعديل السعر يُسجل في سجل التدقيق
    if ('priceMinor' in data && typeof data.priceMinor === 'number' && data.priceMinor !== product.priceMinor) {
      await audit({
        userId: r.user.id,
        username: r.user.username,
        action: 'PRICE_UPDATE',
        entityType: 'Product',
        entityId: id,
        details: { name: updated.name, oldPriceMinor: product.priceMinor, newPriceMinor: data.priceMinor },
      })
    }

    return ok(updated)
  })
}

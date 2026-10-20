import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str, int } from '@/lib/bakery/auth'
import { PRODUCT_TYPES } from '../_lib/bakery'

export const dynamic = 'force-dynamic'

/** GET /api/products — بحث وفلترة مع رصيد المخزون الحالي (مصادقة فقط) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    const url = new URL(req.url)

    const where: Record<string, unknown> = {}
    const q = str(url.searchParams.get('q') ?? '', 100)
    if (q) {
      where.OR = [{ name: { contains: q } }, { code: { contains: q } }, { barcode: { contains: q } }]
    }
    const active = url.searchParams.get('active')
    if (active === 'true') where.active = true
    if (active === 'false') where.active = false
    const categoryId = str(url.searchParams.get('categoryId') ?? '', 50)
    if (categoryId) where.categoryId = categoryId
    const type = url.searchParams.get('type')
    if (type) {
      if (!PRODUCT_TYPES.includes(type as (typeof PRODUCT_TYPES)[number])) return fail(400, 'نوع المنتج غير صالح (RAW أو FINISHED أو TRADE)')
      where.type = type
    }

    const products = await db.product.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { category: true },
    })

    // رصيد المخزون الحالي = مجموع حركات كل منتج (groupBy)
    const ids = products.map(p => p.id)
    const sums = ids.length
      ? await db.stockMovement.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _sum: { qtyMilli: true } })
      : []
    const stockMap = new Map(sums.map(s => [s.productId, s._sum.qtyMilli ?? 0]))

    const items = products.map(p => ({ ...p, stockMilli: stockMap.get(p.id) ?? 0 }))
    return ok({ items, total: items.length })
  })
}

/** POST /api/products — إضافة منتج (perm: products.manage) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'products.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const name = str(body.name, 200)
    if (!name) return fail(400, 'اسم المنتج مطلوب')

    const data: {
      name: string
      priceMinor?: number
      costMinor?: number
      minStockMilli?: number
      wholesalePriceMinor?: number
      type?: string
      categoryId?: string
      code?: string
      barcode?: string
      baseUnit?: string
      trackStock?: boolean
    } = { name }

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
    if ('wholesalePriceMinor' in body && body.wholesalePriceMinor !== null) {
      const wp = int(body.wholesalePriceMinor)
      if (wp === null) return fail(400, 'سعر الجملة يجب أن يكون عددًا صحيحًا ≥ 0')
      data.wholesalePriceMinor = wp
    }

    if ('type' in body && body.type !== null) {
      if (!PRODUCT_TYPES.includes(body.type)) return fail(400, 'نوع المنتج يجب أن يكون RAW أو FINISHED أو TRADE')
      data.type = body.type
    }

    if ('categoryId' in body && body.categoryId !== null) {
      const categoryId = str(body.categoryId, 50)
      if (!categoryId) return fail(400, 'معرف التصنيف غير صالح')
      const cat = await db.category.findUnique({ where: { id: categoryId } })
      if (!cat) return fail(400, 'التصنيف غير موجود')
      data.categoryId = categoryId
    }

    const code = 'code' in body && body.code !== null ? str(body.code, 50) : null
    if (code) {
      const exists = await db.product.findUnique({ where: { code } })
      if (exists) return fail(409, 'كود المنتج مستخدم مسبقًا')
      data.code = code
    }
    const barcode = 'barcode' in body && body.barcode !== null ? str(body.barcode, 80) : null
    if (barcode) {
      const exists = await db.product.findUnique({ where: { barcode } })
      if (exists) return fail(409, 'الباركود مستخدم مسبقًا')
      data.barcode = barcode
    }

    const baseUnit = str(body.baseUnit, 30)
    if (baseUnit) data.baseUnit = baseUnit
    if (typeof body.trackStock === 'boolean') data.trackStock = body.trackStock

    const created = await db.product.create({ data, include: { category: true } })
    return ok(created)
  })
}

// =============================================================
// مخبز الولاء الحديث — الكتالوج: الفئات والمنتجات
// لا حذف نهائي للمنتج المستخدم — تعطيل فقط.
// =============================================================
import { ApiError, reqStr, optStr, reqInt, optInt, reqMinor, reqEnum, reqBool, obj } from '../validate'
import type { CategoryRow, ProductRow } from '../../shared/types'
import { SvcCtx } from './helpers'

/**
 * rc.12 — طلب المالك: حذف فئة أُضيفت بالخطأ — مسموح فقط إن كانت فارغة من المنتجات.
 */
export function deleteCategory(ctx: SvcCtx, payload: Record<string, unknown>): { id: number; deleted: true } {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    const cat = ctx.db.get<{ id: number; name: string }>('SELECT id, name FROM categories WHERE id = ?', [id])
    if (!cat) throw new ApiError('الفئة غير موجودة', 404)
    const used = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM products WHERE category_id = ?', [id])
    if (Number(used?.c ?? 0) > 0) {
      throw new ApiError(`لا يمكن حذف الفئة «${cat.name}» — تضمّن ${used?.c} منتجًا. انقل المنتجات أو احذفها أولًا`, 409)
    }
    ctx.db.run('DELETE FROM categories WHERE id = ?', [id])
    ctx.audit('category.delete', 'category', id, { name: cat.name })
    return { id, deleted: true as const }
  })
}

/**
 * rc.12 — طلب المالك: حذف منتج أُضيف بالخطأ — مسموح فقط إن لم يكن له أي حركة إطلاقًا.
 * المنتج بحركات (بيع/شراء/إنتاج/جرد) بياناته موثقة — يُعطّل بدل الحذف.
 */
export function deleteProduct(ctx: SvcCtx, payload: Record<string, unknown>): { id: number; deleted: true } {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    const prod = ctx.db.get<{ id: number; name: string }>('SELECT id, name FROM products WHERE id = ?', [id])
    if (!prod) throw new ApiError('المنتج غير موجود', 404)
    const refs: Array<[string, string]> = [
      ['حركات مخزون', 'SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?'],
      ['بنود فواتير بيع', 'SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?'],
      ['بنود مشتريات', 'SELECT COUNT(*) AS c FROM purchase_items WHERE product_id = ?'],
      ['مكونات وصفات', 'SELECT COUNT(*) AS c FROM recipe_items WHERE product_id = ?'],
      ['نواتج وصفات', 'SELECT COUNT(*) AS c FROM recipes WHERE product_id = ?'],
      ['بنود تحميل جولات', 'SELECT COUNT(*) AS c FROM trip_loads WHERE product_id = ?']
    ]
    const reasons: string[] = []
    for (const [label, sql] of refs) {
      const r = ctx.db.get<{ c: number }>(sql, [id])
      if (Number(r?.c ?? 0) > 0) reasons.push(`${label} (${r?.c})`)
    }
    if (reasons.length > 0) {
      throw new ApiError(`لا يمكن حذف المنتج «${prod.name}» — له أثر موثق: ${reasons.join('، ')}. استخدم «تعطيل» بدلًا من الحذف`, 409)
    }
    ctx.db.run('DELETE FROM products WHERE id = ?', [id])
    ctx.audit('product.delete', 'product', id, { name: prod.name })
    return { id, deleted: true as const }
  })
}

const PRODUCT_TYPES = ['RAW', 'FINISHED', 'TRADE'] as const

export function listCategories(ctx: SvcCtx, payload: Record<string, unknown>): CategoryRow[] {
  const includeInactive = payload.includeInactive === true
  return ctx.db.query<CategoryRow>(
    `SELECT id, name, active FROM categories ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`
  )
}

export function createCategory(ctx: SvcCtx, payload: Record<string, unknown>): CategoryRow {
  const name = reqStr(payload.name, 'اسم الفئة', 120)
  return ctx.db.tx(() => {
    if (ctx.db.get('SELECT id FROM categories WHERE name = ?', [name])) {
      throw new ApiError('يوجد فئة بنفس الاسم', 409)
    }
    ctx.db.run('INSERT INTO categories (name, active, created_at) VALUES (?, 1, ?)', [name, ctx.db.now()])
    const id = ctx.db.lastId()
    ctx.audit('category.create', 'category', id, { name })
    return { id, name, active: 1 }
  })
}

export function updateCategory(ctx: SvcCtx, payload: Record<string, unknown>): CategoryRow {
  const id = reqInt(payload.id, 'المعرف', 1)
  const name = optStr(payload.name, 'اسم الفئة', 120)
  const active = optInt(payload.active, 'الحالة', 0, 1)
  return ctx.db.tx(() => {
    const row = ctx.db.get<CategoryRow>('SELECT id, name, active FROM categories WHERE id = ?', [id])
    if (!row) throw new ApiError('الفئة غير موجودة', 404)
    if (name !== null) {
      const dup = ctx.db.get('SELECT id FROM categories WHERE name = ? AND id != ?', [name, id])
      if (dup) throw new ApiError('يوجد فئة بنفس الاسم', 409)
      ctx.db.run('UPDATE categories SET name = ? WHERE id = ?', [name, id])
    }
    if (active !== null) ctx.db.run('UPDATE categories SET active = ? WHERE id = ?', [active, id])
    ctx.audit('category.update', 'category', id, { name, active })
    const updated = ctx.db.get<CategoryRow>('SELECT id, name, active FROM categories WHERE id = ?', [id])
    return updated as CategoryRow
  })
}

// ---------- المنتجات ----------
interface ProductQuery {
  id: number
  name: string
  sku: string | null
  category_id: number | null
  category_name: string | null
  type: string
  base_unit: string
  price_minor: number
  cost_minor: number
  min_stock_milli: number
  track_stock: number
  active: number
  balance_milli: number | null
}

function mapProduct(p: ProductQuery): ProductRow & { balance_milli: number | null } {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    category_id: p.category_id,
    category_name: p.category_name,
    type: p.type,
    base_unit: p.base_unit,
    price_minor: Number(p.price_minor),
    cost_minor: Number(p.cost_minor),
    min_stock_milli: Number(p.min_stock_milli),
    track_stock: Number(p.track_stock),
    active: Number(p.active),
    balance_milli: p.balance_milli === null ? null : Number(p.balance_milli)
  }
}

export function listProducts(ctx: SvcCtx, payload: Record<string, unknown>): Array<ProductRow & { balance_milli: number | null }> {
  const q = optStr(payload.q, 'بحث', 120)
  const categoryId = optInt(payload.categoryId, 'الفئة', 1)
  const includeInactive = payload.includeInactive === true
  const conditions: string[] = []
  const params: unknown[] = []
  if (!includeInactive) conditions.push('p.active = 1')
  if (q) {
    conditions.push('(p.name LIKE ? OR p.sku LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  if (categoryId !== null) {
    conditions.push('p.category_id = ?')
    params.push(categoryId)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = ctx.db.query<ProductQuery>(
    `SELECT p.id, p.name, p.sku, p.category_id, c.name AS category_name, p.type, p.base_unit,
            p.price_minor, p.cost_minor, p.min_stock_milli, p.track_stock, p.active,
            (SELECT COALESCE(SUM(m.qty_milli), 0) FROM stock_movements m WHERE m.product_id = p.id) AS balance_milli
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     ${where}
     ORDER BY p.name
     LIMIT 1000`,
    params
  )
  return rows.map(mapProduct)
}

export function getProduct(ctx: SvcCtx, payload: Record<string, unknown>): ProductRow & { balance_milli: number } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const p = ctx.db.get<ProductQuery>(
    `SELECT p.id, p.name, p.sku, p.category_id, c.name AS category_name, p.type, p.base_unit,
            p.price_minor, p.cost_minor, p.min_stock_milli, p.track_stock, p.active,
            (SELECT COALESCE(SUM(m.qty_milli), 0) FROM stock_movements m WHERE m.product_id = p.id) AS balance_milli
     FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    [id]
  )
  if (!p) throw new ApiError('المنتج غير موجود', 404)
  return { ...mapProduct(p), balance_milli: Number(p.balance_milli ?? 0) }
}

interface ProductInput {
  name: string
  sku: string | null
  categoryId: number | null
  type: (typeof PRODUCT_TYPES)[number]
  baseUnit: string
  priceMinor: number
  costMinor: number
  minStockMilli: number
  trackStock: boolean
}

function readProductInput(payload: Record<string, unknown>, partial: boolean, existing?: ProductRow): ProductInput {
  const src = obj(payload, 'payload')
  const name = partial && payload.name === undefined ? (existing as ProductRow).name : reqStr(src.name, 'اسم المنتج', 200)
  // rc.12-merge: في الوضع الجزئي sku/categoryId كانا يفسَّران undefined → null،
  // فأي تعديل جزئي (مثل toggleActive الذي يرسل {id, active} فقط) كان يمسح
  // تصنيف المنتج ورمز SKU صمتًا — نُرجِعهما إلى قيم existing عند غيابهما
  const sku = partial && src.sku === undefined ? ((existing as ProductRow).sku ?? null) : optStr(src.sku, 'رمز SKU', 60)
  const categoryId = partial && src.categoryId === undefined ? ((existing as ProductRow).category_id ?? null) : optInt(src.categoryId, 'الفئة', 1)
  const type = partial && src.type === undefined ? ((existing as ProductRow).type as (typeof PRODUCT_TYPES)[number]) : reqEnum(src.type, 'نوع المنتج', PRODUCT_TYPES)
  const baseUnit = partial && src.baseUnit === undefined ? (existing as ProductRow).base_unit : reqStr(src.baseUnit ?? 'قطعة', 'وحدة القياس', 30)
  const priceMinor = partial && src.priceMinor === undefined ? (existing as ProductRow).price_minor : reqMinor(src.priceMinor, 'سعر البيع')
  const costMinor = partial && src.costMinor === undefined ? (existing as ProductRow).cost_minor : reqMinor(src.costMinor, 'التكلفة')
  const minStockMilli = partial && src.minStockMilli === undefined ? (existing as ProductRow).min_stock_milli : reqInt(src.minStockMilli ?? 0, 'الحد الأدنى', 0)
  const trackStock = partial && src.trackStock === undefined ? (existing as ProductRow).track_stock === 1 : reqBool(src.trackStock ?? true, 'تتبع المخزون')
  if (partial && src.minStockMilli !== undefined) {
    // تحقق إضافي عند التحديث الجزئي
    void reqInt(src.minStockMilli, 'الحد الأدنى', 0)
  }
  return { name, sku, categoryId, type, baseUnit, priceMinor, costMinor, minStockMilli, trackStock }
}

export function createProduct(ctx: SvcCtx, payload: Record<string, unknown>): ProductRow {
  const input = readProductInput(payload, false)
  return ctx.db.tx(() => {
    if (input.sku && ctx.db.get('SELECT id FROM products WHERE sku = ?', [input.sku])) {
      throw new ApiError('رمز SKU مستخدم مسبقًا', 409)
    }
    if (input.categoryId !== null && !ctx.db.get('SELECT id FROM categories WHERE id = ?', [input.categoryId])) {
      throw new ApiError('الفئة غير موجودة', 404)
    }
    ctx.db.run(
      `INSERT INTO products (name, sku, category_id, type, base_unit, price_minor, cost_minor, min_stock_milli, track_stock, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [input.name, input.sku, input.categoryId, input.type, input.baseUnit, input.priceMinor, input.costMinor, input.minStockMilli, input.trackStock ? 1 : 0, ctx.db.now(), ctx.db.now()]
    )
    const id = ctx.db.lastId()
    ctx.audit('product.create', 'product', id, { name: input.name })
    return getProduct(ctx, { id })
  })
}

export function updateProduct(ctx: SvcCtx, payload: Record<string, unknown>): ProductRow {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    // rc.12-merge إصلاح حرج: category_name عمود مشتق عبر JOIN فقط (ليس في جدول
    // products) — اختياره هنا يرمي «no such column» ويظهر للمالك «خطأ غير متوقع
    // عند تعديل سعر منتج» — نستبعده كما في local
    const existing = ctx.db.get<ProductRow>('SELECT id, name, sku, category_id, type, base_unit, price_minor, cost_minor, min_stock_milli, track_stock, active FROM products WHERE id = ?', [id])
    if (!existing) throw new ApiError('المنتج غير موجود', 404)
    const input = readProductInput(payload, true, existing)
    if (input.sku) {
      const dup = ctx.db.get('SELECT id FROM products WHERE sku = ? AND id != ?', [input.sku, id])
      if (dup) throw new ApiError('رمز SKU مستخدم مسبقًا', 409)
    }
    const active = payload.active === undefined ? null : reqBool(payload.active, 'الحالة')
    ctx.db.run(
      `UPDATE products SET name = ?, sku = ?, category_id = ?, type = ?, base_unit = ?, price_minor = ?, cost_minor = ?,
       min_stock_milli = ?, track_stock = ?, active = ?, updated_at = ? WHERE id = ?`,
      [
        input.name,
        input.sku,
        input.categoryId,
        input.type,
        input.baseUnit,
        input.priceMinor,
        input.costMinor,
        input.minStockMilli,
        input.trackStock ? 1 : 0,
        active === null ? existing.active : active ? 1 : 0,
        ctx.db.now(),
        id
      ]
    )
    ctx.audit('product.update', 'product', id, { name: input.name, active })
    return getProduct(ctx, { id })
  })
}

/** حركة كمية سريعة على منتج (للاستخدام الداخلي) */
export function requireProduct(ctx: SvcCtx, id: number): ProductRow {
  // rc.12-merge: نفس إصلاح updateProduct — category_name عمود مشتق بـ JOIN،
  // اختياره من الجدول مباشرة يرمي «no such column» — نستخدم getProduct الموحد
  return getProduct(ctx, { id })
}

export function requireProductLite(ctx: SvcCtx, id: number): { id: number; name: string; base_unit: string; price_minor: number; cost_minor: number; track_stock: number } {
  const p = ctx.db.get<{ id: number; name: string; base_unit: string; price_minor: number; cost_minor: number; track_stock: number }>(
    'SELECT id, name, base_unit, price_minor, cost_minor, track_stock FROM products WHERE id = ?',
    [id]
  )
  if (!p) throw new ApiError('المنتج غير موجود', 404)
  return p
}

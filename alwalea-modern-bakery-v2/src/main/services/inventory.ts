// =============================================================
// مخبز الولاء الحديث — المخزون: أرصدة، حركات، افتتاحي، جرد، هالك
// الرصيد دائمًا = مجموع الحركات. لا مخزون سالب إلا بإعداد.
// =============================================================
import { ApiError, reqStr, optStr, reqInt, reqMilli, reqMinor, reqEnum, reqArr, obj } from '../validate'
import type { InventoryBalanceRow, StockMovementRow } from '../../shared/types'
import { SvcCtx, addStockMovement, assertStock, stockBalance } from './helpers'

const MOVEMENT_TYPES = ['OPENING', 'PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'WASTE', 'ADJUSTMENT', 'TRIP_OUT', 'TRIP_RETURN'] as const

export function balances(ctx: SvcCtx, payload: Record<string, unknown>): InventoryBalanceRow[] {
  const q = optStr(payload.q, 'بحث', 120)
  const onlyTracked = payload.onlyTracked !== false
  const lowOnly = payload.lowOnly === true
  const conditions: string[] = []
  const params: unknown[] = []
  if (onlyTracked) conditions.push('p.track_stock = 1')
  if (q) {
    conditions.push('p.name LIKE ?')
    params.push(`%${q}%`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = ctx.db.query<InventoryBalanceRow & { balance_calc: number }>(
    `SELECT p.id AS product_id, p.name, p.base_unit, p.type, p.track_stock, p.min_stock_milli, p.cost_minor, p.price_minor,
            COALESCE((SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.product_id = p.id), 0) AS balance_calc
     FROM products p ${where} ORDER BY p.name`,
    params
  )
  const mapped = rows.map((r) => ({
    product_id: Number(r.product_id),
    name: r.name,
    base_unit: r.base_unit,
    type: r.type,
    track_stock: Number(r.track_stock),
    min_stock_milli: Number(r.min_stock_milli),
    cost_minor: Number(r.cost_minor),
    price_minor: Number(r.price_minor),
    balance_milli: Number(r.balance_calc)
  }))
  return lowOnly ? mapped.filter((r) => r.balance_milli < r.min_stock_milli) : mapped
}

export function movements(ctx: SvcCtx, payload: Record<string, unknown>): StockMovementRow[] {
  const productId = payload.productId === undefined || payload.productId === null ? null : reqInt(payload.productId, 'المنتج', 1)
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const type = payload.type === undefined || payload.type === null ? null : reqEnum(payload.type, 'نوع الحركة', MOVEMENT_TYPES)
  const conditions: string[] = []
  const params: unknown[] = []
  if (productId !== null) {
    conditions.push('m.product_id = ?')
    params.push(productId)
  }
  if (from) {
    conditions.push('m.date >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('m.date <= ?')
    params.push(to)
  }
  if (type) {
    conditions.push('m.type = ?')
    params.push(type)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = ctx.db.query<Omit<StockMovementRow, 'product_name'> & { product_name: string }>(
    `SELECT m.id, m.date, m.product_id, p.name AS product_name, m.qty_milli, m.type, m.ref_type, m.ref_id, m.note, m.created_at
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     ${where} ORDER BY m.id DESC LIMIT 500`,
    params
  )
  return rows.map((r) => ({ ...r, qty_milli: Number(r.qty_milli) }))
}

/** رصيد افتتاحي: حركة OPENING — يُمنع تكراره للمنتج */
export function opening(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean; count: number } {
  const items = reqArr(payload.items, 'البنود').map((r, i) => {
    const item = obj(r, `البند ${i + 1}`)
    return {
      productId: reqInt(item.productId, 'المنتج', 1),
      qtyMilli: reqMilli(item.qtyMilli, 'الكمية'),
      unitCostMinor: item.unitCostMinor === undefined || item.unitCostMinor === null ? null : reqMinor(item.unitCostMinor, 'تكلفة الوحدة')
    }
  })
  return ctx.db.tx(() => {
    let count = 0
    for (const it of items) {
      const p = ctx.db.get<{ id: number; name: string; track_stock: number }>('SELECT id, name, track_stock FROM products WHERE id = ?', [it.productId])
      if (!p) throw new ApiError('المنتج غير موجود', 404)
      if (Number(p.track_stock) !== 1) throw new ApiError(`المنتج «${p.name}» لا يتتبع المخزون`)
      const has = ctx.db.get("SELECT id FROM stock_movements WHERE product_id = ? AND type = 'OPENING' LIMIT 1", [it.productId])
      if (has) throw new ApiError(`للمنتج «${p.name}» رصيد افتتاحي مسجل مسبقًا`)
      addStockMovement(ctx.db, {
        productId: it.productId,
        qtyMilli: it.qtyMilli,
        type: 'OPENING',
        refType: 'opening',
        unitCostMinor: it.unitCostMinor,
        note: 'رصيد افتتاحي',
        userId: ctx.user?.id ?? null
      })
      if (it.unitCostMinor !== null) {
        ctx.db.run('UPDATE products SET cost_minor = ?, updated_at = ? WHERE id = ?', [it.unitCostMinor, ctx.db.now(), it.productId])
      }
      count++
    }
    ctx.audit('inventory.opening', 'inventory', null, { count })
    return { done: true, count }
  })
}

/** جرد: يُولّد حركة فرق موثقة ADJUSTMENT */
export function adjust(ctx: SvcCtx, payload: Record<string, unknown>): { productId: number; beforeMilli: number; countedMilli: number; diffMilli: number } {
  const productId = reqInt(payload.productId, 'المنتج', 1)
  const countedMilli = reqInt(payload.countedQtyMilli, 'الكمية المجرودة', 0)
  const reason = reqStr(payload.reason, 'سبب الجرد', 300)
  return ctx.db.tx(() => {
    const p = ctx.db.get<{ id: number; name: string; track_stock: number }>('SELECT id, name, track_stock FROM products WHERE id = ?', [productId])
    if (!p) throw new ApiError('المنتج غير موجود', 404)
    if (countedMilli < 0) throw new ApiError('الكمية المجرودة لا يمكن أن تكون سالبة')
    const before = stockBalance(ctx.db, productId)
    const diff = countedMilli - before
    if (diff !== 0) {
      addStockMovement(ctx.db, {
        productId,
        qtyMilli: diff,
        type: 'ADJUSTMENT',
        refType: 'adjust',
        note: `جرد: ${reason} (قبل ${(before / 1000).toFixed(3)} بعد ${(countedMilli / 1000).toFixed(3)})`,
        userId: ctx.user?.id ?? null
      })
    }
    ctx.audit('inventory.adjust', 'product', productId, { before, counted: countedMilli, diff, reason })
    return { productId, beforeMilli: before, countedMilli, diffMilli: diff }
  })
}

/** هالك: خصم موثق */
export function waste(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const productId = reqInt(payload.productId, 'المنتج', 1)
  const qtyMilli = reqMilli(payload.qtyMilli, 'الكمية')
  const reason = reqStr(payload.reason, 'السبب', 300)
  return ctx.db.tx(() => {
    const p = ctx.db.get<{ id: number; name: string }>('SELECT id, name FROM products WHERE id = ?', [productId])
    if (!p) throw new ApiError('المنتج غير موجود', 404)
    assertStock(ctx.db, productId, -qtyMilli, p.name)
    addStockMovement(ctx.db, {
      productId,
      qtyMilli: -qtyMilli,
      type: 'WASTE',
      refType: 'waste',
      note: `هالك: ${reason}`,
      userId: ctx.user?.id ?? null
    })
    ctx.audit('inventory.waste', 'product', productId, { qtyMilli, reason })
    return { done: true }
  })
}

export function lowStock(ctx: SvcCtx): InventoryBalanceRow[] {
  return balances(ctx, { lowOnly: true })
}

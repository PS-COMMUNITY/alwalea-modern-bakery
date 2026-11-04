// =============================================================
// مخبز الولاء الحديث — إقفال الشهور + الجرد الشهري (موازاة P1-E مع الويب)
// الحاجز المالي الموحد: أي كتابة مالية/مخزنية بتاريخ داخل شهر مقفل تُرفض
// برسالة حرفية واحدة (MONTH_LOCKED_MESSAGE) حتى يُفك القفل بسبب موثق.
// الأوراق: لقطة أرصدة الدفتر عند الإنشاء، والاعتماد يرحّل الفروق ADJUSTMENT.
// =============================================================
import { ApiError, reqStr, optStr, reqInt, obj } from '../validate'
import type { PeriodRow, StockCountRow, StockCountItemRow, CountVarianceRow } from '../../shared/types'
import { MONTH_LOCKED_MESSAGE, monthKeyOf, isValidMonthKey } from '../../shared/period'
import { SvcCtx, addStockMovement, stockBalance } from './helpers'
import type { BakeryDb } from '../db'

export { MONTH_LOCKED_MESSAGE, monthKeyOf, isValidMonthKey }

// ---------- أدوات الشهر ----------

function reqMonth(v: unknown, field = 'الشهر'): string {
  const s = reqStr(v, field, 7)
  if (!isValidMonthKey(s)) throw new ApiError('صيغة الشهر يجب أن تكون YYYY-MM')
  return s
}

function optMonth(v: unknown, field = 'الشهر'): string | null {
  if (v === undefined || v === null || v === '') return null
  return reqMonth(v, field)
}

/** هل الشهر (من تاريخ أو نص) مقفل؟ — الحاجز الموحد يفحص المصدرين:
 *  1) month_closes (P0-D — إقفال الجرد الشهري الجديد)
 *  2) period_close (الحاجز المالي الأصلي)
 * صف بلا unlocked_at = مقفل فعليًا في كليهما. */
export function isMonthLocked(db: BakeryDb, date: Date | string): boolean {
  const key = monthKeyOf(date)
  if (!key) return false
  const mc = db.get<{ id: number }>('SELECT id FROM month_closes WHERE period_ym = ? AND unlocked_at IS NULL', [key])
  if (mc !== undefined) return true
  const row = db.get<{ locked: number }>('SELECT locked FROM period_close WHERE month = ?', [key])
  return !!row && Number(row.locked) === 1
}

/**
 * الحاجز الموحد: يرمي خطأً بالرسالة الحرفية إن كان تاريخ العملية داخل شهر مقفل.
 * الإنشاءات: بتاريخ العملية الفعلي — الإلغاءات/التعديلات: بتاريخ السجل الأصلي.
 */
export function assertMonthOpen(db: BakeryDb, date: Date | string): void {
  const key = monthKeyOf(date)
  if (!key) return
  if (isMonthLocked(db, key)) throw new ApiError(MONTH_LOCKED_MESSAGE, 423)
}

// ---------- إقفال الشهور ----------

/** سجل إقفال الشهور — كل الصفوف تنازليًا */
export function listPeriods(ctx: SvcCtx): PeriodRow[] {
  return ctx.db
    .query<Omit<PeriodRow, 'locked' | 'close_count'> & { locked: number; close_count: number }>(
      `SELECT id, month, locked, closed_at, closed_by_name, unlocked_at, unlocked_by_name, unlock_reason, close_count
       FROM period_close ORDER BY month DESC LIMIT 120`
    )
    .map((r) => ({
      ...r,
      locked: Number(r.locked) === 1,
      close_count: Number(r.close_count)
    }))
}

/** إقفال شهر (upsert): closeCount+1 عند الإعادة + تدقيق MONTH_CLOSE */
export function closeMonth(
  ctx: SvcCtx,
  payload: Record<string, unknown>
): { month: string; locked: boolean; closeCount: number; closedAt: string } {
  const month = reqMonth(payload.month)
  return ctx.db.tx(() => {
    const now = ctx.db.now()
    ctx.db.run(
      `INSERT INTO period_close (month, locked, closed_at, closed_by_user_id, closed_by_name, close_count, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(month) DO UPDATE SET
         locked = 1,
         closed_at = excluded.closed_at,
         closed_by_user_id = excluded.closed_by_user_id,
         closed_by_name = excluded.closed_by_name,
         close_count = close_count + 1,
         updated_at = excluded.updated_at`,
      [month, now, ctx.user?.id ?? null, ctx.user?.name ?? null, now, now]
    )
    const row = ctx.db.get<{ id: number; close_count: number; closed_at: string }>(
      'SELECT id, close_count, closed_at FROM period_close WHERE month = ?',
      [month]
    )
    if (!row) throw new ApiError('خطأ داخلي: تعذر حفظ الإقفال', 500)
    ctx.audit('MONTH_CLOSE', 'PeriodClose', Number(row.id), { month, closeCount: Number(row.close_count) })
    return { month, locked: true, closeCount: Number(row.close_count), closedAt: row.closed_at }
  })
}

/** فك قفل شهر: السبب إلزامي ويُوثق في التدقيق — لا يُفك ما ليس مقفلًا */
export function unlockMonth(
  ctx: SvcCtx,
  payload: Record<string, unknown>
): { month: string; locked: boolean; unlockReason: string | null; unlockedAt: string | null } {
  const month = reqMonth(payload.month)
  const reason = reqStr(payload.reason, 'سبب فك القفل', 500)
  return ctx.db.tx(() => {
    const row = ctx.db.get<{ id: number; locked: number; close_count: number }>(
      'SELECT id, locked, close_count FROM period_close WHERE month = ?',
      [month]
    )
    if (!row) throw new ApiError('هذا الشهر غير مقفل أصلًا', 404)
    if (Number(row.locked) !== 1) throw new ApiError('هذا الشهر غير مقفل حاليًا', 409)
    ctx.db.run(
      `UPDATE period_close SET locked = 0, unlocked_at = ?, unlocked_by_user_id = ?, unlocked_by_name = ?, unlock_reason = ?, updated_at = ?
       WHERE id = ?`,
      [ctx.db.now(), ctx.user?.id ?? null, ctx.user?.name ?? null, reason, ctx.db.now(), Number(row.id)]
    )
    ctx.audit('MONTH_UNLOCK', 'PeriodClose', Number(row.id), {
      month,
      reason,
      previousCloseCount: Number(row.close_count)
    })
    return { month, locked: false, unlockReason: reason, unlockedAt: ctx.db.now() }
  })
}

// ---------- أوراق الجرد الشهري ----------

/** قائمة الأوراق مع ملخص لكل ورقة (بنود/مجرود/فروق/قيمة الفرق بالتكلفة) */
export function listCounts(ctx: SvcCtx, payload: Record<string, unknown>): StockCountRow[] {
  const month = optMonth(payload.month)
  const where = month ? 'WHERE c.month = ?' : ''
  const params = month ? [month] : []
  return ctx.db
    .query<
      Omit<StockCountRow, 'items_total' | 'items_counted' | 'diff_items' | 'diff_value_minor'> & {
        items_total: number
        items_counted: number
        diff_items: number
        diff_value_minor: number
      }
    >(
      `SELECT c.id, c.count_no, c.month, c.status, c.note, c.user_name, c.created_at, c.approved_at, c.approved_by_name,
        (SELECT COUNT(*) FROM stock_count_item i WHERE i.count_id = c.id) AS items_total,
        (SELECT COUNT(*) FROM stock_count_item i WHERE i.count_id = c.id AND i.counted_qty_milli IS NOT NULL) AS items_counted,
        (SELECT COUNT(*) FROM stock_count_item i WHERE i.count_id = c.id AND i.counted_qty_milli IS NOT NULL AND i.counted_qty_milli <> i.system_qty_milli) AS diff_items,
        (SELECT COALESCE(SUM((i.counted_qty_milli - i.system_qty_milli) * i.unit_cost_minor), 0)
           FROM stock_count_item i WHERE i.count_id = c.id AND i.counted_qty_milli IS NOT NULL) AS diff_value_minor
       FROM stock_count c ${where} ORDER BY c.id DESC LIMIT 200`,
      params
    )
    .map((r) => ({
      ...r,
      items_total: Number(r.items_total),
      items_counted: Number(r.items_counted),
      diff_items: Number(r.diff_items),
      diff_value_minor: Number(r.diff_value_minor)
    }))
}

/** تفاصيل ورقة + بنودها مع الفرق لكل بند (null = لم يُجرد) */
export function getCount(
  ctx: SvcCtx,
  payload: Record<string, unknown>
): Omit<StockCountRow, 'items_total' | 'items_counted' | 'diff_items' | 'diff_value_minor'> & { items: StockCountItemRow[] } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const c = ctx.db.get<Omit<StockCountRow, 'items_total' | 'items_counted' | 'diff_items' | 'diff_value_minor'>>(
    `SELECT id, count_no, month, status, note, user_name, created_at, approved_at, approved_by_name
     FROM stock_count WHERE id = ?`,
    [id]
  )
  if (!c) throw new ApiError('ورقة الجرد غير موجودة', 404)
  const items = ctx.db
    .query<
      Omit<StockCountItemRow, 'diff_milli'> & { system_qty_milli: number; counted_qty_milli: number | null }
    >(
      `SELECT id, product_id, product_name, system_qty_milli, counted_qty_milli, unit_cost_minor
       FROM stock_count_item WHERE count_id = ? ORDER BY product_name`,
      [id]
    )
    .map((i) => ({
      id: Number(i.id),
      product_id: Number(i.product_id),
      product_name: i.product_name,
      system_qty_milli: Number(i.system_qty_milli),
      counted_qty_milli: i.counted_qty_milli === null ? null : Number(i.counted_qty_milli),
      diff_milli: i.counted_qty_milli === null ? null : Number(i.counted_qty_milli) - Number(i.system_qty_milli),
      unit_cost_minor: Number(i.unit_cost_minor)
    }))
  return { ...c, items }
}

/**
 * إنشاء ورقة جرد: لقطة أرصدة كل منتج نشط متتبع للمخزون (مجموع stock_movements)
 * رقم JC-YYYYMM-#### من جدول sequences — الحاجز: لا جرد داخل شهر مقفل.
 */
export function createCount(
  ctx: SvcCtx,
  payload: Record<string, unknown>
): { id: number; countNo: string; month: string; items: number } {
  const month = payload.month === undefined || payload.month === null || payload.month === '' ? monthKeyOf(new Date()) : reqMonth(payload.month)
  const note = optStr(payload.note, 'ملاحظة', 300)
  return ctx.db.tx(() => {
    // حاجز الشهر المقفل: الاعتماد لاحقًا يكتب حركات بتاريخ الآن — الشهر الحالي مطلوب مفتوحًا
    assertMonthOpen(ctx.db, new Date())
    if (isMonthLocked(ctx.db, month)) throw new ApiError(MONTH_LOCKED_MESSAGE, 423)

    const products = ctx.db.query<{ id: number; name: string; cost_minor: number }>(
      'SELECT id, name, cost_minor FROM products WHERE active = 1 AND track_stock = 1 ORDER BY name'
    )
    if (products.length === 0) throw new ApiError('لا توجد منتجات متتبعة للمخزون لإنشاء ورقة جرد', 409)

    const ym = month.replace('-', '')
    const n = ctx.db.nextSeq(`jc:${ym}`)
    const countNo = `JC-${ym}-${String(n).padStart(4, '0')}`
    ctx.db.run(
      `INSERT INTO stock_count (count_no, month, status, note, user_id, user_name, created_at)
       VALUES (?, ?, 'DRAFT', ?, ?, ?, ?)`,
      [countNo, month, note, ctx.user?.id ?? null, ctx.user?.name ?? null, ctx.db.now()]
    )
    const id = ctx.db.lastId()
    for (const p of products) {
      ctx.db.run(
        `INSERT INTO stock_count_item (count_id, product_id, product_name, system_qty_milli, counted_qty_milli, unit_cost_minor)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [id, p.id, p.name, stockBalance(ctx.db, p.id), Number(p.cost_minor)]
      )
    }
    ctx.audit('STOCK_COUNT_CREATE', 'StockCount', id, { countNo, month, items: products.length })
    return { id, countNo, month, items: products.length }
  })
}

/** حفظ الكميات المجرودة: على DRAFT فقط + الحاجز الزمني (نكتب الآن) */
export function saveCountItems(ctx: SvcCtx, payload: Record<string, unknown>): { saved: number } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const rawItems = payload.items
  if (!Array.isArray(rawItems)) throw new ApiError('الحقل «البنود» يجب أن يكون قائمة')
  return ctx.db.tx(() => {
    const c = ctx.db.get<{ id: number; count_no: string; status: string }>(
      'SELECT id, count_no, status FROM stock_count WHERE id = ?',
      [id]
    )
    if (!c) throw new ApiError('ورقة الجرد غير موجودة', 404)
    // الحاجز الزمني أولًا: تعديل جرد داخل شهر مقفل ممنوع
    assertMonthOpen(ctx.db, new Date())
    if (c.status !== 'DRAFT') throw new ApiError('لا يمكن تعديل ورقة جرد معتمدة', 409)

    let saved = 0
    for (const r of rawItems) {
      const item = obj(r, 'بند')
      const itemId = reqInt(item.itemId, 'معرف البند', 1)
      let counted: number | null = null
      if (item.countedQtyMilli !== undefined && item.countedQtyMilli !== null && item.countedQtyMilli !== '') {
        const v = item.countedQtyMilli
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          throw new ApiError('الكمية المجرودة يجب أن تكون عددًا صحيحًا ≥ 0 أو فارغة')
        }
        counted = v
      }
      const owns = ctx.db.get<{ id: number }>('SELECT id FROM stock_count_item WHERE id = ? AND count_id = ?', [itemId, id])
      if (!owns) throw new ApiError('أحد البنود لا ينتمي لهذه الورقة', 404)
      ctx.db.run('UPDATE stock_count_item SET counted_qty_milli = ? WHERE id = ?', [counted, itemId])
      saved++
    }
    ctx.audit('STOCK_COUNT_SAVE', 'StockCount', id, { countNo: c.count_no, savedItems: saved })
    return { saved }
  })
}

/**
 * اعتماد ورقة الجرد (نهائي): يمنع إن كان شهر الورقة أو الشهر الحالي مقفلًا (الرسالة الحرفية)
 * ويرحّل الفروق ≠ 0 بحركات ADJUSTMENT refType=StockCount بتاريخ الآن.
 */
export function approveCount(
  ctx: SvcCtx,
  payload: Record<string, unknown>
): { id: number; countNo: string; status: string; approvedAt: string; adjustmentMovements: number; diffValueMinor: number } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const note = optStr(payload.note, 'ملاحظة الاعتماد', 300)
  return ctx.db.tx(() => {
    const c = ctx.db.get<{ id: number; count_no: string; month: string; status: string }>(
      'SELECT id, count_no, month, status FROM stock_count WHERE id = ?',
      [id]
    )
    if (!c) throw new ApiError('ورقة الجرد غير موجودة', 404)
    if (c.status !== 'DRAFT') throw new ApiError('ورقة الجرد معتمدة مسبقًا', 409)

    // حاجز الشهر المقفل: شهر الورقة + الشهر الحالي (حيث تُكتب الحركات)
    if (isMonthLocked(ctx.db, c.month)) throw new ApiError(MONTH_LOCKED_MESSAGE, 423)
    assertMonthOpen(ctx.db, new Date())

    const items = ctx.db.query<{
      product_id: number
      system_qty_milli: number
      counted_qty_milli: number | null
      unit_cost_minor: number
    }>(
      'SELECT product_id, system_qty_milli, counted_qty_milli, unit_cost_minor FROM stock_count_item WHERE count_id = ?',
      [id]
    )
    const diffs = items.filter((i) => i.counted_qty_milli !== null && Number(i.counted_qty_milli) !== Number(i.system_qty_milli))

    let diffValueMinor = 0
    for (const i of diffs) {
      const diff = Number(i.counted_qty_milli) - Number(i.system_qty_milli)
      diffValueMinor += diff * Number(i.unit_cost_minor)
      addStockMovement(ctx.db, {
        productId: Number(i.product_id),
        qtyMilli: diff,
        type: 'ADJUSTMENT',
        refType: 'StockCount',
        refId: id,
        note: `جرد شهري ${c.count_no}${note ? ` — ${note}` : ''}`,
        userId: ctx.user?.id ?? null
      })
    }

    ctx.db.run(
      `UPDATE stock_count SET status = 'APPROVED', approved_at = ?, approved_by_user_id = ?, approved_by_name = ? WHERE id = ?`,
      [ctx.db.now(), ctx.user?.id ?? null, ctx.user?.name ?? null, id]
    )
    ctx.audit('STOCK_COUNT_APPROVE', 'StockCount', id, {
      countNo: c.count_no,
      month: c.month,
      itemsTotal: items.length,
      diffItems: diffs.length,
      diffValueMinor,
      note
    })
    return { id, countNo: c.count_no, status: 'APPROVED', approvedAt: ctx.db.now(), adjustmentMovements: diffs.length, diffValueMinor }
  })
}

/** تقرير فروق الجرد: البنود المجرودة فقط + ملخص إجمالي (للمعتمدة أو المسودة) */
export function countVariance(
  ctx: SvcCtx,
  payload: Record<string, unknown>
): {
  count: { id: number; count_no: string; month: string; status: string; created_at: string; approved_at: string | null; approved_by_name: string | null }
  summary: { itemsTotal: number; itemsCounted: number; itemsNotCounted: number; diffItems: number; totalDiffValueMinor: number }
  rows: CountVarianceRow[]
} {
  const id = reqInt(payload.id, 'المعرف', 1)
  const c = ctx.db.get<{
    id: number
    count_no: string
    month: string
    status: string
    created_at: string
    approved_at: string | null
    approved_by_name: string | null
  }>(
    `SELECT id, count_no, month, status, created_at, approved_at, approved_by_name FROM stock_count WHERE id = ?`,
    [id]
  )
  if (!c) throw new ApiError('ورقة الجرد غير موجودة', 404)
  const items = ctx.db.query<{
    product_id: number
    product_name: string
    system_qty_milli: number
    counted_qty_milli: number | null
    unit_cost_minor: number
  }>(
    `SELECT product_id, product_name, system_qty_milli, counted_qty_milli, unit_cost_minor
     FROM stock_count_item WHERE count_id = ? ORDER BY product_name`,
    [id]
  )
  const rows: CountVarianceRow[] = items
    .filter((i) => i.counted_qty_milli !== null)
    .map((i) => {
      const diff = Number(i.counted_qty_milli) - Number(i.system_qty_milli)
      return {
        product_id: Number(i.product_id),
        product_name: i.product_name,
        system_qty_milli: Number(i.system_qty_milli),
        counted_qty_milli: Number(i.counted_qty_milli),
        diff_milli: diff,
        unit_cost_minor: Number(i.unit_cost_minor),
        diff_value_minor: diff * Number(i.unit_cost_minor)
      }
    })
  const totalDiffValueMinor = rows.reduce((s, x) => s + x.diff_value_minor, 0)
  return {
    count: { ...c, id: Number(c.id) },
    summary: {
      itemsTotal: items.length,
      itemsCounted: rows.length,
      itemsNotCounted: items.length - rows.length,
      diffItems: rows.filter((x) => x.diff_milli !== 0).length,
      totalDiffValueMinor
    },
    rows
  }
}

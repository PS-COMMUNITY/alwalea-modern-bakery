// =============================================================
// مخبز الولاء الحديث — الجرد الشهري وإقفال الشهر (P0-D)
// فتح جرد = لقطة أرصدة نظامية، حفظ مسودة (فعلي/سبب إلزامي/ملاحظة)،
// اعتماد = حركات WASTE/ADJUSTMENT موثقة داخل معاملة واحدة،
// إقفال الشهر يمنع أي تعديل رجعي حتى يُفك القفل بسبب موثق.
// =============================================================
import { ApiError, reqStr, optStr, reqInt, reqEnum, reqArr, obj, optInt } from '../validate'
import type { BakeryDb } from '../db'
import type {
  MonthStatusRow,
  StockCountHeaderRow,
  StockCountEntryRow,
  StockCountView,
  VarianceItemRow,
  VarianceReport
} from '../../shared/types'
import { STOCK_COUNT_REASONS } from '../../shared/types'
import { SvcCtx, addStockMovement } from './helpers'

/** أسباب فروق الجرد — قائمة إلزامية مغلقة (المصدر: shared/types) */
export const REASONS = STOCK_COUNT_REASONS

/** الأسباب التي تُصنّف النقص هالكًا (حركة WASTE) عند الاعتماد */
const WASTE_REASONS: readonly string[] = ['هالك', 'تلف', 'فقدان']

/** رسالة القفل الموحدة المستخدمة في كل الخدمات (صيغة موحدة إلزامية) */
export const LOCKED_MSG = 'هذا الشهر مقفل. يلزم فك القفل بسبب مسجل في سجل التدقيق قبل أي تعديل.'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_MONTHS_RANGE = 36

const COUNT_COLS = 'id, period_ym, status, created_at, approved_at, created_by, approved_by, note'
const ITEM_COLS = 'id, count_id, product_id, product_name, system_qty_milli, actual_qty_milli, diff_milli, reason, note, unit'

/** استخراج صيغة الشهر YYYY-MM من تاريخ حركة (YYYY-MM-DD أو YYYY-MM) — null إن كانت غير صالحة */
export function toPeriodYm(dateYm: string): string | null {
  const m = PERIOD_RE.exec(dateYm.slice(0, 7))
  return m?.[0] ?? null
}

function requirePeriodYm(v: unknown, field = 'الشهر'): string {
  const s = reqStr(v, field, 7)
  if (!PERIOD_RE.test(s)) throw new ApiError(`الحقل «${field}» يجب أن يكون بصيغة YYYY-MM (مثال: 2025-05)`)
  return s
}

/** كمية ألفية صحيحة ≥ 0 (الصفر مسموح = رصيد صفري) — بخلاف reqMilli الذي يرفض الصفر */
function reqNonNegativeMilli(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new ApiError(`الحقل «${field}» يجب أن يكون كمية صحيحة (صفر أو أكثر، ×1000)`)
  }
  return v
}

// ---------- حالة الإقفال ----------

/** هل الشهر مقفل؟ true إن وُجد صف month_closes أو period_close مقفل لذلك الشهر — مصدرا الحقيقة موحّدان */
export function isPeriodLocked(ctx: SvcCtx, dateYm: string): boolean {
  const ym = toPeriodYm(dateYm)
  if (!ym) return false
  const mc = ctx.db.get<{ id: number }>('SELECT id FROM month_closes WHERE period_ym = ? AND unlocked_at IS NULL', [ym])
  if (mc !== undefined) return true
  // توحيد مع الحاجز المالي القديم (period_close من 003_period_count.sql)
  const pc = ctx.db.get<{ locked: number }>('SELECT locked FROM period_close WHERE month = ?', [ym])
  return !!pc && Number(pc.locked) === 1
}

/** فحص يرمي خطأ 409 إذا كان الشهر مقفلًا (يُستخدم في الخدمات قبل أي كتابة على شهر مقفل) */
export function assertPeriodOpen(ctx: SvcCtx, dateYm: string): void {
  if (isPeriodLocked(ctx, dateYm)) throw new ApiError(LOCKED_MSG, 409)
}

function monthStatus(db: BakeryDb, periodYm: string): MonthStatusRow {
  const close = db.get<{
    period_ym: string
    closed_at: string
    closed_by: string
    unlocked_at: string | null
  }>('SELECT period_ym, closed_at, closed_by, unlocked_at FROM month_closes WHERE period_ym = ?', [periodYm])
  const cnt = db.get<{ id: number; status: string }>(
    `SELECT id, status FROM stock_counts WHERE period_ym = ?
     ORDER BY CASE WHEN status = 'DRAFT' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    [periodYm]
  )
  return {
    period_ym: periodYm,
    locked: close !== undefined && close.unlocked_at === null,
    closed_at: close?.closed_at ?? null,
    closed_by: close?.closed_by ?? null,
    unlocked_at: close?.unlocked_at ?? null,
    count_id: cnt ? Number(cnt.id) : null,
    count_status: cnt ? (cnt.status === 'APPROVED' ? 'APPROVED' : 'DRAFT') : null
  }
}

// ---------- أدوات داخلية ----------

function requireCount(ctx: SvcCtx, id: number): StockCountHeaderRow {
  const c = ctx.db.get<StockCountHeaderRow>(`SELECT ${COUNT_COLS} FROM stock_counts WHERE id = ?`, [id])
  if (!c) throw new ApiError('الجرد غير موجود', 404)
  return { ...c, id: Number(c.id) }
}

function loadItems(ctx: SvcCtx, countId: number): StockCountEntryRow[] {
  return ctx.db
    .query<StockCountEntryRow>(`SELECT ${ITEM_COLS} FROM stock_count_items WHERE count_id = ? ORDER BY product_name, id`, [countId])
    .map((r) => ({
      ...r,
      id: Number(r.id),
      count_id: Number(r.count_id),
      product_id: Number(r.product_id),
      system_qty_milli: Number(r.system_qty_milli),
      actual_qty_milli: Number(r.actual_qty_milli),
      diff_milli: Number(r.diff_milli)
    }))
}

function latestCountFor(ctx: SvcCtx, periodYm: string): StockCountHeaderRow | undefined {
  // الجرد الحالي = المسودة الجارية إن وُجدت، وإلا الأحدث للفترة
  return ctx.db.get<StockCountHeaderRow>(
    `SELECT ${COUNT_COLS} FROM stock_counts WHERE period_ym = ?
     ORDER BY CASE WHEN status = 'DRAFT' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    [periodYm]
  )
}

function buildView(ctx: SvcCtx, count: StockCountHeaderRow | undefined): StockCountView {
  if (!count) return { count: null, items: [], month: null }
  return { count, items: loadItems(ctx, Number(count.id)), month: monthStatus(ctx.db, count.period_ym) }
}

function resolveCount(ctx: SvcCtx, payload: Record<string, unknown>): StockCountHeaderRow | undefined {
  const countId = optInt(payload.countId, 'المعرف', 1)
  const periodYm = payload.periodYm === undefined || payload.periodYm === null || payload.periodYm === ''
    ? null
    : requirePeriodYm(payload.periodYm)
  if (countId !== null) {
    const c = ctx.db.get<StockCountHeaderRow>(`SELECT ${COUNT_COLS} FROM stock_counts WHERE id = ?`, [countId])
    if (!c) throw new ApiError('الجرد غير موجود', 404)
    return { ...c, id: Number(c.id) }
  }
  if (periodYm !== null) return latestCountFor(ctx, periodYm)
  return ctx.db.get<StockCountHeaderRow>(`SELECT ${COUNT_COLS} FROM stock_counts ORDER BY id DESC LIMIT 1`) ?? undefined
}

// ---------- القنوات ----------

/** جرد حالي بنوده (الأحدث للفترة أو المحدد بcountId) + حالة إقفال الشهر — قراءة فقط */
export function getCount(ctx: SvcCtx, payload: Record<string, unknown>): StockCountView {
  return buildView(ctx, resolveCount(ctx, payload))
}

/** فتح جرد للشهر: يعيد المسودة القائمة أو ينشئها مع لقطة الأرصدة النظامية */
export function openCount(ctx: SvcCtx, payload: Record<string, unknown>): StockCountView {
  const periodYm = requirePeriodYm(payload.periodYm)
  assertPeriodOpen(ctx, periodYm)
  return ctx.db.tx(() => {
    const existing = latestCountFor(ctx, periodYm)
    if (existing && existing.status === 'DRAFT') return buildView(ctx, existing)

    const username = ctx.user?.username ?? 'غير معروف'
    ctx.db.run('INSERT INTO stock_counts (period_ym, status, created_at, created_by) VALUES (?, ?, ?, ?)', [
      periodYm,
      'DRAFT',
      ctx.db.now(),
      username
    ])
    const countId = ctx.db.lastId()

    // لقطة: كل منتج نشط يتتبع المخزون — الرصيد النظامي = مجموع حركاته (نفس منطق inventory.balances)
    const products = ctx.db.query<{ id: number; name: string; base_unit: string; balance: number }>(
      `SELECT p.id, p.name, p.base_unit,
              COALESCE((SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.product_id = p.id), 0) AS balance
       FROM products p
       WHERE p.active = 1 AND p.track_stock = 1
       ORDER BY p.name`
    )
    for (const p of products) {
      const system = Number(p.balance)
      ctx.db.run(
        `INSERT INTO stock_count_items (count_id, product_id, product_name, system_qty_milli, actual_qty_milli, diff_milli, reason, unit)
         VALUES (?, ?, ?, ?, ?, 0, 'أخرى', ?)`,
        [countId, Number(p.id), p.name, system, system, p.base_unit]
      )
    }
    ctx.audit('stockcount.open', 'stock_count', countId, { periodYm, items: products.length })
    return buildView(ctx, requireCount(ctx, countId))
  })
}

/** حفظ مسودة: فعلي + سبب إلزامي من القائمة + ملاحظة اختيارية (≤300) — يرفض المعتمد والشهر المقفل */
export function saveItems(ctx: SvcCtx, payload: Record<string, unknown>): StockCountView {
  const countId = reqInt(payload.countId, 'المعرف', 1)
  const items = reqArr(payload.items, 'بنود الجرد').map((r, i) => {
    const item = obj(r, `البند ${i + 1}`)
    return {
      productId: reqInt(item.productId, 'المنتج', 1),
      actualQtyMilli: reqNonNegativeMilli(item.actualQtyMilli, 'الكمية الفعلية'),
      reason: reqEnum(item.reason, 'سبب الفرق', REASONS),
      note: optStr(item.note, 'ملاحظة', 300)
    }
  })
  return ctx.db.tx(() => {
    const count = requireCount(ctx, countId)
    if (count.status === 'APPROVED') throw new ApiError('الجرد معتمد مسبقًا — لا يمكن تعديله', 409)
    assertPeriodOpen(ctx, count.period_ym)
    for (const it of items) {
      const row = ctx.db.get<{ id: number; system_qty_milli: number }>(
        'SELECT id, system_qty_milli FROM stock_count_items WHERE count_id = ? AND product_id = ?',
        [countId, it.productId]
      )
      if (!row) throw new ApiError(`المنتج رقم ${it.productId} غير موجود في هذا الجرد — أعد فتح الجرد`, 404)
      const system = Number(row.system_qty_milli)
      ctx.db.run('UPDATE stock_count_items SET actual_qty_milli = ?, diff_milli = ?, reason = ?, note = ? WHERE id = ?', [
        it.actualQtyMilli,
        it.actualQtyMilli - system,
        it.reason,
        it.note,
        Number(row.id)
      ])
    }
    ctx.audit('stockcount.saveItems', 'stock_count', countId, { items: items.length })
    return buildView(ctx, count)
  })
}

/** اعتماد الجرد داخل معاملة واحدة: كل فرق ≠ 0 يولّد حركة موثقة ثم يختم APPROVED */
export function approveCount(ctx: SvcCtx, payload: Record<string, unknown>): StockCountView & { movements: number } {
  const countId = reqInt(payload.countId, 'المعرف', 1)
  return ctx.db.tx(() => {
    const count = requireCount(ctx, countId)
    if (count.status === 'APPROVED') throw new ApiError('الجرد معتمد مسبقًا', 409)
    assertPeriodOpen(ctx, count.period_ym)
    // فهرس فريد جزئي: جرد معتمد واحد فقط لكل شهر — رسالة عربية واضحة بدل خطأ SQLite
    const otherApproved = ctx.db.get<{ id: number }>(
      "SELECT id FROM stock_counts WHERE period_ym = ? AND status = 'APPROVED' AND id != ?",
      [count.period_ym, countId]
    )
    if (otherApproved !== undefined) {
      throw new ApiError(`يوجد جرد معتمد مسبقًا لشهر ${count.period_ym} — اعتماد جرد ثانٍ للشهر نفسه غير مسموح`, 409)
    }

    const items = loadItems(ctx, countId)
    const username = ctx.user?.username ?? 'غير معروف'
    let movements = 0
    for (const it of items) {
      const diff = it.diff_milli
      if (diff === 0) continue
      // النقص بسبب هالك/تلف/فقدان → WASTE؛ ما عدا ذلك (نقص آخر أو فائض) → ADJUSTMENT
      const isWaste = diff < 0 && WASTE_REASONS.includes(it.reason)
      const type = isWaste ? 'WASTE' : 'ADJUSTMENT'
      // إشارة qty كما في inventory.ts: WASTE سالبة دائمًا، ADJUSTMENT بإشارة الفرق (سالب نقص / موجب فائض)
      const qtyMilli = isWaste ? -Math.abs(diff) : diff
      const noteText = it.note ? `جرد ${count.period_ym}: ${it.reason} — ${it.note}` : `جرد ${count.period_ym}: ${it.reason}`
      addStockMovement(ctx.db, {
        productId: it.product_id,
        qtyMilli,
        type,
        refType: 'stock_count',
        refId: countId,
        note: noteText,
        userId: ctx.user?.id ?? null
      })
      movements++
    }
    ctx.db.run('UPDATE stock_counts SET status = ?, approved_at = ?, approved_by = ? WHERE id = ?', [
      'APPROVED',
      ctx.db.now(),
      username,
      countId
    ])
    ctx.audit('stockcount.approve', 'stock_count', countId, { periodYm: count.period_ym, movements })
    return { ...buildView(ctx, requireCount(ctx, countId)), movements }
  })
}

/** إقفال الشهر: يمنع التكرار؛ يُفضّل وجود جرد معتمد وإلا رُفع تحذير في الرد */
export function closeMonth(
  ctx: SvcCtx,
  payload: Record<string, unknown>
): { closed: boolean; periodYm: string; warning: string | null } {
  const periodYm = requirePeriodYm(payload.periodYm)
  const note = optStr(payload.note, 'ملاحظة', 300)
  return ctx.db.tx(() => {
    if (isPeriodLocked(ctx, periodYm)) throw new ApiError('الشهر مقفل مسبقًا — لا يمكن إقفاله مرة أخرى', 409)
    const approved = ctx.db.get<{ id: number }>("SELECT id FROM stock_counts WHERE period_ym = ? AND status = 'APPROVED'", [periodYm])
    const warning = approved ? null : 'أُقفل الشهر دون جرد معتمد'
    const username = ctx.user?.username ?? 'غير معروف'
    const existing = ctx.db.get<{ id: number }>('SELECT id FROM month_closes WHERE period_ym = ?', [periodYm])
    if (existing) {
      // إقفال جديد لشهر فُك قفله سابقًا: نعيد الختم ونمسح أثر الفك
      ctx.db.run(
        'UPDATE month_closes SET closed_at = ?, closed_by = ?, note = COALESCE(?, note), unlocked_at = NULL, unlocked_by = NULL, unlock_reason = NULL WHERE id = ?',
        [ctx.db.now(), username, note, Number(existing.id)]
      )
    } else {
      ctx.db.run('INSERT INTO month_closes (period_ym, closed_at, closed_by, note) VALUES (?, ?, ?, ?)', [
        periodYm,
        ctx.db.now(),
        username,
        note
      ])
    }
    ctx.audit('month.close', 'month', null, { periodYm, withApprovedCount: approved !== undefined })
    return { closed: true, periodYm, warning }
  })
}

/** فك القفل: سبب إلزامي ≥ 5 أحرف يُوثق في audit_log وmonth_closes */
export function unlockMonth(ctx: SvcCtx, payload: Record<string, unknown>): { unlocked: boolean; periodYm: string } {
  const periodYm = requirePeriodYm(payload.periodYm)
  const reason = reqStr(payload.unlockReason, 'سبب فك القفل', 300)
  if (reason.length < 5) throw new ApiError('سبب فك القفل يجب أن يكون 5 أحرف على الأقل')
  return ctx.db.tx(() => {
    const row = ctx.db.get<{ id: number; unlocked_at: string | null }>(
      'SELECT id, unlocked_at FROM month_closes WHERE period_ym = ?',
      [periodYm]
    )
    if (!row || row.unlocked_at !== null) throw new ApiError('الشهر غير مقفل — لا حاجة لفك القفل', 409)
    const username = ctx.user?.username ?? 'غير معروف'
    ctx.db.run('UPDATE month_closes SET unlocked_at = ?, unlocked_by = ?, unlock_reason = ? WHERE id = ?', [
      ctx.db.now(),
      username,
      reason,
      Number(row.id)
    ])
    ctx.audit('month.unlock', 'month', null, { periodYm, reason })
    return { unlocked: true, periodYm }
  })
}

/** تقرير الفروق: أحدث جرد (أو المحدد) بنوده مع الأثر المالي diff × تكلفة الوحدة وحالة الإقفال */
export function variancesReport(ctx: SvcCtx, payload: Record<string, unknown>): VarianceReport {
  const count = resolveCount(ctx, payload)
  if (!count) throw new ApiError('لا يوجد جرد لهذا الشهر بعد', 404)
  const items = ctx.db
    .query<VarianceItemRow>(
      `SELECT sci.id, sci.count_id, sci.product_id, sci.product_name, sci.system_qty_milli, sci.actual_qty_milli,
              sci.diff_milli, sci.reason, sci.note, sci.unit, COALESCE(p.cost_minor, 0) AS cost_minor
       FROM stock_count_items sci LEFT JOIN products p ON p.id = sci.product_id
       WHERE sci.count_id = ? ORDER BY sci.id`,
      [Number(count.id)]
    )
    .map((r) => {
      const diff = Number(r.diff_milli)
      const cost = Number(r.cost_minor)
      return {
        ...r,
        id: Number(r.id),
        count_id: Number(r.count_id),
        product_id: Number(r.product_id),
        system_qty_milli: Number(r.system_qty_milli),
        actual_qty_milli: Number(r.actual_qty_milli),
        diff_milli: diff,
        cost_minor: cost,
        impact_minor: Math.round((diff * cost) / 1000)
      }
    })
  let loss = 0
  let gain = 0
  for (const it of items) {
    if (it.impact_minor < 0) loss += -it.impact_minor
    else gain += it.impact_minor
  }
  return {
    count,
    items,
    lossMinor: loss,
    gainMinor: gain,
    netMinor: gain - loss,
    month: monthStatus(ctx.db, count.period_ym)
  }
}

/** حالة أشهر مدى: مفتوحة/مقفلة + حالة الجرد لكل شهر (حد أقصى 36 شهرًا) */
export function getMonthStatuses(ctx: SvcCtx, payload: Record<string, unknown>): MonthStatusRow[] {
  const fromYm = requirePeriodYm(payload.fromYm, 'من شهر')
  const toYm =
    payload.toYm === undefined || payload.toYm === null || payload.toYm === ''
      ? fromYm
      : requirePeriodYm(payload.toYm, 'إلى شهر')
  if (toYm < fromYm) throw new ApiError('«إلى شهر» يجب أن يكون بعد «من شهر» أو مساويًا له')

  const start = parseYm(fromYm)
  const end = parseYm(toYm)
  const out: MonthStatusRow[] = []
  let y = start.y
  let m = start.m
  while (y < end.y || (y === end.y && m <= end.m)) {
    out.push(monthStatus(ctx.db, `${y}-${String(m).padStart(2, '0')}`))
    m++
    if (m > 12) {
      m = 1
      y++
    }
    if (out.length > MAX_MONTHS_RANGE) throw new ApiError(`المدى المطلوب يتجاوز ${MAX_MONTHS_RANGE} شهرًا`)
  }
  return out
}

function parseYm(ym: string): { y: number; m: number } {
  const parts = ym.split('-')
  const y = Number(parts[0] ?? '0')
  const m = Number(parts[1] ?? '0')
  return { y, m }
}

// =============================================================
// مخبز الولاء الحديث — المصروفات، الورديات، حركات الصندوق
// =============================================================
import { ApiError, reqStr, optStr, reqInt, reqMinor, reqDate, obj } from '../validate'
import {
  SvcCtx,
  addCashMovement,
  cashBalance,
  openShift
} from './helpers'
import { assertMonthOpen } from './period'

// ---------- المصروفات ----------
export function listExpenseCategories(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const includeInactive = payload.includeInactive === true
  return ctx.db.query(
    `SELECT c.id, c.name, c.active, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id AND e.status = 'ACTIVE') AS expenses_count
     FROM expense_categories c ${includeInactive ? '' : 'WHERE c.active = 1'} ORDER BY c.name`
  )
}

export function createExpenseCategory(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, number | string> {
  const name = reqStr(payload.name, 'اسم الفئة', 120)
  return ctx.db.tx(() => {
    if (ctx.db.get('SELECT id FROM expense_categories WHERE name = ?', [name])) {
      throw new ApiError('يوجد فئة بنفس الاسم', 409)
    }
    ctx.db.run('INSERT INTO expense_categories (name, active, created_at) VALUES (?, 1, ?)', [name, ctx.db.now()])
    const id = ctx.db.lastId()
    ctx.audit('expense_category.create', 'expense_category', id, { name })
    return { id, name, active: 1 }
  })
}

/**
 * rc.12 — طلب المالك: حذف فئة مصروفات أُضيفت بالخطأ — مسموح فقط إن كانت فارغة.
 */
export function deleteExpenseCategory(ctx: SvcCtx, payload: Record<string, unknown>): { id: number; deleted: true } {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    const cat = ctx.db.get<{ id: number; name: string }>('SELECT id, name FROM expense_categories WHERE id = ?', [id])
    if (!cat) throw new ApiError('فئة المصروفات غير موجودة', 404)
    const used = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM expenses WHERE category_id = ?', [id])
    if (Number(used?.c ?? 0) > 0) {
      throw new ApiError(`لا يمكن حذف الفئة «${cat.name}» — تضمّن ${used?.c} مصروفًا موثقًا`, 409)
    }
    ctx.db.run('DELETE FROM expense_categories WHERE id = ?', [id])
    ctx.audit('expense_category.delete', 'expense_category', id, { name: cat.name })
    return { id, deleted: true as const }
  })
}

export function listExpenses(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const categoryId = payload.categoryId === undefined || payload.categoryId === null ? null : reqInt(payload.categoryId, 'الفئة', 1)
  const conditions: string[] = ["e.status = 'ACTIVE'"]
  const params: unknown[] = []
  if (from) {
    conditions.push('e.date >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('e.date <= ?')
    params.push(to)
  }
  if (categoryId !== null) {
    conditions.push('e.category_id = ?')
    params.push(categoryId)
  }
  return ctx.db.query(
    `SELECT e.id, e.date, e.category_id, c.name AS category_name, e.amount_minor, e.note, e.created_at
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE ${conditions.join(' AND ')} ORDER BY e.id DESC LIMIT 500`,
    params
  )
}

export function createExpense(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const date = payload.date === undefined || payload.date === null ? ctx.db.today() : reqDate(payload.date, 'التاريخ')
  const categoryId = reqInt(payload.categoryId, 'الفئة', 1)
  const amountMinor = reqMinor(payload.amountMinor, 'المبلغ')
  if (amountMinor <= 0) throw new ApiError('مبلغ المصروف يجب أن يكون أكبر من صفر')
  const note = optStr(payload.note, 'ملاحظة', 300)
  return ctx.db.tx(() => {
    const cat = ctx.db.get('SELECT id FROM expense_categories WHERE id = ?', [categoryId])
    if (!cat) throw new ApiError('فئة المصروف غير موجودة', 404)
    // حاجز الشهر المقفل: المصروف بتاريخه هو (الافتراضي الآن)
    assertMonthOpen(ctx.db, date)
    ctx.db.run(
      `INSERT INTO expenses (date, category_id, amount_minor, note, status, user_id, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [date, categoryId, amountMinor, note, ctx.user?.id ?? null, ctx.db.now()]
    )
    const id = ctx.db.lastId()
    addCashMovement(ctx.db, { type: 'EXPENSE', amountMinor: -amountMinor, refType: 'expense', refId: id, note: note ?? 'مصروف', date, userId: ctx.user?.id ?? null })
    ctx.audit('expense.create', 'expense', id, { amountMinor, categoryId })
    return { id }
  })
}

export function cancelExpense(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const reason = reqStr(payload.reason, 'سبب الإلغاء', 300)
  return ctx.db.tx(() => {
    const e = ctx.db.get<{ id: number; amount_minor: number; status: string; date: string }>('SELECT id, amount_minor, status, date FROM expenses WHERE id = ?', [id])
    if (!e) throw new ApiError('المصروف غير موجود', 404)
    if (e.status === 'CANCELLED') throw new ApiError('المصروف ملغى مسبقًا', 409)
    // حاجز الشهر المقفل: بتاريخ المصروف الأصلي — بعد جلب السجل وقبل أي كتابة
    assertMonthOpen(ctx.db, e.date)
    addCashMovement(ctx.db, {
      type: 'ADJUSTMENT',
      amountMinor: Number(e.amount_minor),
      refType: 'expense_cancel',
      refId: id,
      note: `إلغاء مصروف: ${reason}`,
      date: e.date,
      userId: ctx.user?.id ?? null
    })
    ctx.db.run('UPDATE expenses SET status = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?', ['CANCELLED', ctx.db.now(), reason, id])
    ctx.audit('expense.cancel', 'expense', id, { reason })
    return { done: true }
  })
}

// ---------- الورديات ----------
export function currentShift(ctx: SvcCtx): Record<string, unknown> {
  const s = openShift(ctx.db)
  if (!s) return { shift: null, cashBalanceMinor: cashBalance(ctx.db) }
  const totals = shiftTotals(ctx, s.id)
  return { shift: { ...s, ...totals }, cashBalanceMinor: cashBalance(ctx.db) }
}

function shiftTotals(ctx: SvcCtx, shiftId: number): { inflowMinor: number; outflowMinor: number; expectedMinor: number } {
  const r = ctx.db.get<{ inflow: number; outflow: number }>(
    `SELECT COALESCE(SUM(CASE WHEN amount_minor > 0 THEN amount_minor ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN amount_minor < 0 THEN -amount_minor ELSE 0 END), 0) AS outflow
     FROM cash_movements WHERE shift_id = ?`,
    [shiftId]
  )
  const inflow = Number(r?.inflow ?? 0)
  const outflow = Number(r?.outflow ?? 0)
  return { inflowMinor: inflow, outflowMinor: outflow, expectedMinor: inflow - outflow }
}

export function openShiftSvc(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const openingCash = payload.openingCashMinor === undefined || payload.openingCashMinor === null ? 0 : reqMinor(payload.openingCashMinor, 'نقدية الافتتاح')
  return ctx.db.tx(() => {
    if (openShift(ctx.db)) throw new ApiError('توجد وردية مفتوحة بالفعل — أغلقها أولًا', 409)
    // حاجز الشهر المقفل: فتح وردية يسجل نقدية افتتاح بتاريخ الآن
    assertMonthOpen(ctx.db, new Date())
    ctx.db.run(
      `INSERT INTO shifts (opened_at, opening_cash_minor, status, user_id) VALUES (?, ?, 'OPEN', ?)`,
      [ctx.db.now(), openingCash, ctx.user?.id ?? null]
    )
    const id = ctx.db.lastId()
    if (openingCash > 0) {
      addCashMovement(ctx.db, { type: 'OPENING', amountMinor: openingCash, refType: 'shift', refId: id, note: 'افتتاح وردية', userId: ctx.user?.id ?? null })
    }
    ctx.audit('shift.open', 'shift', id, { openingCash })
    return currentShift(ctx)
  })
}

export function closeShiftSvc(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const counted = payload.countedCashMinor === undefined || payload.countedCashMinor === null ? 0 : reqMinor(payload.countedCashMinor, 'النقد المجرود')
  const notes = optStr(payload.notes, 'ملاحظات', 500)
  return ctx.db.tx(() => {
    const s = openShift(ctx.db)
    if (!s) throw new ApiError('لا توجد وردية مفتوحة', 409)
    // حاجز الشهر المقفل: إغلاق الوردية يوثّق النقد بتاريخ الآن (مطابق للويب)
    assertMonthOpen(ctx.db, new Date())
    const totals = shiftTotals(ctx, s.id)
    const expected = totals.expectedMinor
    const difference = counted - expected
    ctx.db.run(
      `UPDATE shifts SET closed_at = ?, expected_cash_minor = ?, counted_cash_minor = ?, difference_minor = ?, status = 'CLOSED', notes = ? WHERE id = ?`,
      [ctx.db.now(), expected, counted, difference, notes, s.id]
    )
    ctx.audit('shift.close', 'shift', s.id, { expected, counted, difference })
    return { id: s.id, expectedMinor: expected, countedMinor: counted, differenceMinor: difference }
  })
}

export function listShifts(ctx: SvcCtx): unknown[] {
  return ctx.db.query(
    `SELECT s.id, s.opened_at, s.closed_at, s.opening_cash_minor, s.expected_cash_minor, s.counted_cash_minor,
            s.difference_minor, s.status, u.name AS user_name
     FROM shifts s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 200`
  )
}

// ---------- حركات الصندوق ----------
export function listCash(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const shiftId = payload.shiftId === undefined || payload.shiftId === null ? null : reqInt(payload.shiftId, 'الوردية', 1)
  const conditions: string[] = []
  const params: unknown[] = []
  if (from) {
    conditions.push('date >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('date <= ?')
    params.push(to)
  }
  if (shiftId !== null) {
    conditions.push('shift_id = ?')
    params.push(shiftId)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return ctx.db.query(
    `SELECT id, date, shift_id, type, ref_type, ref_id, amount_minor, note, created_at
     FROM cash_movements ${where} ORDER BY id DESC LIMIT 500`,
    params
  )
}

/** حركة صندوق يدوية موثقة (تسوية صندوق) — تتطلب صلاحية إدارة الإعدادات */
export function recordCash(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const input = obj(payload, 'payload')
  const amountMinor = reqInt(input.amountMinor, 'المبلغ الموقع', -1_000_000_000, 1_000_000_000)
  if (amountMinor === 0) throw new ApiError('المبلغ لا يمكن أن يكون صفرًا')
  const reason = reqStr(input.reason, 'السبب', 300)
  const date = input.date === undefined || input.date === null ? ctx.db.today() : reqDate(input.date, 'التاريخ')
  return ctx.db.tx(() => {
    // rc.12-merge: حركة صندوق يدوية بتاريخ اختياري — خضوعها لحاجز الشهر المقفل كانت مفقودة كليًا
    // (منع تسجيل حركة نقدية يدوية في شهر مقفل — إصلاح من تدقيق local)
    assertMonthOpen(ctx.db, date)
    addCashMovement(ctx.db, { type: 'ADJUSTMENT', amountMinor, refType: 'manual', note: reason, date, userId: ctx.user?.id ?? null })
    ctx.audit('cash.record', 'cash', null, { amountMinor, reason })
    return { done: true }
  })
}

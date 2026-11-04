// =============================================================
// مخبز الولاء الحديث — التقارير (من الحركات الفعلية فقط)
// =============================================================
import { optStr } from '../validate'
import type { DashboardReport, SaleRow, CompareBlock, AlertsInfo, DashboardExtra, EodData } from '../../shared/types'
import { monthKeyOf } from '../../shared/period'
import type { BakeryDb } from '../db'
import { SvcCtx, businessName, cashBalance, openShift, getSetting } from './helpers'

function range(payload: Record<string, unknown>): { from: string; to: string } {
  const from = optStr(payload.from, 'من', 10) ?? '2000-01-01'
  const to = optStr(payload.to, 'إلى', 10) ?? '2999-12-31'
  return { from, to }
}

export function dashboard(ctx: SvcCtx): DashboardReport {
  const db = ctx.db
  const today = db.today()
  const sales = db.get<{ total: number; cnt: number }>(
    `SELECT COALESCE(SUM(total_minor),0) AS total, COUNT(*) AS cnt FROM sales WHERE date = ? AND status != 'CANCELLED'`,
    [today]
  )
  const receivables = db.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM customer_ledger')
  const payables = db.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM supplier_ledger')
  const low = db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM products p WHERE p.track_stock = 1 AND p.active = 1
     AND COALESCE((SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.product_id = p.id), 0) < p.min_stock_milli`
  )
  const recent = db.query<SaleRow>(
    `SELECT s.id, s.invoice_no, s.date, s.customer_id, c.name AS customer_name, s.total_minor, s.paid_minor, s.credit_minor, s.status, s.source, s.created_at
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.id DESC LIMIT 8`
  )
  return {
    businessName: businessName(db),
    currencySymbol: getSetting(db, 'currency_symbol') ?? '₪',
    todaySalesMinor: Number(sales?.total ?? 0),
    todaySalesCount: Number(sales?.cnt ?? 0),
    cashBalanceMinor: cashBalance(db),
    receivablesMinor: Number(receivables?.s ?? 0),
    payablesMinor: Number(payables?.s ?? 0),
    lowStockCount: Number(low?.c ?? 0),
    openShift: openShift(db) ?? null,
    recentSales: recent.map((r) => ({ ...r, total_minor: Number(r.total_minor), paid_minor: Number(r.paid_minor), credit_minor: Number(r.credit_minor) }))
  }
}

export function salesReport(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const { from, to } = range(payload)
  return ctx.db.query(
    `SELECT date, COUNT(*) AS invoices, SUM(total_minor) AS total_minor, SUM(paid_minor) AS paid_minor, SUM(credit_minor) AS credit_minor
     FROM sales WHERE date BETWEEN ? AND ? AND status != 'CANCELLED'
     GROUP BY date ORDER BY date DESC`,
    [from, to]
  )
}

export function collectionsReport(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const { from, to } = range(payload)
  return ctx.db.query(
    `SELECT date(l.created_at) AS date, c.name AS customer_name, -l.amount_minor AS amount_minor, l.ref_type, l.note
     FROM customer_ledger l JOIN customers c ON c.id = l.customer_id
     WHERE l.amount_minor < 0 AND date(l.created_at) BETWEEN ? AND ?
     ORDER BY l.created_at DESC LIMIT 500`,
    [from, to]
  )
}

export function debtsReport(ctx: SvcCtx): unknown[] {
  return ctx.db.query(
    `SELECT c.id, c.name, c.phone, COALESCE(SUM(l.amount_minor), 0) AS balance_minor
     FROM customers c JOIN customer_ledger l ON l.customer_id = c.id
     GROUP BY c.id HAVING balance_minor > 0 ORDER BY balance_minor DESC`
  )
}

export function supplierBalancesReport(ctx: SvcCtx): unknown[] {
  return ctx.db.query(
    `SELECT s.id, s.name, s.phone, COALESCE(SUM(l.amount_minor), 0) AS balance_minor
     FROM suppliers s JOIN supplier_ledger l ON l.supplier_id = s.id
     GROUP BY s.id HAVING balance_minor > 0 ORDER BY balance_minor DESC`
  )
}

export function purchasesReport(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const { from, to } = range(payload)
  return ctx.db.query(
    `SELECT date, COUNT(*) AS invoices, SUM(total_minor) AS total_minor, SUM(paid_minor) AS paid_minor
     FROM purchases WHERE date BETWEEN ? AND ? AND status != 'CANCELLED'
     GROUP BY date ORDER BY date DESC`,
    [from, to]
  )
}

export function inventoryValuationReport(ctx: SvcCtx): unknown {
  const rows = ctx.db.query<{ name: string; base_unit: string; balance: number; cost: number; value: number }>(
    `SELECT p.name, p.base_unit,
            COALESCE((SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.product_id = p.id), 0) AS balance,
            p.cost_minor AS cost,
            COALESCE((SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.product_id = p.id), 0) * p.cost_minor / 1000 AS value
     FROM products p WHERE p.track_stock = 1 AND p.active = 1 ORDER BY p.name`
  )
  const total = rows.reduce((s, r) => s + Number(r.value), 0)
  return { totalValueMinor: Math.round(total), items: rows.map((r) => ({ ...r, balance: Number(r.balance), cost: Number(r.cost), value: Number(r.value) })) }
}

export function productionReport(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const { from, to } = range(payload)
  return ctx.db.query(
    `SELECT b.date, COUNT(*) AS batches, SUM(b.actual_qty_milli) AS produced_milli, SUM(b.waste_qty_milli) AS waste_milli,
            SUM(b.material_cost_minor) AS material_cost_minor
     FROM production_batches b WHERE b.date BETWEEN ? AND ? AND b.status = 'ACTIVE'
     GROUP BY b.date ORDER BY b.date DESC`,
    [from, to]
  )
}

export function expensesReport(ctx: SvcCtx, payload: Record<string, unknown>): unknown {
  const { from, to } = range(payload)
  const byCategory = ctx.db.query(
    `SELECT c.name AS category_name, SUM(e.amount_minor) AS total_minor, COUNT(*) AS count
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.date BETWEEN ? AND ? AND e.status = 'ACTIVE'
     GROUP BY e.category_id ORDER BY total_minor DESC`,
    [from, to]
  )
  const byDate = ctx.db.query(
    `SELECT date, SUM(amount_minor) AS total_minor FROM expenses
     WHERE date BETWEEN ? AND ? AND status = 'ACTIVE' GROUP BY date ORDER BY date DESC`,
    [from, to]
  )
  const total = (byDate as Array<{ total_minor: number }>).reduce((s, r) => s + Number(r.total_minor), 0)
  return { totalMinor: total, byCategory, byDate }
}

export function cashReport(ctx: SvcCtx, payload: Record<string, unknown>): unknown {
  const { from, to } = range(payload)
  const rows = ctx.db.query<{ date: string; type: string; inflow: number; outflow: number }>(
    `SELECT date, type,
            COALESCE(SUM(CASE WHEN amount_minor > 0 THEN amount_minor ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN amount_minor < 0 THEN -amount_minor ELSE 0 END), 0) AS outflow
     FROM cash_movements WHERE date BETWEEN ? AND ? GROUP BY date, type ORDER BY date DESC`,
    [from, to]
  )
  return { balanceMinor: cashBalance(ctx.db), rows: rows.map((r) => ({ ...r, inflow: Number(r.inflow), outflow: Number(r.outflow) })) }
}

export function distributionReport(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const { from, to } = range(payload)
  return ctx.db.query(
    `SELECT t.trip_no, t.date, r.name AS rep_name, t.status,
            (SELECT COALESCE(SUM(qty_milli),0) FROM trip_loads WHERE trip_id = t.id) AS loaded_milli,
            (SELECT COUNT(*) FROM trip_sales WHERE trip_id = t.id) AS sales_count,
            (SELECT COUNT(*) FROM trip_returns WHERE trip_id = t.id) AS returns_count,
            t.settled_at
     FROM distribution_trips t JOIN distribution_reps r ON r.id = t.rep_id
     WHERE t.date BETWEEN ? AND ? ORDER BY t.date DESC LIMIT 300`,
    [from, to]
  )
}

// =============================================================
// rc.9 — المرحلة 2: بيانات اللوحة المتقدمة (رسم + مقارنات + أعلى منتجات
// + أكبر المدينين + تنبيهات) — كلها من الحركات الفعلية فقط.
// =============================================================

const DAY_MS = 24 * 60 * 60 * 1000

function isoDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function shiftDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS)
}

function monthRange(ym: string): { from: string; to: string; prevFrom: string; prevTo: string } {
  const parts = ym.split('-')
  const y = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 1)
  const lastDay = new Date(y, m, 0).getDate()
  const prevLast = new Date(y, m - 1, 0)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    from: `${y}-${pad(m)}-01`,
    to: `${y}-${pad(m)}-${pad(lastDay)}`,
    prevFrom: `${prevLast.getFullYear()}-${pad(prevLast.getMonth() + 1)}-01`,
    prevTo: isoDate(prevLast)
  }
}

function salesSumBetween(db: BakeryDb, from: string, to: string): { total: number; cnt: number } {
  const r = db.get<{ total: number; cnt: number }>(
    `SELECT COALESCE(SUM(total_minor),0) AS total, COUNT(*) AS cnt
     FROM sales WHERE date BETWEEN ? AND ? AND status != 'CANCELLED'`,
    [from, to]
  )
  return { total: Number(r?.total ?? 0), cnt: Number(r?.cnt ?? 0) }
}

function compareBlock(
  label: string,
  cur: { total: number; cnt: number },
  prev: { total: number; cnt: number } | null
): CompareBlock {
  const hasPrev = prev !== null && prev.cnt > 0
  return {
    label,
    currentMinor: cur.total,
    currentInvoices: cur.cnt,
    previousMinor: hasPrev ? prev.total : null,
    previousInvoices: hasPrev ? prev.cnt : null,
    deltaMinor: hasPrev ? cur.total - prev.total : null,
    deltaPct: hasPrev && prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null
  }
}

/** بيانات اللوحة الإضافية: سلسلة شهر، مقارنات، أعلى منتجات، أكبر مدينين، تنبيهات */
export function dashboardExtra(ctx: SvcCtx, payload: Record<string, unknown>): DashboardExtra {
  const db = ctx.db
  const month = /^\d{4}-\d{2}$/.test(String(payload.month ?? '')) ? String(payload.month) : monthKeyOf(new Date())
  const { from, to, prevFrom, prevTo } = monthRange(month)
  const today = new Date()

  // 1) سلسلة المبيعات اليومية للشهر المختار
  const series = db
    .query<{ date: string; total_minor: number; invoices: number }>(
      `SELECT date, SUM(total_minor) AS total_minor, COUNT(*) AS invoices
       FROM sales WHERE date BETWEEN ? AND ? AND status != 'CANCELLED'
       GROUP BY date ORDER BY date`,
      [from, to]
    )
    .map((r) => ({ date: r.date, total_minor: Number(r.total_minor), invoices: Number(r.invoices) }))
  const monthTotalMinor = series.reduce((s, p) => s + p.total_minor, 0)

  // 2) المقارنات الثلاث (أسبوع/شهر/سنة) — كل واحدة مع سابقتها
  const weekCur = salesSumBetween(db, isoDate(shiftDays(today, -6)), isoDate(today))
  const weekPrev = salesSumBetween(db, isoDate(shiftDays(today, -13)), isoDate(shiftDays(today, -7)))
  const monthCur = salesSumBetween(db, from, to)
  const monthPrev = salesSumBetween(db, prevFrom, prevTo)
  const y = today.getFullYear()
  const yearCur = salesSumBetween(db, `${y}-01-01`, `${y}-12-31`)
  const yearPrev = salesSumBetween(db, `${y - 1}-01-01`, `${y - 1}-12-31`)
  const compares = [
    compareBlock('آخر 7 أيام مقابل السابقة', weekCur, weekPrev),
    compareBlock('الشهر المختار مقابل الشهر السابق', monthCur, monthPrev),
    compareBlock(`${y} مقابل ${y - 1}`, yearCur, yearPrev)
  ]

  // 3) أعلى منتجات — فترة الأسبوع الأخير (تُحدَّث من الواجهة بتبديل المفتاح عبر payload.topKey)
  const topKey = String(payload.topKey ?? 'week')
  const topFrom = topKey === 'year' ? `${y}-01-01` : topKey === 'month' ? from : isoDate(shiftDays(today, -6))
  const topProducts = db
    .query<{ product_id: number; product_name: string; qty_milli: number; revenue_minor: number }>(
      `SELECT si.product_id, p.name AS product_name, SUM(si.qty_milli) AS qty_milli, SUM(si.line_total_minor) AS revenue_minor
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.status != 'CANCELLED' AND s.date BETWEEN ? AND ?
       GROUP BY si.product_id, p.name
       ORDER BY revenue_minor DESC LIMIT 8`,
      [topFrom, isoDate(today)]
    )
    .map((r) => ({ ...r, product_id: Number(r.product_id), qty_milli: Number(r.qty_milli), revenue_minor: Number(r.revenue_minor) }))

  // 4) أكبر 3 مدينين — رصيد قائم + أقدم فاتورة آجلة غير مسددة
  const debtors = db
    .query<{ customer_id: number; customer_name: string; balance_minor: number; oldest_unpaid_date: string | null }>(
      `SELECT l.customer_id, c.name AS customer_name, SUM(l.amount_minor) AS balance_minor,
        (SELECT MIN(s.date) FROM sales s
          WHERE s.customer_id = l.customer_id AND s.credit_minor > 0 AND s.status != 'CANCELLED') AS oldest_unpaid_date
       FROM customer_ledger l JOIN customers c ON c.id = l.customer_id
       GROUP BY l.customer_id, c.name
       HAVING SUM(l.amount_minor) > 0
       ORDER BY balance_minor DESC LIMIT 3`
    )
    .map((r) => {
      const days = r.oldest_unpaid_date ? Math.floor((today.getTime() - new Date(r.oldest_unpaid_date + 'T00:00:00').getTime()) / DAY_MS) : 0
      return { ...r, customer_id: Number(r.customer_id), balance_minor: Number(r.balance_minor), days_late: Math.max(0, days) }
    })

  // 5) تنبيهات: متأخرون 30+ يوم + عمر الوردية المفتوحة
  const late = db.get<{ c: number; s: number }>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(bal),0) AS s FROM (
       SELECT l.customer_id, SUM(l.amount_minor) AS bal,
         (SELECT MIN(s2.date) FROM sales s2 WHERE s2.customer_id = l.customer_id AND s2.credit_minor > 0 AND s2.status != 'CANCELLED') AS oldest
       FROM customer_ledger l GROUP BY l.customer_id HAVING SUM(l.amount_minor) > 0
     )
     WHERE oldest IS NOT NULL AND julianday('now') - julianday(oldest) > 30`
  )
  const shift = openShift(db)
  let openShiftHours: number | null = null
  if (shift) {
    const opened = new Date(shift.opened_at).getTime()
    if (Number.isFinite(opened)) openShiftHours = Math.max(0, Math.floor((Date.now() - opened) / (60 * 60 * 1000)))
  }
  const alerts: AlertsInfo = {
    lateOver30Count: Number(late?.c ?? 0),
    lateOver30Minor: Number(late?.s ?? 0),
    openShiftHours,
    openShiftDays: openShiftHours === null ? 0 : Math.floor(openShiftHours / 24)
  }

  return {
    currencySymbol: getSetting(db, 'currency_symbol') ?? '₪',
    monthSeries: series,
    monthTotalMinor,
    compares,
    topPeriod: { key: topKey, label: topKey === 'year' ? 'هذه السنة' : topKey === 'month' ? 'هذا الشهر' : 'آخر 7 أيام', from: topFrom, to: isoDate(today) },
    topProducts,
    debtors,
    alerts
  }
}

// =============================================================
// rc.9 — المرحلة 3: ورقة نهاية اليوم (تُعرض وتُطبع A4 من اللوحة)
// =============================================================

export function eod(ctx: SvcCtx, payload: Record<string, unknown>): EodData {
  const db = ctx.db
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date ?? '')) ? String(payload.date) : db.today()

  const salesAgg = db.get<{ c: number; total: number; credit: number }>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total_minor),0) AS total, COALESCE(SUM(credit_minor),0) AS credit
     FROM sales WHERE date = ? AND status != 'CANCELLED'`,
    [date]
  )
  const byMethod = db
    .query<{ method: string; amount_minor: number }>(
      `SELECT p.method, SUM(p.amount_minor) AS amount_minor
       FROM sale_payments p JOIN sales s ON s.id = p.sale_id
       WHERE s.date = ? AND s.status != 'CANCELLED'
       GROUP BY p.method ORDER BY amount_minor DESC`,
      [date]
    )
    .map((r) => ({ method: r.method, amount_minor: Number(r.amount_minor) }))
  const collections = db.get<{ s: number }>(
    `SELECT COALESCE(SUM(-amount_minor),0) AS s FROM customer_ledger
     WHERE amount_minor < 0 AND date(created_at) = ?`,
    [date]
  )
  const expenses = db.get<{ s: number }>(
    `SELECT COALESCE(SUM(amount_minor),0) AS s FROM expenses WHERE date = ? AND status = 'ACTIVE'`,
    [date]
  )
  const cashNet = db.get<{ s: number }>(
    `SELECT COALESCE(SUM(amount_minor),0) AS s FROM cash_movements WHERE date = ?`,
    [date]
  )
  const topItems = db
    .query<{ product_name: string; qty_milli: number; revenue_minor: number }>(
      `SELECT p.name AS product_name, SUM(si.qty_milli) AS qty_milli, SUM(si.line_total_minor) AS revenue_minor
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       WHERE s.date = ? AND s.status != 'CANCELLED'
       GROUP BY p.name ORDER BY revenue_minor DESC LIMIT 10`,
      [date]
    )
    .map((r) => ({ ...r, qty_milli: Number(r.qty_milli), revenue_minor: Number(r.revenue_minor) }))
  const shift = openShift(db)

  const salesTotalMinor = Number(salesAgg?.total ?? 0)
  const collectionsMinor = Number(collections?.s ?? 0)
  const expensesMinor = Number(expenses?.s ?? 0)
  const cashInMinor = Number(byMethod.filter((m) => m.method === 'CASH').reduce((s, m) => s + m.amount_minor, 0))

  return {
    businessName: businessName(db),
    currencySymbol: getSetting(db, 'currency_symbol') ?? '₪',
    date,
    invoicesCount: Number(salesAgg?.c ?? 0),
    salesTotalMinor,
    cashInMinor,
    collectionsMinor,
    expensesMinor,
    cashNetMinor: Number(cashNet?.s ?? 0),
    creditSalesMinor: Number(salesAgg?.credit ?? 0),
    byMethod,
    topItems,
    openShift: shift ? { id: shift.id, opened_at: shift.opened_at } : null
  }
}

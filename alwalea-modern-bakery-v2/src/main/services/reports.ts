// =============================================================
// مخبز الولاء الحديث — التقارير (من الحركات الفعلية فقط)
// =============================================================
import { optStr } from '../validate'
import type { DashboardReport, SaleRow } from '../../shared/types'
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

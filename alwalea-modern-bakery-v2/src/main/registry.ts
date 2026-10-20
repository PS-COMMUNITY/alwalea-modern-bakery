// =============================================================
// مخبز الولاء الحديث — سجل القنوات والتحقق من الصلاحيات (يُفرض هنا)
// كل قناة IPC → صلاحية مطلوبة (أو public) → دالة الخدمة
// =============================================================
import type { ApiEnvelope, IpcChannel } from '../shared/types'
import { isIpcChannel } from '../shared/types'
import { hasPerm, type Perm } from '../shared/permissions'
import type { BakeryDb } from './db'
import { ApiError } from './validate'
import { SvcCtx } from './services/helpers'
import { requireSessionUser } from './services/auth'

import * as auth from './services/auth'
import * as setup from './services/setup'
import * as su from './services/settings-users'
import * as catalog from './services/catalog'
import * as parties from './services/parties'
import * as sales from './services/sales'
import * as purchases from './services/purchases'
import * as inventory from './services/inventory'
import * as production from './services/production'
import * as dist from './services/distribution'
import * as finance from './services/finance'
import * as reports from './services/reports'
import * as backup from './services/backup'

type Handler = (ctx: SvcCtx, payload: Record<string, unknown>) => unknown
interface Route {
  /** الصلاحية المطلوبة — undefined يتطلب مستخدمًا مسجلًا فقط */
  perm?: Perm | undefined
  /** قناة عامة (بدون جلسة): status/setup/login */
  public?: boolean | undefined
  handler: Handler
}

const R = {} as Record<string, Route>
function route(ch: IpcChannel, handler: Handler, perm?: Perm): void {
  R[ch] = { handler, perm }
}
function publicRoute(ch: IpcChannel, handler: Handler): void {
  R[ch] = { handler, public: true }
}

function requirePerm(ctx: SvcCtx, perm: Perm): void {
  if (!ctx.user || !hasPerm(ctx.user.role, perm)) {
    throw new ApiError('ليست لديك صلاحية لتنفيذ هذا الإجراء', 403)
  }
}

// ---------- عام ----------
publicRoute('status.get', (ctx) => {
  const setupCompleted = (ctx.db.get<{ v: string }>("SELECT value AS v FROM settings WHERE key = 'setup_completed'")?.v ?? '0') === '1'
  return {
    setupCompleted,
    businessName: setupCompleted ? (ctx.db.get<{ v: string }>("SELECT value AS v FROM settings WHERE key = 'business_name'")?.v ?? null) : null,
    version: '1.0.0',
    schemaVersion: 1
  }
})
publicRoute('setup.run', setup.runSetup)
publicRoute('auth.login', auth.login)

// ---------- مصادقة ----------
route('auth.me', auth.me)
route('auth.logout', auth.logout)

// ---------- إعدادات ----------
route('settings.get', su.getSettings)
route('settings.update', su.updateSettings, 'settings.manage')

// ---------- مستخدمون ----------
route('users.list', su.listUsers, 'users.manage')
route('users.create', su.createUserSvc, 'users.manage')
route('users.update', su.updateUser, 'users.manage')
// كلمة المرور و PIN: للمستخدم نفسه أو من يملك users.manage
route('users.setPassword', (ctx, p) => {
  const self = ctx.user?.id === p.id
  if (!self) requirePerm(ctx, 'users.manage')
  return su.setPassword(ctx, p)
})
route('users.setPin', (ctx, p) => {
  const self = ctx.user?.id === p.id
  if (!self) requirePerm(ctx, 'users.manage')
  return su.setPin(ctx, p)
})

// ---------- كتالوج ----------
route('categories.list', catalog.listCategories, 'products.view')
route('categories.create', catalog.createCategory, 'categories.manage')
route('categories.update', catalog.updateCategory, 'categories.manage')
route('products.list', catalog.listProducts, 'products.view')
route('products.get', catalog.getProduct, 'products.view')
route('products.create', catalog.createProduct, 'products.manage')
route('products.update', catalog.updateProduct, 'products.manage')

// ---------- عملاء وموردون ----------
route('customers.list', parties.listCustomers, 'customers.view')
route('customers.get', parties.getCustomer, 'customers.view')
route('customers.statement', parties.customerStatement, 'customers.view')
route('customers.create', parties.createCustomer, 'customers.manage')
route('customers.update', parties.updateCustomer, 'customers.manage')
route('customers.payment', parties.customerPayment, 'customers.collect')
route('customers.adjust', parties.customerAdjust, 'customers.manage')
route('suppliers.list', parties.listSuppliers, 'suppliers.view')
route('suppliers.get', parties.getSupplier, 'suppliers.view')
route('suppliers.statement', parties.supplierStatement, 'suppliers.view')
route('suppliers.create', parties.createSupplier, 'suppliers.manage')
route('suppliers.update', parties.updateSupplier, 'suppliers.manage')
route('suppliers.payment', parties.supplierPayment, 'suppliers.pay')

// ---------- مبيعات ----------
route('sales.list', sales.listSales, 'sales.view')
route('sales.get', sales.getSale, 'sales.view')
route('sales.create', sales.createSale, 'pos.use')
route('sales.cancel', sales.cancelSale, 'sales.cancel')

// ---------- مشتريات ----------
route('purchases.list', purchases.listPurchases, 'purchases.view')
route('purchases.get', purchases.getPurchase, 'purchases.view')
route('purchases.create', purchases.createPurchase, 'purchases.manage')
route('purchases.cancel', purchases.cancelPurchase, 'purchases.cancel')
route('purchases.payment', purchases.paySupplierViaPurchase, 'suppliers.pay')

// ---------- مخزون ----------
route('inventory.balances', inventory.balances, 'inventory.view')
route('inventory.movements', inventory.movements, 'inventory.view')
route('inventory.opening', inventory.opening, 'inventory.opening')
route('inventory.adjust', inventory.adjust, 'inventory.adjust')
route('inventory.waste', inventory.waste, 'inventory.waste')
route('inventory.low', (ctx) => inventory.lowStock(ctx), 'inventory.view')

// ---------- وصفات وإنتاج ----------
route('recipes.list', production.listRecipes, 'production.view')
route('recipes.get', production.getRecipe, 'production.view')
route('recipes.create', production.createRecipe, 'production.manage')
route('recipes.update', production.updateRecipe, 'production.manage')
route('production.list', production.listBatches, 'production.view')
route('production.create', production.createBatch, 'production.manage')
route('production.cancel', production.cancelBatch, 'production.manage')

// ---------- توزيع ----------
route('distribution.reps.list', dist.listReps, 'distribution.view')
route('distribution.reps.create', dist.createRep, 'distribution.manage')
route('distribution.reps.update', dist.updateRep, 'distribution.manage')
route('distribution.routes.list', dist.listRoutes, 'distribution.view')
route('distribution.routes.create', dist.createRoute, 'distribution.manage')
route('distribution.routes.update', dist.updateRoute, 'distribution.manage')
route('distribution.trips.list', dist.listTrips, 'distribution.view')
route('distribution.trips.get', dist.getTrip, 'distribution.view')
route('distribution.trips.create', dist.createTrip, 'distribution.manage')
route('distribution.trips.load', dist.addLoad, 'distribution.manage')
route('distribution.trips.sale', dist.addTripSale, 'distribution.manage')
route('distribution.trips.return', dist.addTripReturn, 'distribution.manage')
route('distribution.trips.settle', dist.settleTrip, 'distribution.manage')
route('distribution.trips.cancel', dist.cancelTrip, 'distribution.manage')

// ---------- مصروفات ----------
route('expenses.categories.list', finance.listExpenseCategories, 'expenses.view')
route('expenses.categories.create', finance.createExpenseCategory, 'expenses.manage')
route('expenses.list', finance.listExpenses, 'expenses.view')
route('expenses.create', finance.createExpense, 'expenses.manage')
route('expenses.cancel', finance.cancelExpense, 'expenses.manage')

// ---------- ورديات وصندوق ----------
route('shifts.current', finance.currentShift, 'shifts.view')
route('shifts.open', finance.openShiftSvc, 'shifts.use')
route('shifts.close', finance.closeShiftSvc, 'shifts.close')
route('shifts.list', (ctx) => finance.listShifts(ctx), 'shifts.view')
route('cash.list', finance.listCash, 'shifts.view')
route('cash.record', finance.recordCash, 'settings.manage')

// ---------- تقارير ----------
route('reports.dashboard', (ctx) => reports.dashboard(ctx))
route('reports.sales', reports.salesReport, 'reports.financial')
route('reports.collections', reports.collectionsReport, 'reports.financial')
route('reports.debts', (ctx) => reports.debtsReport(ctx), 'reports.financial')
route('reports.suppliers', (ctx) => reports.supplierBalancesReport(ctx), 'reports.financial')
route('reports.purchases', reports.purchasesReport, 'reports.financial')
route('reports.inventory', (ctx) => reports.inventoryValuationReport(ctx), 'reports.operations')
route('reports.production', reports.productionReport, 'reports.operations')
route('reports.expenses', reports.expensesReport, 'reports.financial')
route('reports.cash', reports.cashReport, 'reports.financial')
route('reports.distribution', reports.distributionReport, 'reports.operations')

// ---------- تدقيق ونسخ ----------
route('audit.list', su.listAudit, 'audit.view')
route('backup.export', backup.exportBackup, 'backup.manage')
route('backup.list', backup.listBackups, 'backup.manage')
route('backup.preview', backup.previewBackup, 'backup.manage')
route('backup.restore', backup.restoreBackup, 'backup.manage')

export type DispatchResult = ApiEnvelope

export function dispatch(db: BakeryDb, channel: unknown, payload: unknown): DispatchResult {
  if (!isIpcChannel(channel)) {
    return { ok: false, error: 'قناة IPC غير معروفة', code: 404 }
  }
  const r = R[channel]
  if (!r) {
    return { ok: false, error: 'قناة غير مفعلة', code: 404 }
  }
  const p = (typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>
  try {
    let user: SvcCtx['user'] = null
    if (!r.public) {
      user = requireSessionUser(db, p.token)
      if (r.perm && !hasPerm(user.role, r.perm)) {
        throw new ApiError('ليست لديك صلاحية لتنفيذ هذا الإجراء', 403)
      }
    }
    const ctx: SvcCtx = {
      db,
      user,
      audit: (action, entity, entityId, details) => {
        db.run(
          `INSERT INTO audit_log (date, user_id, username, action, entity, entity_id, details, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            db.today(),
            user?.id ?? null,
            user?.username ?? null,
            action,
            entity ?? null,
            entityId ?? null,
            details === undefined || details === null ? null : JSON.stringify(details),
            db.now()
          ]
        )
      }
    }
    const data = r.handler(ctx, p)
    return { ok: true, data }
  } catch (e) {
    if (e instanceof ApiError) {
      return { ok: false, error: e.message, code: e.code }
    }
    const msg = e instanceof Error ? e.message : String(e)
    // رسائل SQL/أخطاء غير متوقعة
    return { ok: false, error: `خطأ غير متوقع: ${msg}`, code: 500 }
  }
}

export function knownChannels(): string[] {
  return Object.keys(R)
}

// =============================================================
// QA Harness — يستدعي معالجات المسارات الحقيقية على قاعدة معزولة
// DATABASE_URL يُحدَّد من سطر الأوامر قبل التشغيل.
// Usage: DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/<batch>.ts
// =============================================================
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { stockOf, customerDebtMinor, supplierDueMinor } from '@/lib/bakery/core'

/* ---------- سجل المسارات: كل المعالجات الحقيقية ---------- */
import { GET as apiStatus } from '@/app/api/status/route'
import { GET as authMe } from '@/app/api/auth/me/route'
import { POST as authLogin } from '@/app/api/auth/login/route'
import { POST as authLogout } from '@/app/api/auth/logout/route'
import { POST as setupPOST } from '@/app/api/setup/route'
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/settings/route'
import { GET as usersGET, POST as usersPOST } from '@/app/api/users/route'
import { PUT as usersIdPUT } from '@/app/api/users/[id]/route'
import { PUT as usersPasswordPUT } from '@/app/api/users/[id]/password/route'
import { PUT as usersPinPUT } from '@/app/api/users/[id]/pin/route'
import { GET as productsGET, POST as productsPOST } from '@/app/api/products/route'
import { GET as productsIdGET, PUT as productsIdPUT } from '@/app/api/products/[id]/route'
import { GET as categoriesGET, POST as categoriesPOST } from '@/app/api/categories/route'
import { PUT as categoriesIdPUT } from '@/app/api/categories/[id]/route'
import { GET as customersGET, POST as customersPOST } from '@/app/api/customers/route'
import { GET as customersIdGET, PUT as customersIdPUT } from '@/app/api/customers/[id]/route'
import { GET as customersStatementGET } from '@/app/api/customers/[id]/statement/route'
import { POST as customersPaymentsPOST } from '@/app/api/customers/[id]/payments/route'
import { POST as customersAdjustmentsPOST } from '@/app/api/customers/[id]/adjustments/route'
import { GET as suppliersGET, POST as suppliersPOST } from '@/app/api/suppliers/route'
import { GET as suppliersIdGET, PUT as suppliersIdPUT } from '@/app/api/suppliers/[id]/route'
import { GET as suppliersStatementGET } from '@/app/api/suppliers/[id]/statement/route'
import { POST as suppliersPaymentsPOST } from '@/app/api/suppliers/[id]/payments/route'
import { GET as purchasesGET, POST as purchasesPOST } from '@/app/api/purchases/route'
import { GET as purchasesIdGET } from '@/app/api/purchases/[id]/route'
import { POST as purchasesPaymentsPOST } from '@/app/api/purchases/[id]/payments/route'
import { POST as purchasesCancelPOST } from '@/app/api/purchases/[id]/cancel/route'
import { GET as salesGET, POST as salesPOST } from '@/app/api/sales/route'
import { GET as salesIdGET } from '@/app/api/sales/[id]/route'
import { POST as salesCancelPOST } from '@/app/api/sales/[id]/cancel/route'
import { GET as inventoryGET } from '@/app/api/inventory/route'
import { GET as inventoryLowGET } from '@/app/api/inventory/low/route'
import { GET as inventoryMovementsGET } from '@/app/api/inventory/movements/route'
import { POST as inventoryOpeningPOST } from '@/app/api/inventory/opening/route'
import { POST as inventoryAdjustPOST } from '@/app/api/inventory/adjust/route'
import { POST as inventoryWastePOST } from '@/app/api/inventory/waste/route'
import { GET as recipesGET, POST as recipesPOST } from '@/app/api/recipes/route'
import { GET as recipesIdGET, PUT as recipesIdPUT } from '@/app/api/recipes/[id]/route'
import { GET as productionGET, POST as productionPOST } from '@/app/api/production/route'
import { POST as productionCancelPOST } from '@/app/api/production/[id]/cancel/route'
import { GET as repsGET, POST as repsPOST } from '@/app/api/distribution/reps/route'
import { PUT as repsIdPUT } from '@/app/api/distribution/reps/[id]/route'
import { GET as routesGET, POST as routesPOST } from '@/app/api/distribution/routes/route'
import { PUT as routesIdPUT } from '@/app/api/distribution/routes/[id]/route'
import { GET as tripsGET, POST as tripsPOST } from '@/app/api/distribution/trips/route'
import { GET as tripsIdGET } from '@/app/api/distribution/trips/[id]/route'
import { POST as tripsLoadsPOST } from '@/app/api/distribution/trips/[id]/loads/route'
import { POST as tripsSalesPOST } from '@/app/api/distribution/trips/[id]/sales/route'
import { POST as tripsReturnsPOST } from '@/app/api/distribution/trips/[id]/returns/route'
import { POST as tripsSettlePOST } from '@/app/api/distribution/trips/[id]/settle/route'
import { GET as expensesGET, POST as expensesPOST } from '@/app/api/expenses/route'
import { GET as expCatsGET, POST as expCatsPOST } from '@/app/api/expenses/categories/route'
import { POST as expenseCancelPOST } from '@/app/api/expenses/[id]/cancel/route'
import { GET as shiftsGET } from '@/app/api/shifts/route'
import { POST as shiftsOpenPOST } from '@/app/api/shifts/open/route'
import { POST as shiftsClosePOST } from '@/app/api/shifts/close/route'
import { GET as shiftsCurrentGET } from '@/app/api/shifts/current/route'
import { GET as shiftsIdGET } from '@/app/api/shifts/[id]/route'
import { GET as auditGET } from '@/app/api/audit/route'
import { GET as backupExportGET } from '@/app/api/backup/export/route'
import { POST as backupPreviewPOST } from '@/app/api/backup/preview/route'
import { POST as backupRestorePOST } from '@/app/api/backup/restore/route'
import { POST as backupDemoPOST } from '@/app/api/backup/demo/route'
import { GET as exportEntityGET } from '@/app/api/export/[entity]/route'
import { GET as repDashboardGET } from '@/app/api/reports/dashboard/route'
import { GET as repSalesGET } from '@/app/api/reports/sales/route'
import { GET as repProfitGET } from '@/app/api/reports/profit/route'
import { GET as repCashGET } from '@/app/api/reports/cash/route'
import { GET as repDebtsGET } from '@/app/api/reports/debts/route'
import { GET as repCollectionsGET } from '@/app/api/reports/collections/route'
import { GET as repExpensesGET } from '@/app/api/reports/expenses/route'
import { GET as repPurchasesGET } from '@/app/api/reports/purchases/route'
import { GET as repSuppliersGET } from '@/app/api/reports/suppliers/route'
import { GET as repProductionGET } from '@/app/api/reports/production/route'
import { GET as repInvValGET } from '@/app/api/reports/inventory-valuation/route'
import { GET as repDistributionGET } from '@/app/api/reports/distribution/route'

type Handler = (req: NextRequest, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>

const R: Record<string, Handler> = {
  'GET /api/status': apiStatus,
  'GET /api/auth/me': authMe,
  'POST /api/auth/login': authLogin,
  'POST /api/auth/logout': authLogout,
  'POST /api/setup': setupPOST,
  'GET /api/settings': settingsGET,
  'PUT /api/settings': settingsPUT,
  'GET /api/users': usersGET,
  'POST /api/users': usersPOST,
  'PUT /api/users/[id]': usersIdPUT,
  'PUT /api/users/[id]/password': usersPasswordPUT,
  'PUT /api/users/[id]/pin': usersPinPUT,
  'GET /api/products': productsGET,
  'POST /api/products': productsPOST,
  'GET /api/products/[id]': productsIdGET,
  'PUT /api/products/[id]': productsIdPUT,
  'GET /api/categories': categoriesGET,
  'POST /api/categories': categoriesPOST,
  'PUT /api/categories/[id]': categoriesIdPUT,
  'GET /api/customers': customersGET,
  'POST /api/customers': customersPOST,
  'GET /api/customers/[id]': customersIdGET,
  'PUT /api/customers/[id]': customersIdPUT,
  'GET /api/customers/[id]/statement': customersStatementGET,
  'POST /api/customers/[id]/payments': customersPaymentsPOST,
  'POST /api/customers/[id]/adjustments': customersAdjustmentsPOST,
  'GET /api/suppliers': suppliersGET,
  'POST /api/suppliers': suppliersPOST,
  'GET /api/suppliers/[id]': suppliersIdGET,
  'PUT /api/suppliers/[id]': suppliersIdPUT,
  'GET /api/suppliers/[id]/statement': suppliersStatementGET,
  'POST /api/suppliers/[id]/payments': suppliersPaymentsPOST,
  'GET /api/purchases': purchasesGET,
  'POST /api/purchases': purchasesPOST,
  'GET /api/purchases/[id]': purchasesIdGET,
  'POST /api/purchases/[id]/payments': purchasesPaymentsPOST,
  'POST /api/purchases/[id]/cancel': purchasesCancelPOST,
  'GET /api/sales': salesGET,
  'POST /api/sales': salesPOST,
  'GET /api/sales/[id]': salesIdGET,
  'POST /api/sales/[id]/cancel': salesCancelPOST,
  'GET /api/inventory': inventoryGET,
  'GET /api/inventory/low': inventoryLowGET,
  'GET /api/inventory/movements': inventoryMovementsGET,
  'POST /api/inventory/opening': inventoryOpeningPOST,
  'POST /api/inventory/adjust': inventoryAdjustPOST,
  'POST /api/inventory/waste': inventoryWastePOST,
  'GET /api/recipes': recipesGET,
  'POST /api/recipes': recipesPOST,
  'GET /api/recipes/[id]': recipesIdGET,
  'PUT /api/recipes/[id]': recipesIdPUT,
  'GET /api/production': productionGET,
  'POST /api/production': productionPOST,
  'POST /api/production/[id]/cancel': productionCancelPOST,
  'GET /api/distribution/reps': repsGET,
  'POST /api/distribution/reps': repsPOST,
  'PUT /api/distribution/reps/[id]': repsIdPUT,
  'GET /api/distribution/routes': routesGET,
  'POST /api/distribution/routes': routesPOST,
  'PUT /api/distribution/routes/[id]': routesIdPUT,
  'GET /api/distribution/trips': tripsGET,
  'POST /api/distribution/trips': tripsPOST,
  'GET /api/distribution/trips/[id]': tripsIdGET,
  'POST /api/distribution/trips/[id]/loads': tripsLoadsPOST,
  'POST /api/distribution/trips/[id]/sales': tripsSalesPOST,
  'POST /api/distribution/trips/[id]/returns': tripsReturnsPOST,
  'POST /api/distribution/trips/[id]/settle': tripsSettlePOST,
  'GET /api/expenses': expensesGET,
  'POST /api/expenses': expensesPOST,
  'GET /api/expenses/categories': expCatsGET,
  'POST /api/expenses/categories': expCatsPOST,
  'POST /api/expenses/[id]/cancel': expenseCancelPOST,
  'GET /api/shifts': shiftsGET,
  'POST /api/shifts/open': shiftsOpenPOST,
  'POST /api/shifts/close': shiftsClosePOST,
  'GET /api/shifts/current': shiftsCurrentGET,
  'GET /api/shifts/[id]': shiftsIdGET,
  'GET /api/audit': auditGET,
  'GET /api/backup/export': backupExportGET,
  'POST /api/backup/preview': backupPreviewPOST,
  'POST /api/backup/restore': backupRestorePOST,
  'POST /api/backup/demo': backupDemoPOST,
  'GET /api/export/[entity]': exportEntityGET,
  'GET /api/reports/dashboard': repDashboardGET,
  'GET /api/reports/sales': repSalesGET,
  'GET /api/reports/profit': repProfitGET,
  'GET /api/reports/cash': repCashGET,
  'GET /api/reports/debts': repDebtsGET,
  'GET /api/reports/collections': repCollectionsGET,
  'GET /api/reports/expenses': repExpensesGET,
  'GET /api/reports/purchases': repPurchasesGET,
  'GET /api/reports/suppliers': repSuppliersGET,
  'GET /api/reports/production': repProductionGET,
  'GET /api/reports/inventory-valuation': repInvValGET,
  'GET /api/reports/distribution': repDistributionGET,
}

/* ---------- حالة الجلسة ---------- */
export const state = {
  token: '' as string,
  /** cookies لجلسة ثانية (اختبارات تعدد المستخدمين) */
  token2: '' as string,
}

export type CallOpts = {
  body?: unknown
  params?: Record<string, string>
  query?: Record<string, string>
  session?: 'main' | 'second' | 'none'
  rawBody?: string
}

export type CallResult = { status: number; json: any; text: string; setCookie: string | null }

/** استدعاء مسار حقيقي عبر المعالجات المصدَّرة — يقبل نمطًا /api/users/[id] مع params أو مسارًا محددًا يُحل تلقائيًا */
export async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, opts: CallOpts = {}): Promise<CallResult> {
  let key = `${method} ${path}`
  let params = opts.params ?? {}
  if (!R[key]) {
    // محاولة مطابقة مسار محدد بنمط مسجل: استبدال القطع بحقول [x]
    const segs = path.split('/').filter(Boolean)
    const candidates = Object.keys(R).filter(k => k.startsWith(`${method} `))
    let matched: { key: string; params: Record<string, string> } | null = null
    for (const k of candidates) {
      const psegs = k.slice(method.length + 1).split('/').filter(Boolean)
      if (psegs.length !== segs.length) continue
      const p: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < psegs.length; i++) {
        if (psegs[i].startsWith('[') && psegs[i].endsWith(']')) p[psegs[i].slice(1, -1)] = decodeURIComponent(segs[i])
        else if (psegs[i] !== segs[i]) { ok = false; break }
      }
      if (ok) { matched = { key: k, params: p }; break }
    }
    if (!matched) throw new Error(`Harness: مسار غير مسجل في السجل: ${key}`)
    key = matched.key
    params = matched.params
  }
  const handler = R[key]
  const url = new URL(`http://localhost${resolvePath(key.slice(method.length + 1), params)}`)
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const sess = opts.session ?? 'main'
  const token = sess === 'main' ? state.token : sess === 'second' ? state.token2 : ''
  if (token) headers.cookie = `bakery_session=${token}`
  const init: RequestInit = { method, headers }
  if (method === 'POST' || method === 'PUT') init.body = opts.rawBody ?? JSON.stringify(opts.body ?? {})
  const req = new NextRequest(url.toString(), init as never)
  const ctx = /\[\w+\]/.test(key.slice(method.length + 1)) ? { params: Promise.resolve(params) } : undefined
  const res = await handler(req, ctx)
  let json: any = null
  const text = await res.text()
  try { json = text ? JSON.parse(text) : null } catch { /* CSV أو غير JSON */ }
  const sc = res.headers.get('set-cookie')
  return { status: res.status, json, text, setCookie: sc }
}

function resolvePath(pattern: string, params: Record<string, string>): string {
  let p = pattern
  for (const [k, v] of Object.entries(params)) p = p.replace(`[${k}]`, encodeURIComponent(v))
  return p
}

/** استخراج توكن الجلسة من استجابة دخول/تهيئة */
export function captureSession(res: CallResult, which: 'main' | 'second' = 'main') {
  const sc = res.setCookie
  if (!sc) throw new Error('لا يوجد set-cookie في الاستجابة')
  const m = sc.match(/bakery_session=([^;]+)/)
  if (!m) throw new Error('كوكي الجلسة غير موجود')
  if (which === 'main') state.token = m[1]
  else state.token2 = m[1]
}

/* ---------- إطار الاختبارات ---------- */
export type TestOutcome = {
  id: string
  name: string
  screen: string
  uiPath: string
  expected: string
  actual: string
  pass: boolean
  severity?: string
  dbEffect?: string
  testRef: string
}

const outcomes: TestOutcome[] = []
let counter = 0

export async function t(
  name: string,
  meta: { screen: string; uiPath: string; expected: string; testRef: string },
  fn: () => Promise<string | void>
): Promise<boolean> {
  counter += 1
  const id = `T${String(counter).padStart(3, '0')}`
  try {
    const dbEffect = (await fn()) as string | void
    outcomes.push({ id, name, screen: meta.screen, uiPath: meta.uiPath, expected: meta.expected, actual: dbEffect || 'كما هو متوقع', pass: true, testRef: meta.testRef })
    console.log(`PASS ${id} ${meta.screen} — ${name}`)
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    outcomes.push({ id, name, screen: meta.screen, uiPath: meta.uiPath, expected: meta.expected, actual: msg, pass: false, testRef: meta.testRef })
    console.log(`FAIL ${id} ${meta.screen} — ${name}\n     ↳ ${msg}`)
    return false
  }
}

export function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}
export function eq(actual: unknown, expectedV: unknown, label: string) {
  expect(actual === expectedV, `${label}: المتوقع ${JSON.stringify(expectedV)} والفعلي ${JSON.stringify(actual)}`)
}

/** إنهاء الدفعة بطباعة الملخص وتحديد رمز الخروج */
export async function finish(batch: string) {
  const passed = outcomes.filter(o => o.pass).length
  const failed = outcomes.length - passed
  console.log(`\n===== ${batch}: ${passed}/${outcomes.length} PASS, ${failed} FAIL =====`)
  if (failed > 0) {
    console.log('الاختبارات الفاشلة: ' + outcomes.filter(o => !o.pass).map(o => o.id).join(', '))
  }
  // إخراج النتائج JSON للتقرير
  const outPath = process.env.QA_OUT ?? `/tmp/qa-bakery/${batch}.json`
  // @ts-ignore Bun
  await Bun.write(outPath, JSON.stringify(outcomes, null, 2))
  console.log(`النتائج: ${outPath}`)
}

export { db, stockOf, customerDebtMinor, supplierDueMinor }

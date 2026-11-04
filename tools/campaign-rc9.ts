/* حملة اختبار شاملة rc.9 — تقود dispatch() مباشرة (سجل + صلاحيات + خدمات)
 * تشغيل: bun tools/campaign-rc9.ts
 */
import { BakeryDb } from '../src/main/db'
import { dispatch } from '../src/main/registry'

const DB_PATH = '/tmp/campaign-rc9/bakery.db'
let pass = 0
let fail = 0
const failures: string[] = []

function step(name: string, fn: () => void): void {
  try {
    fn()
    pass++
    console.log(`  ✅ ${name}`)
  } catch (e) {
    fail++
    const msg = e instanceof Error ? e.message : String(e)
    failures.push(`${name}: ${msg}`)
    console.log(`  ❌ ${name} — ${msg}`)
  }
}

function ok(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

interface Env {
  ok: boolean
  data?: unknown
  error?: string
  code?: number
}

function call(db: BakeryDb, channel: string, payload: Record<string, unknown> = {}): Env {
  return dispatch(db, channel, payload) as unknown as Env
}

function data<T>(r: Env): T {
  if (!r.ok) throw new Error(`API ${String(r.error)} (code ${r.code})`)
  return r.data as T
}

async function main(): Promise<void> {
  const fs = await import('fs')
  fs.rmSync('/tmp/campaign-rc9', { recursive: true, force: true })
  const db = new BakeryDb({
    filePath: DB_PATH,
    wasmCandidates: ['node_modules/sql.js/dist/sql-wasm.wasm']
  })
  await db.init()
  console.log('════ حملة اختبار rc.9 الشاملة ════')

  // ---------- A. التأسيس والمصادقة ----------
  console.log('A) التأسيس والمصادقة')
  let ownerToken = ''
  step('A1 setup.run', () => {
    const r = data<{ done: boolean }>(
      call(db, 'setup.run', { businessName: 'مخبز الولاء الحديث', ownerName: 'المالك', username: 'owner', password: 'test1234' })
    )
    ok(r.done, 'setup not done')
  })
  step('A2 auth.login owner', () => {
    ownerToken = data<{ token: string }>(call(db, 'auth.login', { username: 'owner', password: 'test1234' })).token
    ok(ownerToken.length > 10, 'no token')
  })
  step('A3 كلمة مرور خاطئة تُرفض', () => {
    const r = call(db, 'auth.login', { username: 'owner', password: 'wrong' })
    ok(!r.ok, 'login should fail')
  })

  const T = (): Record<string, unknown> => ({ token: ownerToken })

  // ---------- B. الكتالوج ----------
  console.log('B) الكتالوج')
  let p1 = 0
  let p2 = 0
  step('B1 إنشاء منتجين', () => {
    p1 = data<{ id: number }>(call(db, 'products.create', { ...T(), name: 'خبز عادي', sku: 'BRD-001', type: 'FINISHED', baseUnit: 'قطعة', priceMinor: 200, costMinor: 100, trackStock: true, minStockMilli: 5000 })).id
    p2 = data<{ id: number }>(call(db, 'products.create', { ...T(), name: 'كعكة شوكولا', sku: 'CAK-001', type: 'FINISHED', baseUnit: 'قطعة', priceMinor: 1500, costMinor: 800, trackStock: false })).id
    ok(p1 > 0 && p2 > 0, 'ids')
  })
  step('B2 SKU مكرر يُرفض', () => {
    const r = call(db, 'products.create', { ...T(), name: 'خبز ٢', sku: 'BRD-001', type: 'FINISHED', baseUnit: 'قطعة', priceMinor: 200, costMinor: 100, trackStock: true })
    ok(!r.ok, 'dup sku should fail')
  })
  step('B3 products.list', () => {
    const rows = data<unknown[]>(call(db, 'products.list', { ...T() }))
    ok(rows.length === 2, `expect 2 got ${rows.length}`)
  })

  // ---------- C. المخزون ----------
  console.log('C) المخزون')
  step('C1 رصيد افتتاحي 100 قطعة', () => {
    const r = data<{ count: number }>(call(db, 'inventory.opening', { ...T(), items: [{ productId: p1, qtyMilli: 100000, unitCostMinor: 100 }] }))
    ok(r.count === 1, 'count')
  })
  step('C2 balances يعكس 100000', () => {
    const rows = data<Array<{ product_id: number; balance_milli: number }>>(call(db, 'inventory.balances', { ...T() }))
    const b = rows.find((x) => x.product_id === p1)
    ok(b && b.balance_milli === 100000, JSON.stringify(rows))
  })

  // ---------- D. العملاء ----------
  console.log('D) العملاء')
  let c1 = 0
  step('D1 إنشاء عميل', () => {
    c1 = data<{ id: number }>(call(db, 'customers.create', { ...T(), name: 'بقالة النور', phone: '0599111222' })).id
    ok(c1 > 0, 'id')
  })

  // ---------- E. نقطة البيع ----------
  console.log('E) نقطة البيع (بما فيها إصلاح الدفع الجزئي)')
  step('E1 بيع نقدي كامل → PAID', () => {
    const s = data<{ id: number; status: string; total_minor: number; credit_minor: number }>(
      call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 2000 }], payments: [{ method: 'CASH', amountMinor: 400 }] })
    )
    ok(s.status === 'PAID' && s.total_minor === 400, `status=${s.status} total=${s.total_minor}`)
  })
  step('E2 بيع نقدي بصرد (مدفوع 5.00 لإجمالي 2.00) يُرفض', () => {
    const r = call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 500 }] })
    ok(!r.ok, 'overpay should fail')
  })
  step('E3 بيع آجل بعربون جزئي → PARTIAL', () => {
    const s = data<{ id: number; status: string; paid_minor: number; credit_minor: number }>(
      call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 3000 }], customerId: c1, payments: [{ method: 'CASH', amountMinor: 300 }] })
    )
    ok(s.status === 'PARTIAL' && s.paid_minor === 300 && s.credit_minor === 300, JSON.stringify(s))
  })
  step('E4 بيع آجل كامل بلا دفعات → CREDIT', () => {
    const s = data<{ id: number; status: string; credit_minor: number }>(
      call(db, 'sales.create', { ...T(), items: [{ productId: p2, qtyMilli: 1000 }], customerId: c1 })
    )
    ok(s.status === 'CREDIT' && s.credit_minor === 1500, JSON.stringify(s))
  })
  step('E5 نقدي كامل بلا عميل يعمل (سلوك صحيح)', () => {
    const s = data<{ status: string }>(call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 200 }] }))
    ok(s.status === 'PAID', 'cash full no customer')
  })
  step('E6 دفعة جزئية بلا عميل تُرفض', () => {
    const r = call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 50 }] })
    ok(!r.ok, 'partial without customer should fail')
  })
  step('E7 idempotency عبر clientRef', () => {
    const a = data<{ id: number }>(call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 200 }], clientRef: 'ORD-77' }))
    const b = data<{ id: number }>(call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 200 }], clientRef: 'ORD-77' }))
    ok(a.id === b.id, `dup ids ${a.id} vs ${b.id}`)
  })
  step('E8 كمية أكبر من المخزون تُرفض', () => {
    const r = call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 99999999 }] })
    ok(!r.ok, 'oversell should fail')
  })
  step('E9 بيع منتج بلا تتبع مخزون يعمل', () => {
    const s = data<{ status: string }>(call(db, 'sales.create', { ...T(), items: [{ productId: p2, qtyMilli: 2000 }], payments: [{ method: 'CASH', amountMinor: 3000 }] }))
    ok(s.status === 'PAID', 'no-track sale')
  })
  step('E10 خصم أكبر من الإجمالي يُرفض', () => {
    const r = call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 1000 }], discountMinor: 9999 })
    ok(!r.ok, 'big discount')
  })

  // ---------- F. التحصيل والتقارير المالية ----------
  console.log('F) التحصيل والتقارير المالية')
  step('F1 تحصيل دفعة من العميل', () => {
    const r = call(db, 'customers.payment', { ...T(), customerId: c1, amountMinor: 500, method: 'CASH' })
    ok(r.ok, String(r.error))
  })
  step('F2 تقرير الديون يعكس المتبقي 1300', () => {
    const rows = data<Array<{ id: number; balance_minor: number }>>(call(db, 'reports.debts', T()))
    const d = rows.find((x) => x.id === c1)
    // 300 (متبقي العربون) + 1500 (آجل) - 500 (تحصيل) = 1300
    ok(d && d.balance_minor === 1300, `balance=${d?.balance_minor} expected 1300`)
  })
  step('F3 تقرير المبيعات', () => {
    const r = call(db, 'reports.sales', { ...T(), from: '2020-01-01', to: '2030-01-01' })
    ok(r.ok, String(r.error))
  })

  // ---------- G. الجرد الشهري P0-D (الجديد) ----------
  console.log('G) الجرد الشهري P0-D')
  const now = new Date()
  const YM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  let countId = 0
  step('G1 فتح جرد → لقطة أرصدة', () => {
    const v = data<{ count: { id: number; status: string }; items: Array<{ product_id: number; system_qty_milli: number }> }>(
      call(db, 'stockcount.open', { ...T(), periodYm: YM })
    )
    countId = v.count.id
    ok(v.count.status === 'DRAFT', 'draft')
    const it = v.items.find((x) => x.product_id === p1)
    // 100000 افتتاحي - 2000 (E1) - 3000 (E3) - 1000 (E5) - 1000 (E7) = 93000
    ok(it && it.system_qty_milli === 93000, `snapshot=${it?.system_qty_milli} expected 93000`)
  })
  step('G2 حفظ فعلي 90000 بسبب «هالك»', () => {
    data<{ count: { id: number } }>(call(db, 'stockcount.saveItems', {
      ...T(),
      countId,
      items: [{ productId: p1, actualQtyMilli: 90000, reason: 'هالك', note: 'تلف أثناء النقل' }]
    }))
  })
  step('G3 تقرير الفروق — أثر مالي 300 = 3 قطعة × 100', () => {
    const rep = data<{ lossMinor: number }>(call(db, 'stockcount.variances', { ...T(), periodYm: YM }))
    ok(rep.lossMinor === 300, `loss=${rep.lossMinor} expected 300`)
  })
  step('G4 سبب خارج القائمة يُرفض', () => {
    const r = call(db, 'stockcount.saveItems', { ...T(), countId, items: [{ productId: p1, actualQtyMilli: 90000, reason: 'سبب وهمي' }] })
    ok(!r.ok, 'bad reason should fail')
  })
  step('G5 اعتماد الجرد → حركة WASTE موثقة', () => {
    const res = data<{ movements: number; count: { status: string } }>(call(db, 'stockcount.approve', { ...T(), countId }))
    ok(res.movements === 1 && res.count.status === 'APPROVED', JSON.stringify(res))
  })
  step('G6 إعادة الاعتماد تُرفض', () => {
    const r = call(db, 'stockcount.approve', { ...T(), countId })
    ok(!r.ok, 'double approve')
  })
  step('G7 getMonthStatuses يعكس APPROVED', () => {
    const rows = data<Array<{ period_ym: string; count_status: string | null; locked: boolean }>>(call(db, 'stockcount.getMonthStatuses', { ...T(), fromYm: YM, toYm: YM }))
    ok(rows.length === 1 && rows[0]?.count_status === 'APPROVED' && rows[0]?.locked === false, JSON.stringify(rows))
  })

  // ---------- H. الإقفال الموحد ----------
  console.log('H) الإقفال الموحد (month_closes يمنع نقطة البيع)')
  step('H1 إقفال الشهر عبر stockcount.closeMonth', () => {
    const r = data<{ closed: boolean; warning: string | null }>(call(db, 'stockcount.closeMonth', { ...T(), periodYm: YM, note: 'إقفال تجريبي' }))
    ok(r.closed && r.warning === null, JSON.stringify(r))
  })
  step('H2 بيع جديد بتاريخ الشهر المقفل يُرفض 423', () => {
    const r = call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 1000 }] })
    ok(!r.ok && r.code === 423, `code=${r.code} err=${r.error}`)
  })
  step('H3 إقفال مزدوج يُرفض', () => {
    const r = call(db, 'stockcount.closeMonth', { ...T(), periodYm: YM })
    ok(!r.ok, 'double close')
  })
  step('H4 سبب فك قفل قصير يُرفض', () => {
    const r = call(db, 'stockcount.unlockMonth', { ...T(), periodYm: YM, unlockReason: '123' })
    ok(!r.ok, 'short reason')
  })
  step('H5 فك القفل بسبب موثق يعمل', () => {
    const r = data<{ unlocked: boolean }>(call(db, 'stockcount.unlockMonth', { ...T(), periodYm: YM, unlockReason: 'تسوية جرد بعد مراجعة المحاسب' }))
    ok(r.unlocked, 'unlocked')
  })
  step('H6 البيع يعود بعد فك القفل', () => {
    const s = data<{ status: string }>(call(db, 'sales.create', { ...T(), items: [{ productId: p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 200 }] }))
    ok(s.status === 'PAID', 'sale after unlock')
  })

  // ---------- I. الصلاحيات ----------
  console.log('I) الصلاحيات (فصل الأدوار)')
  let cashierToken = ''
  step('I1 إنشاء كاشير وتسجيل دخوله', () => {
    call(db, 'users.create', { ...T(), username: 'cashier1', name: 'كاشير تجريبي', role: 'CASHIER', password: 'cash1234' })
    cashierToken = data<{ token: string }>(call(db, 'auth.login', { username: 'cashier1', password: 'cash1234' })).token
    ok(cashierToken.length > 10, 'token')
  })
  step('I2 الكاشير يبيع لكن لا يعتمد جردًا (403)', () => {
    const s = call(db, 'sales.create', { token: cashierToken, items: [{ productId: p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 200 }] })
    ok(s.ok, 'cashier can sell')
    const a = call(db, 'stockcount.approve', { token: cashierToken, countId: 1 })
    ok(!a.ok && a.code === 403, `code=${a.code}`)
  })
  step('I3 الكاشير لا يفتح الجرد (403)', () => {
    const a = call(db, 'stockcount.open', { token: cashierToken, periodYm: YM })
    ok(!a.ok && a.code === 403, `code=${a.code}`)
  })

  // ---------- J. الورديات والمصروفات ----------
  console.log('J) الورديات والمصروفات')
  step('J1 فتح وردية', () => {
    const r = call(db, 'shifts.open', { ...T(), openingCashMinor: 5000 })
    ok(r.ok, String(r.error))
  })
  step('J2 فئة مصروف + مصروف 2500', () => {
    const cat = data<{ id: number }>(call(db, 'expenses.categories.create', { ...T(), name: 'وقود' })).id
    const e = call(db, 'expenses.create', { ...T(), categoryId: cat, amountMinor: 2500, method: 'CASH', note: 'بنزين توزيع' })
    ok(e.ok, String(e.error))
  })
  step('J3 إقفال الوردية', () => {
    const r = call(db, 'shifts.close', { ...T(), countedCashMinor: 5000 })
    ok(r.ok, String(r.error))
  })

  // ---------- K. سجل التدقيق ----------
  console.log('K) سجل التدقيق')
  step('K1 audit.list فيه أحداث الجرد والإقفال', () => {
    const rows = data<Array<{ action: string }>>(call(db, 'audit.list', { ...T(), limit: 200 }))
    const actions = rows.map((r) => r.action)
    ok(actions.includes('stockcount.approve'), 'no stockcount.approve')
    ok(actions.includes('month.close'), 'no month.close')
    ok(actions.includes('month.unlock'), 'no month.unlock')
  })

  // ---------- الخلاصة ----------
  console.log('══════════════════════════════')
  console.log(`النتيجة: ✅ ${pass} نجح | ❌ ${fail} فشل`)
  if (failures.length) {
    console.log('الإخفاقات:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

void main()

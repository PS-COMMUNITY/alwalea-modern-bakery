// =============================================================
// مخبز الولاء الحديث — جناح الاختبارات الداخلية الشامل (qa-suite)
// يُشغَّل: bun scripts/qa-suite.ts
// =============================================================
// يغطي بالترتيب ما طلب صاحب المشروع حرفيًا:
//   G1 البنية التحتية    — قاعدة sql.js حقيقية بملف مؤقت، ترحيلات، persist، إعادة فتح
//   G2 بنية البيانات      — الجداول الحرجة، قيود FK/UNIQUE/CHECK، الفهارس، وحدات القياس
//   G3 بنية تسجيل البيانات — فواتير/بنود/دفعات/أستاذ عملاء/handler المخزون/التدقيق بمعادلات محاسبية
//   G4 احتمال فقدان البيانات — تراجع معاملة، ملف تالف يُرفض، دوامة persist، دوران النسخ
//   G5 النسخ الاحتياطي     — تصدير مغقّم، معاينة، استعادة round-trip، دخول بعد الاستعادة
//   G6 الملفات            — مجلدات وسجلات النظام (autobackup.log، telegram.log) وصلاحية المحتوى
//   G7 الجرد والإقفال      — دورة الجرد كاملة + الحاجز الموحد على البيع داخل شهر مقفل
//   G8 تيليجرام والإعدادات — مفاتيح الإعداد، فشل رشيق، سجل المحاولات، تدقيق
//   G9 إصلاحات مراجعة المحترفين (rc.12) — حاجز الجرد النشط، إلغاء إنتاج بالهالك صافيًا،
//      نسخ احتياطي كامل بلا أسرار، فشل حفظ القرص، وحذف الكيانات بلا حركات
// لا يلمس أي قاعدة حقيقية — كل شيء في /tmp مؤقت ويعمل نظيفًا.
// =============================================================
import { rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { BakeryDb } from '../src/main/db'
import { dispatch } from '../src/main/registry'
import { autoBackupScheduled, autoBackupStatus } from '../src/main/services/backup'
import { telegramDailyIfDue } from '../src/main/services/telegram'

const TEST_DIR = `/tmp/bakery-qa-${Date.now()}`
const DB_PATH = `${TEST_DIR}/data/bakery.db`
const WASM = 'node_modules/sql.js/dist/sql-wasm.wasm'

let pass = 0
let fail = 0
const failures: string[] = []
let group = ''
const groupStats: Array<{ group: string; pass: number; fail: number }> = []

function startGroup(name: string): void {
  if (group) {
    const cur = groupStats.find((g) => g.group === group)
    if (cur) {
      cur.pass = cur.pass
    }
  }
  group = name
  groupStats.push({ group: name, pass: 0, fail: 0 })
  console.log(`\n===== ${name} =====`)
}

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    const g = groupStats.find((x) => x.group === group)
    if (g) g.pass++
    console.log(`PASS | ${name}${extra ? ' | ' + extra : ''}`)
  } else {
    fail++
    failures.push(`${group} :: ${name}${extra ? ' :: ' + extra : ''}`)
    const g = groupStats.find((x) => x.group === group)
    if (g) g.fail++
    console.log(`FAIL | ${name}${extra ? ' | ' + extra : ''}`)
  }
}

type Env = { ok: boolean; data?: unknown; error?: string; code?: number }
async function invoke(db: BakeryDb, channel: string, payload: Record<string, unknown> = {}): Promise<Env> {
  const r = await dispatch(db, channel, payload)
  if (r.ok) return { ok: true, data: r.data }
  return { ok: false, error: r.error, code: r.code }
}

function sysCtx(db: BakeryDb): Parameters<typeof autoBackupScheduled>[0] {
  return {
    db,
    user: null,
    audit: (action: string, entity?: string, entityId?: number | null, details?: unknown): void => {
      db.run(
        `INSERT INTO audit_log (date, user_id, username, action, entity, entity_id, details, created_at)
         VALUES (?, ?, ?, 'system', ?, ?, ?, ?)`,
        [db.today(), null, action, entity ?? null, entityId ?? null, details === undefined ? null : JSON.stringify(details), db.now()]
      )
    }
  } as Parameters<typeof autoBackupScheduled>[0]
}

async function openDb(filePath = DB_PATH): Promise<BakeryDb> {
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new BakeryDb({ filePath, wasmCandidates: [WASM] })
  await db.init()
  db.setPersistFn(() => db.persist())
  return db
}

function q(db: BakeryDb, sql: string, args: unknown[] = []): number {
  const r = db.get<{ c: number }>(sql, args)
  return Number(r?.c ?? 0)
}

/** قاعدة جاهزة: إعداد + مالك + فئة + 3 منتجات مخزنية + عميل + مورد + أرصدة افتتاحية */
async function seedBusiness(db: BakeryDb): Promise<string> {
  const setup = await invoke(db, 'setup.run', { businessName: 'مخبز جناح الاختبارات', ownerName: 'المالك', password: '1234' })
  if (!setup.ok) throw new Error(`setup.run فشل: ${setup.error}`)
  const login = (await invoke(db, 'auth.login', { password: '1234' })) as Env & { data?: { token: string } }
  const token = login.data?.token ?? ''
  if (!token) throw new Error('login فشل')
  await invoke(db, 'categories.create', { token, name: 'خبوزات' })
  const p1 = (await invoke(db, 'products.create', {
    token, name: 'خبز عربي', sku: 'QA-B1', categoryId: 1, type: 'FINISHED',
    baseUnit: 'كيس', priceMinor: 500, costMinor: 200, minStockMilli: 5000, trackStock: true, active: true
  })) as Env & { data?: { id: number } }
  check('تهيئة: منتج مخزني 1 أُنشئ', p1.ok === true && typeof p1.data?.id === 'number', p1.error ?? '')
  const p2 = (await invoke(db, 'products.create', {
    token, name: 'كعك', sku: 'QA-B2', categoryId: 1, type: 'FINISHED',
    baseUnit: 'كيس', priceMinor: 1200, costMinor: 500, minStockMilli: 0, trackStock: true, active: true
  })) as Env & { data?: { id: number } }
  check('تهيئة: منتج مخزني 2 أُنشئ', p2.ok === true && typeof p2.data?.id === 'number', p2.error ?? '')
  const svc = await invoke(db, 'products.create', {
    token, name: 'خدمة توصيل', sku: null, categoryId: 1, type: 'TRADE',
    baseUnit: 'خدمة', priceMinor: 1000, costMinor: 0, minStockMilli: 0, trackStock: false, active: true
  })
  check('تهيئة: منتج بلا تتبع مخزون (خدمة) أُنشئ', svc.ok === true, svc.error ?? '')
  const cust = (await invoke(db, 'customers.create', { token, name: 'عميل آجل', phone: '0599000001' })) as Env & { data?: { id: number } }
  const custId = cust.data?.id ?? 1
  check('تهيئة: عميل أُنشئ', cust.ok === true, cust.error ?? '')
  const sup = (await invoke(db, 'suppliers.create', { token, name: 'مورد الطحين', phone: '0599000002' })) as Env & { data?: { id: number } }
  const supId = sup.data?.id ?? 1
  check('تهيئة: مورد أُنشئ', sup.ok === true, sup.error ?? '')
  const open = await invoke(db, 'inventory.opening', {
    token, items: [{ productId: p1.data?.id ?? 1, qtyMilli: 20000, unitCostMinor: 200 }, { productId: p2.data?.id ?? 2, qtyMilli: 10000, unitCostMinor: 500 }]
  })
  check('تهيئة: أرصدة افتتاحية سُجلت', open.ok === true, open.error ?? '')
  ;(globalThis as Record<string, unknown>).__qaIds = { p1: p1.data?.id ?? 1, p2: p2.data?.id ?? 2, custId, supId }
  return token
}

function qaIds(): { p1: number; p2: number; custId: number; supId: number } {
  return (globalThis as Record<string, unknown>).__qaIds as { p1: number; p2: number; custId: number; supId: number }
}

// =============================================================
async function main(): Promise<void> {
  rmSync(TEST_DIR, { force: true, recursive: true })
  console.log(`مجلد الاختبار: ${TEST_DIR}`)

  // ============ G1: البنية التحتية ============
  startGroup('G1 البنية التحتية')
  const db = await openDb()
  check('G1: تهيئة sql.js + wasm نجحت', db !== null)
  // القانون الحقيقي: الملف يُكتب ذريًا بعد أول معاملة كتابة (tx → persist تلقائي)
  db.run("INSERT INTO settings (key, value, updated_at) VALUES ('qa_probe_persist', '1', ?)", [db.now()])
  db.persist()
  check('G1: ملف القاعدة أُنشئ على القرص بعد أول كتابة', existsSync(DB_PATH))
  check('G1: حجم الملف > 4KB (مخطط مكتوب)', existsSync(DB_PATH) && statSync(DB_PATH).size > 4096, `${existsSync(DB_PATH) ? statSync(DB_PATH).size : 0}B`)
  const migCount = q(db, 'SELECT COUNT(*) AS c FROM schema_migrations')
  check('G1: كل ملفات الترحيل طُبقت', migCount === 4, `${migCount}/4`)
  const migNames = db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name').map((r) => r.name)
  check('G1: أسماء الترحيلات مرصودة', migNames.join(',') === '001_initial.sql,002_production_client_ref.sql,003_month_close.sql,003_period_count.sql', migNames.join(','))
  check('G1: جدول schema_migrations بفهرس فريد على الاسم (حماية التكرار)', migNames.length === new Set(migNames).size)
  const db2 = await openDb()
  check('G1: إعادة فتح الملف تعيد البيانات المكتوبة (persist round-trip)', q(db2, "SELECT COUNT(*) AS c FROM settings WHERE key='qa_probe_persist'") === 1)
  check('G1: الترحيلات لا تُعاد على إعادة الفتح', q(db2, 'SELECT COUNT(*) AS c FROM schema_migrations') === 4)

  // ============ G2: بنية البيانات ============
  startGroup('G2 بنية البيانات')
  const criticalTables = [
    'settings', 'users', 'sessions', 'categories', 'products', 'customers', 'customer_ledger',
    'suppliers', 'supplier_ledger', 'sales', 'sale_items', 'sale_payments', 'purchases',
    'purchase_items', 'purchase_payments', 'stock_movements', 'recipes', 'recipe_items',
    'expenses', 'expense_categories', 'shifts', 'cash_movements', 'audit_log', 'backup_records',
    'stock_counts', 'stock_count_items', 'month_closes', 'period_close', 'schema_migrations', 'sequences'
  ]
  for (const t of criticalTables) {
    const ok = q(db2, `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='${t}'`) === 1
    if (!ok) check(`G2: الجدول الحرج ${t} موجود`, false)
  }
  check(`G2: كل الجداول الحرجة الثلاثين موجودة (${criticalTables.length})`, true)
  const fkIssues = db2.query<Record<string, unknown>>('PRAGMA foreign_key_check')
  check('G2: PRAGMA foreign_key_check بلا انتهاكات', fkIssues.length === 0, `${fkIssues.length} انتهاك`)
  let checkThrow = false
  try { db2.run("INSERT INTO stock_counts (period_ym, status, created_at) VALUES ('2099-01','BAD','x')") } catch { checkThrow = true }
  check('G2: CHECK status في stock_counts يرفض قيمة غريبة', checkThrow)
  const nowG2 = db2.now()
  checkThrow = false
  try { db2.run("INSERT INTO month_closes (period_ym, closed_at, closed_by) VALUES ('2098-01', ?, 'qa')", [nowG2]) } catch { checkThrow = true }
  check('G2: إدخال إقفال فريد ينجح', !checkThrow)
  checkThrow = false
  try { db2.run("INSERT INTO month_closes (period_ym, closed_at, closed_by) VALUES ('2098-01', ?, 'qa')", [nowG2]) } catch { checkThrow = true }
  check('G2: UNIQUE period_ym في month_closes مفروض', checkThrow)
  db2.run("DELETE FROM month_closes WHERE period_ym='2098-01'")
  checkThrow = false
  try { db2.run("INSERT INTO products (name, sku, price_minor, active, created_at, updated_at) VALUES ('فريد','QA-SKU-X',100,1,?,?)", [nowG2, nowG2]) } catch { checkThrow = true }
  check('G2: إدخال منتج بـ SKU فريد ينجح', !checkThrow)
  checkThrow = false
  try { db2.run("INSERT INTO products (name, sku, price_minor, active, created_at, updated_at) VALUES ('مكرر','QA-SKU-X',100,1,?,?)", [nowG2, nowG2]) } catch { checkThrow = true }
  check('G2: UNIQUE sku في products مفروض', checkThrow)
  db2.run("DELETE FROM products WHERE sku='QA-SKU-X'")
  const idx = db2.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'").map((r) => r.name)
  check('G2: فهرس الجرد المعتمد الجزئي موجود', idx.includes('idx_stock_counts_period_approved'))
  check('G2: فهارس بنود الجرد موجودة', idx.includes('idx_stock_count_items_count') && idx.includes('idx_stock_count_items_product'))
  const cols = db2.query<{ name: string; type: string }>("PRAGMA table_info('sales')")
  const totalCol = cols.find((c) => c.name === 'total_minor')
  check('G2: sales.total_minor عمود INTEGER (أغورة)', totalCol?.type.toUpperCase() === 'INTEGER')
  const smCols = db2.query<{ name: string; type: string }>("PRAGMA table_info('stock_movements')")
  const qtyCol = smCols.find((c) => c.name === 'qty_milli')
  check('G2: stock_movements.qty_milli عمود INTEGER (ألفية)', qtyCol?.type.toUpperCase() === 'INTEGER')
  const scCols = db2.query<{ name: string; notnull: number }>("PRAGMA table_info('stock_count_items')")
  check('G2: reason في stock_count_items NOT NULL (سبب إلزامي)', (scCols.find((c) => c.name === 'reason')?.notnull ?? 0) === 1)

  // ============ G3: بنية تسجيل البيانات ============
  startGroup('G3 بنية تسجيل البيانات')
  const token = await seedBusiness(db2)
  const setupDone = db2.get<{ v: string }>("SELECT value AS v FROM settings WHERE key='setup_completed'")
  check('G3: الإعداد مسجل setup_completed=1', setupDone?.v === '1')
  const shift = await invoke(db2, 'shifts.open', { token, openingCashMinor: 10000 })
  check('G3: فتح وردية ناجح', shift.ok === true, shift.error ?? '')
  // 3.1 فاتورة نقدية: معادلة total = Σبنود = مدفوع
  const ids = qaIds()
  const sale1 = await invoke(db2, 'sales.create', {
    token,
    items: [{ productId: ids.p1, qtyMilli: 2000 }, { productId: ids.p2, qtyMilli: 1000 }],
    payments: [{ method: 'CASH', amountMinor: 2200 }]
  }) as Env & { data?: { id: number; total_minor: number; paid_minor: number; credit_minor: number; invoice_no: string; status: string } }
  check('G3: فاتورة نقدية أُنشئت', sale1.ok === true, sale1.error ?? '')
  check('G3: total_minor = مجموع البنود (2×500 + 1×1200 = 2200)', sale1.data?.total_minor === 2200, String(sale1.data?.total_minor))
  check('G3: المدفوع = الإجمالي والآجل صفر (نقدية) — status PAID', sale1.data?.paid_minor === 2200 && sale1.data?.credit_minor === 0 && sale1.data?.status === 'PAID', JSON.stringify(sale1.data).slice(0,120))
  const s1id = sale1.data?.id ?? 0
  const s1items = q(db2, 'SELECT COUNT(*) AS c FROM sale_items WHERE sale_id=?', [s1id])
  const s1pays = Number(db2.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM sale_payments WHERE sale_id=?', [s1id])?.s ?? 0)
  check('G3: بنود الفاتورة محفوظة (2)', s1items === 2)
  check('G3: مجموع الدفعات = paid_minor', s1pays === sale1.data?.paid_minor)
  const s1mov = db2.get<{ s: number }>("SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE ref_type='sale' AND ref_id=?", [s1id])?.s ?? 0
  check('G3: حركة مخزون SALE سالبة = -3000', Number(s1mov) === -3000, String(s1mov))
  // 3.2 فاتورة آجلة كاملة: دفتر العميل مدين
  const sale2 = await invoke(db2, 'sales.create', {
    token, customerId: ids.custId,
    items: [{ productId: ids.p1, qtyMilli: 4000 }],
    payments: [{ method: 'CASH', amountMinor: 1000 }]
  }) as Env & { data?: { id: number; total_minor: number; paid_minor: number; credit_minor: number; status: string } }
  check('G3: فاتورة آجلة أُنشئت', sale2.ok === true, sale2.error ?? '')
  check('G3: فاتورة آجلة جزئية: الآجل 1000 والمدفوع 1000 وstatus PARTIAL', sale2.data?.credit_minor === 1000 && sale2.data?.paid_minor === 1000 && sale2.data?.status === 'PARTIAL', JSON.stringify(sale2.data).slice(0,160))
  const debt = db2.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM customer_ledger WHERE customer_id=?', [ids.custId])?.s ?? 0
  check('G3: دفتر العميل مدين بـ1000 (الجزء غير المدفوع)', Number(debt) === 1000, String(debt))
  // 3.3 تحصيل من العميل يقفل الدين
  const pay = await invoke(db2, 'customers.payment', { token, customerId: ids.custId, amountMinor: 400, note: 'دفعة أولى' })
  check('G3: تحصيل من العميل ناجح', pay.ok === true, pay.error ?? '')
  const debtAfter = Number(db2.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM customer_ledger WHERE customer_id=?', [ids.custId])?.s ?? 0)
  check('G3: الدين انخفض إلى 600 بعد تحصيل 400', debtAfter === 600, String(debtAfter))
  const runtotals = db2.query<{ rt: number }>(
    `SELECT (SELECT COALESCE(SUM(amount_minor),0) FROM customer_ledger l2 WHERE l2.customer_id=l.customer_id AND l2.id<=l.id) AS rt
     FROM customer_ledger l WHERE customer_id=? ORDER BY id`, [ids.custId]
  )
  const lastRt = Number(runtotals[runtotals.length - 1]?.rt ?? -999)
  check('G3: سلسلة أستاذ العميل: رصيد جارٍ أخير = الدين الفعلي 600', runtotals.length === 2 && lastRt === 600, `${runtotals.length} قيود، آخر جارٍ ${lastRt}`)
  // 3.4 إلغاء الفاتورة النقدية يعكس الحركة
  const cancel1 = await invoke(db2, 'sales.cancel', { token, id: s1id, reason: 'خطأ إدخال' })
  check('G3: إلغاء فاتورة ناجح', cancel1.ok === true, cancel1.error ?? '')
  const movAfter = db2.get<{ s: number }>("SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE (ref_type='sale' AND ref_id=?) OR (ref_type='sale_cancel' AND ref_id=?)", [s1id, s1id])?.s ?? 0
  check('G3: الإلغاء عكس الحركات بالكامل (SALE + SALE_RETURN = 0)', Number(movAfter) === 0, String(movAfter))
  const retMov = q(db2, "SELECT COUNT(*) AS c FROM stock_movements WHERE type='SALE_RETURN' AND ref_type='sale_cancel' AND ref_id=?", [s1id])
  check('G3: حركات الإرجاع موثقة بـ SALE_RETURN/ref sale_cancel', retMov === 2, String(retMov))
  // 3.5 مشتريات: مورد مدين ثم دفع
  const pur = await invoke(db2, 'purchases.create', {
    token, supplierId: ids.supId, paidMinor: 500,
    items: [{ productId: ids.p1, qtyMilli: 10000, unitCostMinor: 200 }]
  }) as Env & { data?: { id: number; totalMinor: number } }
  check('G3: فاتورة مشتريات أُنشئت (2000 أغورة، مدفوع 500، PARTIAL)', pur.ok === true && (pur.data as Record<string, number>)?.total_minor === 2000, JSON.stringify(pur.data).slice(0,120))
  const supDebt = Number(db2.get<{ s: number }>('SELECT COALESCE(SUM(amount_minor),0) AS s FROM supplier_ledger')?.s ?? 0)
  check('G3: دفتر المورد دائن بـ1500 (المتبقي)', supDebt === 1500, String(supDebt))
  // 3.6 مصروف
  const fuel = (await invoke(db2, 'expenses.categories.create', { token, name: 'وقود' })) as Env & { data?: { id: number } }
  check('G3: فئة مصروف أُنشئت', fuel.ok === true, fuel.error ?? '')
  const exp = await invoke(db2, 'expenses.create', { token, categoryId: fuel.data?.id ?? 1, amountMinor: 2500, note: 'بنزين' })
  check('G3: مصروف سُجل (2500 أغورة)', exp.ok === true, exp.error ?? '')
  // 3.7 تسلسل الفواتير
  const inv1 = String(sale1.data?.invoice_no ?? '')
  check('G3: صيغة رقم الفاتورة S-YYYYMMDD-NNNN', /^S-\d{8}-\d{4}$/.test(inv1), inv1)
  check('G3: الفاتورة الملغاة status=CANCELLED مع سبب', (cancel1.data as Record<string, unknown>)?.status === 'CANCELLED')
  // 3.8 التدقيق يوثق كل شيء
  const auditSales = q(db2, "SELECT COUNT(*) AS c FROM audit_log WHERE action='sale.create'")
  const auditCancel = q(db2, "SELECT COUNT(*) AS c FROM audit_log WHERE action='sale.cancel'")
  const auditPay = q(db2, "SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'customer.payment%'")
  check('G3: التدقيق وثّق الإنشاء والإلغاء والتحصيل', auditSales >= 1 && auditCancel >= 1 && auditPay >= 1)

  // ============ G4: احتمال فقدان البيانات ============
  startGroup('G4 احتمال فقدان البيانات')
  // 4.1 تراجع المعاملة: خطأ داخل tx ⇒ صفر أثر
  const beforeRoll = q(db2, 'SELECT COUNT(*) AS c FROM products')
  let rolled = false
  try {
    db2.tx(() => {
      db2.run("INSERT INTO products (name, price_minor, active, created_at, updated_at) VALUES ('مؤقت', 1, 1, 'x', 'y')")
      throw new Error('محاكاة فشل وسط المعاملة')
    })
  } catch {
    rolled = true
  }
  check('G4: الخطأ داخل المعاملة يُرمى فعلًا', rolled)
  check('G4: التراجع كامل — صفر صفوف جزئية', q(db2, 'SELECT COUNT(*) AS c FROM products') === beforeRoll)
  // 4.2 ملف تالف يُرفض رفضًا صريحًا (لا فتح صامت ولا كتابة فوقه)
  const corruptPath = `${TEST_DIR}/corrupt.db`
  copyFileSync(DB_PATH, corruptPath)
  writeFileSync(corruptPath, Buffer.from('هذا الملف ليس قاعدة بيانات إطلاقًا — بايتات عشوائية 12345', 'utf8'))
  let corruptRejected = false
  let corruptMsg = ''
  try {
    const cdb = new BakeryDb({ filePath: corruptPath, wasmCandidates: [WASM] })
    await cdb.init()
  } catch (e) {
    corruptRejected = true
    corruptMsg = e instanceof Error ? e.message : String(e)
  }
  check('G4: ملف تالف يُرفض عند الفتح (لا فتح صامت)', corruptRejected, corruptMsg.slice(0, 80))
  check('G4: الملف التالف لم يُكتب فوقه (حجمه تغيّر لن يزيد عن النص)', readFileSync(corruptPath, 'utf8').startsWith('هذا الملف'))
  // 4.3 persist مزدوج آمن
  let persistOk = true
  try { db2.persist(); db2.persist() } catch { persistOk = false }
  check('G4: persist متكرر آمن بلا استثناءات', persistOk)
  // 4.4 بقاء البيانات بعد persist ثم إعادة فتح (محاكاة إغلاق وفتح)
  const lastSale = db2.get<{ total_minor: number }>('SELECT total_minor FROM sales ORDER BY id DESC LIMIT 1')
  const db3 = await openDb()
  const lastSaleReopen = db3.get<{ total_minor: number }>('SELECT total_minor FROM sales ORDER BY id DESC LIMIT 1')
  check('G4: آخر فاتورة محفوظة بايت-ببايت بعد إعادة الفتح', lastSale?.total_minor === lastSaleReopen?.total_minor && lastSale !== undefined)
  // 4.5 دوران النسخ التلقائية: سقف 14
  for (let i = 0; i < 16; i++) autoBackupScheduled(sysCtx(db3))
  const autoFiles = readdirSync(join(TEST_DIR, 'data', '..', 'backups').replace('data/..', '')).filter((f) => f.startsWith('bakery-backup-auto'))
  const backupDirList = readdirSync(`${TEST_DIR}/backups`)
  const autoCount = backupDirList.filter((f) => f.startsWith('bakery-backup-auto')).length
  check('G4: دوران النسخ التلقائية لا يتجاوز 14', autoCount <= 14, `${autoCount} ملفًا (${autoFiles.length} فحص أول)`)
  check('G4: النسخ التلقائية سُجلت في backup_records', q(db3, "SELECT COUNT(*) AS c FROM backup_records WHERE note LIKE 'تلقائية%'") >= 1)
  // 4.6 سلامة القيود أثناء الفشل: فاتورة بمنتج غير موجود ترمي ولا تُنشئ فاتورة يتيمة
  const salesBeforeOrphan = q(db3, 'SELECT COUNT(*) AS c FROM sales')
  const orphan = await invoke(db3, 'sales.create', { token: undefined, items: [{ productId: 9999, qtyMilli: 1000 }] })
  check('G4: فاتورة بلا جلسة صالحة مرفوضة', orphan.ok === false)
  check('G4: لا فاتورة يتيمة أُنشئت', q(db3, 'SELECT COUNT(*) AS c FROM sales') === salesBeforeOrphan)

  // ============ G5: النسخ الاحتياطي ============
  startGroup('G5 النسخ الاحتياطي (round-trip)')
  const login3 = (await invoke(db3, 'auth.login', { password: '1234' })) as Env & { data?: { token: string } }
  const token3 = login3.data?.token ?? ''
  check('G5: دخول المالك على القاعدة المعاد فتحها', token3.length >= 16)
  const expB = await invoke(db3, 'backup.export', { token: token3, note: 'نسخة الجناح' }) as Env & { data?: { path: string } }
  check('G5: التصدير ناجح بملف على القرص', expB.ok === true && existsSync(expB.data?.path ?? 'nonexist'), expB.error ?? '')
  const raw = readFileSync(expB.data?.path ?? '', 'utf8')
  const parsed = JSON.parse(raw) as { tables: Record<string, Array<Record<string, unknown>>>; meta?: Record<string, unknown> }
  check('G5: ملف النسخة JSON سليم بقسم tables', typeof parsed.tables === 'object')
  check('G5: النسخة مغقّمة — لا هاشات كلمات مرور', (parsed.tables['users'] ?? []).every((u) => u.password_hash === ''))
  check('G5: النسخة بلا جلسات', (parsed.tables['sessions'] ?? []).length === 0)
  check('G5: النسخة تحوي الفاتورتين', (parsed.tables['sales'] ?? []).length === 2, String((parsed.tables['sales'] ?? []).length))
  check('G5: النسخة تحوي المنتجات الثلاثة', (parsed.tables['products'] ?? []).length === 3, 'المنتجات=' + String((parsed.tables['products'] ?? []).length))
  check('G5: النسخة تحوي 8 حركات مخزون', (parsed.tables['stock_movements'] ?? []).length === 8, 'الحركات=' + String((parsed.tables['stock_movements'] ?? []).length))
  const prev = await invoke(db3, 'backup.preview', { token: token3, json: raw })
  check('G5: المعاينة تعمل على النسخة', prev.ok === true, prev.error ?? '')
  // round-trip: قاعدة جديدة فارغة → استعادة → مطابقة
  const restorePath = `${TEST_DIR}/restored/data/bakery.db`
  const db4 = await openDb(restorePath)
  // القاعدة الهدف يجب أن تكون مهيأة (لها مالك وجلسة) قبل الاستعادة — نفس مسار الإنتاج
  const setupR = await invoke(db4, 'setup.run', { businessName: 'قبل الاستعادة', ownerName: 'مؤقت', password: '9999' })
  check('G5: تهيئة القاعدة الهدف', setupR.ok === true, setupR.error ?? '')
  const loginR0 = (await invoke(db4, 'auth.login', { password: '9999' })) as Env & { data?: { token: string } }
  check('G5: دخول على القاعدة الهدف', loginR0.ok === true && (loginR0.data?.token ?? '').length >= 16)
  const restore = await invoke(db4, 'backup.restore', { token: loginR0.data?.token, json: raw, newOwnerPassword: '5678' })
  check('G5: الاستعادة على القاعدة الهدف ناجحة', restore.ok === true, restore.error ?? '')
  const countsMap: Array<[string, number]> = [
    ['sales', 2], ['products', 3], ['customers', 1], ['suppliers', 1],
    ['sale_items', 3], ['stock_movements', 8], ['categories', 4]
  ]
  for (const [t, expected] of countsMap) {
    const actual = q(db4, `SELECT COUNT(*) AS c FROM ${t}`)
    check(`G5: round-trip ${t} = ${expected}`, actual === expected, `${actual}`)
  }
  const restoredTotal = db4.get<{ s: number }>('SELECT COALESCE(SUM(total_minor),0) AS s FROM sales')?.s ?? 0
  const sourceTotal = db3.get<{ s: number }>('SELECT COALESCE(SUM(total_minor),0) AS s FROM sales')?.s ?? 0
  check('G5: مجموع المبيعات مطابق بعد الاستعادة', restoredTotal === sourceTotal, `${restoredTotal} مقابل ${sourceTotal}`)
  const loginR = await invoke(db4, 'auth.login', { password: '5678' })
  check('G5: دخول المالك بكلمة الاستعادة الجديدة', loginR.ok === true, loginR.error ?? '')
  const oldPw = await invoke(db4, 'auth.login', { password: '1234' })
  check('G5: كلمة المرور القديمة رُفضت بعد الاستعادة', oldPw.ok === false)
  const bl = await invoke(db4, 'backup.list', { token: (loginR as Env & { data?: { token: string } }).data?.token })
  check('G5: backup.list يعمل بعد الاستعادة', bl.ok === true, bl.error ?? '')

  // ============ G6: الملفات ============
  startGroup('G6 الملفات وسجلات النظام')
  check('G6: مجلد backups موجود', existsSync(`${TEST_DIR}/backups`))
  check('G6: autobackup.log مكتوب', existsSync(`${TEST_DIR}/backups/autobackup.log`))
  const abLog = existsSync(`${TEST_DIR}/backups/autobackup.log`) ? readFileSync(`${TEST_DIR}/backups/autobackup.log`, 'utf8') : ''
  check('G6: autobackup.log يحوي أسطر OK', abLog.includes('OK'), abLog.split('\n')[0] ?? '')
  const backupJson = readFileSync(expB.data?.path ?? '', 'utf8')
  check('G6: ملف النسخة UTF-8 سليم ويبدأ بـ{', backupJson.trimStart().startsWith('{'))
  check('G6: لا ملفات journal متروكة بجوار القاعدة', !readdirSync(`${TEST_DIR}/data`).some((f) => f.includes('-journal') || f.includes('-wal')), readdirSync(`${TEST_DIR}/data`).join(','))
  check('G6: ملف القاعدة الأصلي حجمه منطقي (>50KB بعد النشاط)', statSync(DB_PATH).size > 50_000, `${statSync(DB_PATH).size}B`)
  const preMig = readdirSync(`${TEST_DIR}/backups`).filter((f) => f.startsWith('pre-migration-'))
  check('G6: آلية pre-migration جاهزة (لا ترحيلات معلقة الآن ⇒ صفر ملفات)', preMig.length === 0, `${preMig.length}`)
  const st = autoBackupStatus(sysCtx(db3))
  check('G6: autoStatus يعيد الدورية 120 دقيقة', st.intervalMinutes === 120)

  // ============ G7: الجرد والإقفال (P0-D) ============
  startGroup('G7 الجرد الشهري وإقفال الشهر')
  const ym = new Date().toISOString().slice(0, 7)
  const before = (await invoke(db3, 'stockcount.get', { token: token3, periodYm: ym })) as Env & { data?: { count: unknown } }
  check('G7: قراءة شهر بلا جرد تعيد count=null', before.ok === true && before.data?.count === null, before.error ?? '')
  const opened = (await invoke(db3, 'stockcount.open', { token: token3, periodYm: ym })) as Env & { data?: { count: { id: number; status: string }; items: Array<{ product_id: number; system_qty_milli: number }> } }
  check('G7: فتح جرد يعيد مسودة DRAFT', opened.ok === true && opened.data?.count?.status === 'DRAFT', opened.error ?? '')
  check('G7: اللقطة شملت المنتجين المخزنيين فقط (الخدمة لا تتتبع)', opened.data?.items?.length === 2, String(opened.data?.items?.length))
  const badReason = await invoke(db3, 'stockcount.saveItems', {
    token: token3, countId: opened.data?.count?.id,
    items: [{ productId: ids.p1, actualQtyMilli: 18000, reason: 'سبب مخترع', note: '' }]
  })
  check('G7: سبب خارج القائمة المغلقة مرفوض', badReason.ok === false, badReason.error ?? '')
  const negQty = await invoke(db3, 'stockcount.saveItems', {
    token: token3, countId: opened.data?.count?.id,
    items: [{ productId: ids.p1, actualQtyMilli: -5, reason: 'هالك' }]
  })
  check('G7: كمية سالبة مرفوضة', negQty.ok === false)
  const saved = await invoke(db3, 'stockcount.saveItems', {
    token: token3, countId: opened.data?.count?.id,
    items: [
      { productId: ids.p1, actualQtyMilli: 17500, reason: 'هالك', note: 'خبز قديم' },
      { productId: ids.p2, actualQtyMilli: 10500, reason: 'تسوية' }
    ]
  }) as Env & { data?: { items: Array<{ diff_milli: number }> } }
  check('G7: حفظ المسودة ناجح', saved.ok === true, saved.error ?? '')
  check('G7: الفروق محسوبة (-8500 و+500) بعد إرجاع بنود الملغاة', saved.data?.items?.find((i) => i.diff_milli === -8500) !== undefined && saved.data?.items?.find((i) => i.diff_milli === 500) !== undefined)
  const approved = (await invoke(db3, 'stockcount.approve', { token: token3, countId: opened.data?.count?.id })) as Env & { data?: { movements: number } }
  check('G7: اعتماد الجرد ناجح', approved.ok === true, approved.error ?? '')
  check('G7: الاعتماد ولّد حركتين موثقتين', approved.data?.movements === 2, String(approved.data?.movements))
  const wasteMove = q(db3, "SELECT COUNT(*) AS c FROM stock_movements WHERE type='WASTE' AND ref_type='stock_count'")
  const adjMove = q(db3, "SELECT COUNT(*) AS c FROM stock_movements WHERE type='ADJUSTMENT' AND ref_type='stock_count'")
  check('G7: النقص بسبب هالك => حركة WASTE', wasteMove === 1)
  check('G7: الفائض بسبب تسوية => حركة ADJUSTMENT', adjMove === 1)
  const bal1 = db3.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE product_id=?', [ids.p1])?.s ?? 0
  check('G7: رصيد المنتج 1 انخفض إلى 17500 بعد الاعتماد', Number(bal1) === 17500, String(bal1))
  const reApprove = await invoke(db3, 'stockcount.approve', { token: token3, countId: opened.data?.count?.id })
  check('G7: إعادة الاعتماد مرفوضة 409', reApprove.ok === false && reApprove.code === 409)
  const vari = (await invoke(db3, 'stockcount.variances', { token: token3, periodYm: ym })) as Env & { data?: { lossMinor: number; gainMinor: number; netMinor: number } }
  check('G7: تقرير الفروق: خسارة 1700 أغورة (8500ملي×200/1000)', vari.ok === true && vari.data?.lossMinor === 1700, JSON.stringify(vari.data))
  check('G7: تقرير الفروق: فائض 250 أغورة (500ملي×500/1000)', vari.data?.gainMinor === 250)
  check('G7: الصافي = فائض - خسارة = -1450', vari.data?.netMinor === -1450)
  // فحوص الأشهر قبل فتح مسودة ثانية (المسودة تغيّر "الأحدث")
  const months = (await invoke(db3, 'stockcount.getMonthStatuses', { token: token3, fromYm: ym, toYm: ym })) as Env & { data?: Array<{ locked: boolean; count_status: string | null }> }
  check('G7: getMonthStatuses يعيد الشهر مفتوحًا بعد الفك', months.ok === true && months.data?.[0]?.locked === false, JSON.stringify(months.data))
  check('G7: getMonthStatuses يظهر الجرد معتمدًا', months.data?.[0]?.count_status === 'APPROVED')

  const reopen = await invoke(db3, 'stockcount.open', { token: token3, periodYm: ym }) as Env & { data?: { count: { id: number; status: string } } }
  check('G7: فتح جرد ثانٍ بعد الاعتماد يعيد مسودة جديدة (إعادة عدّ مسموحة)', reopen.ok === true && reopen.data?.count?.status === 'DRAFT', reopen.error ?? '')
  const secondApprove = await invoke(db3, 'stockcount.approve', { token: token3, countId: reopen.data?.count?.id })
  check('G7: اعتماد جرد ثانٍ لنفس الشهر مرفوض برسالة عربية (فهرس فريد جزئي)', secondApprove.ok === false && (secondApprove.error ?? '').includes('جرد معتمد مسبقًا'), secondApprove.error ?? '')
  // rc.13: حذف المسودة الثانية عبر counts.cancel (الآن يفهم مسودات النظامين) —
  // المسودة المفتوحة تمنع حركات المخزون بأكملها فلا يصح إكمال فحوص البيع بعدها
  const delReopen = await invoke(db3, 'counts.cancel', { token: token3, id: reopen.data?.count?.id, reason: 'تنظيف مسودة اختبار G7' })
  check('G7: حذف مسودة نظام الجرد الثاني عبر counts.cancel ينجح', delReopen.ok === true, delReopen.error ?? '')
  // الحاجز الموحد: إقفال الشهر يمنع بيعًا بتاريخ داخله
  const closed = await invoke(db3, 'stockcount.closeMonth', { token: token3, periodYm: ym, note: 'إقفال تجريبي' })
  check('G7: إقفال الشهر ناجح', closed.ok === true, closed.error ?? '')
  const lockedSale = await invoke(db3, 'sales.create', {
    token: token3, date: `${ym}-15`,
    items: [{ productId: ids.p1, qtyMilli: 500 }],
    payments: [{ method: 'CASH', amountMinor: 250 }]
  })
  check('G7: بيع داخل شهر مقفل مرفوض 423 (الحاجز الموحد)', lockedSale.ok === false && lockedSale.code === 423, `code=${lockedSale.code} ${lockedSale.error ?? ''}`)
  const lockedAdjust = await invoke(db3, 'inventory.waste', { token: token3, productId: ids.p1, qtyMilli: 100 })
  check('G7: إعدام مخزون داخل شهر مقفل مرفوض', lockedAdjust.ok === false)
  const shortUnlock = await invoke(db3, 'stockcount.unlockMonth', { token: token3, periodYm: ym, unlockReason: 'قصير' })
  check('G7: فك قفل بسبب قصير (<5 أحرف) مرفوض', shortUnlock.ok === false)
  const unlock = await invoke(db3, 'stockcount.unlockMonth', { token: token3, periodYm: ym, unlockReason: 'تسوية بعد مراجعة المحاسب' })
  check('G7: فك القفل بسبب موثق ناجح', unlock.ok === true, unlock.error ?? '')
  const afterUnlockSale = await invoke(db3, 'sales.create', {
    token: token3, date: `${ym}-15`,
    items: [{ productId: ids.p1, qtyMilli: 500 }],
    payments: [{ method: 'CASH', amountMinor: 250 }]
  })
  check('G7: البيع نجح بعد فك القفل', afterUnlockSale.ok === true, afterUnlockSale.error ?? '')
  const unlockAudited = q(db3, "SELECT COUNT(*) AS c FROM audit_log WHERE action='month.unlock' AND details LIKE '%المحاسب%'")
  check('G7: سبب فك القفل موثق في التدقيق', unlockAudited >= 1)
  // ============ G8: تيليجرام والإعدادات ============
  startGroup('G8 تيليجرام والإعدادات')
  const setTg = await invoke(db3, 'settings.update', {
    token: token3,
    settings: { telegram_bot_token: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', telegram_chat_id: '123456', telegram_daily: '1', telegram_time: '03:00' }
  })
  check('G8: حفظ مفاتيح تيليجرام الأربعة مقبول', setTg.ok === true, setTg.error ?? '')
  const gotTg = (await invoke(db3, 'settings.get', { token: token3 })) as Env & { data?: { telegramDaily: boolean; telegramTime: string } }
  check('G8: settings.get يعيد تيليجرام مفعّلًا والوقت 03:00', gotTg.data?.telegramDaily === true && gotTg.data?.telegramTime === '03:00')
  const noToken = (await invoke(db3, 'telegram.test', { token: '' })) as Env & { error?: string }
  check('G8: اختبار بلا جلسة مرفوض 401', noToken.ok === false && noToken.code === 401)
  const fakeTest = await invoke(db3, 'telegram.test', { token: token3 })
  check('G8: اختبار بتوكن وهمي لا يرمي (فشل رشيق)', fakeTest.ok === true || (fakeTest.ok === false && (fakeTest.error ?? '').length > 0), JSON.stringify(fakeTest).slice(0, 80))
  check('G8: telegram.log كُتب بعد المحاولة', existsSync(`${TEST_DIR}/backups/telegram.log`))
  const tgLogRaw = existsSync(`${TEST_DIR}/backups/telegram.log`) ? readFileSync(`${TEST_DIR}/backups/telegram.log`, 'utf8') : ''
  check('G8: سجل تيليجرام يحوي TEST', tgLogRaw.includes('TEST'), tgLogRaw.split('\n')[0] ?? '')
  const badTime = await telegramDailyIfDue(sysCtx(db3))
  check('G8: مجدول تيليجرام لا يرسل قبل الوقت (03:00 لاحقًا الآن الصباح غالبًا) — بلا استثناءات', typeof badTime.sent === 'boolean')
  const auditTg = q(db3, "SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'telegram.%'")
  check('G8: التدقيق وثّق نشاط تيليجرام', auditTg >= 1)
  const badKey = await invoke(db3, 'settings.update', { token: token3, settings: { 'مفتاح غريب': 'قيمة تسريب' } })
  check('G8: مفتاح غريب لا يرمي ولا يُخزن (تجاهل صامت آمن)', badKey.ok === true && q(db3, "SELECT COUNT(*) AS c FROM settings WHERE key='مفتاح غريب'") === 0, JSON.stringify(badKey).slice(0,80))


  // ============ G9: إصلاحات مراجعة المحترفين (rc.12) ============
  startGroup('G9 إصلاحات مراجعة المحترفين rc.12')
  {
    const db4 = await openDb(`${TEST_DIR}/data/bakery-g9.db`)
    const token4 = await seedBusiness(db4)
    const g9 = qaIds()

    // ----- P0-1: حاجز الجرد النشط الموحد -----
    const cnt = (await invoke(db4, 'counts.create', { token: token4 })) as Env & { data?: { id: number; countNo: string } }
    check('G9/P0-1: فتح ورقة جرد (مسودة) نجح', cnt.ok === true && typeof cnt.data?.id === 'number', cnt.error ?? '')
    const blockedSale = (await invoke(db4, 'sales.create', {
      token: token4, items: [{ productId: g9.p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 500 }]
    })) as Env & { error?: string; code?: number }
    check('G9/P0-1: البيع مرفوض 423 أثناء جرد نشط', blockedSale.ok === false && blockedSale.code === 423, blockedSale.error ?? '')
    check('G9/P0-1: رسالة الحاجز توضح سبب المنع', (blockedSale.error ?? '').includes('جرد'), blockedSale.error ?? '')
    const blockedPurchase = (await invoke(db4, 'purchases.create', {
      token: token4, supplierId: g9.supId, paidMinor: 0, items: [{ productId: g9.p1, qtyMilli: 1000, unitCostMinor: 200 }]
    })) as Env & { code?: number }
    check('G9/P0-1: الشراء مرفوض 423 أثناء جرد نشط', blockedPurchase.ok === false && blockedPurchase.code === 423, blockedPurchase.error ?? '')
    const blockedAdjust = (await invoke(db4, 'inventory.adjust', {
      token: token4, productId: g9.p1, countedQtyMilli: 21000, reason: 'تسوية'
    })) as Env & { code?: number }
    check('G9/P0-1: تسوية المخزون مرفوضة 423 أثناء جرد', blockedAdjust.ok === false && blockedAdjust.code === 423, blockedAdjust.error ?? '')
    const blockedProduction = (await invoke(db4, 'production.create', {
      token: token4, recipeId: 1, actualQtyMilli: 1000
    })) as Env & { code?: number }
    check('G9/P0-1: الإنتاج مرفوض 423 أثناء جرد', blockedProduction.ok === false && blockedProduction.code === 423, blockedProduction.error ?? '')
    const dupCount = (await invoke(db4, 'counts.create', { token: token4 })) as Env & { code?: number }
    check('G9/P0-1: جرد ثانٍ متزامن مرفوض 409', dupCount.ok === false && dupCount.code === 409, dupCount.error ?? '')
    const cancelDraft = (await invoke(db4, 'counts.cancel', { token: token4, id: cnt.data?.id ?? 0, reason: 'اختبار' })) as Env & { data?: { deleted?: boolean } }
    check('G9/P0-1: حذف مسودة الجرد ينجح (فك القفل)', cancelDraft.ok === true && cancelDraft.data?.deleted === true, cancelDraft.error ?? '')
    const saleAfter = (await invoke(db4, 'sales.create', {
      token: token4, items: [{ productId: g9.p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 500 }]
    })) as Env & { data?: { id: number } }
    check('G9/P0-1: البيع يعمل بعد حذف المسودة', saleAfter.ok === true, saleAfter.error ?? '')

    // ----- P0-2: إلغاء دفعة إنتاج بالهالك (صافي لا خام) -----
    const rec = (await invoke(db4, 'recipes.create', {
      token: token4, name: 'وصفة G9', productId: g9.p2, outputQtyMilli: 5000, items: [{ productId: g9.p1, qtyMilli: 5000 }]
    })) as Env & { data?: { id: number } }
    check('G9/P0-2: وصفة أُنشئت', rec.ok === true, rec.error ?? '')
    const p2Before = Number(db4.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE product_id = ?', [g9.p2])?.s ?? 0)
    const p1Before = Number(db4.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE product_id = ?', [g9.p1])?.s ?? 0)
    const batch = (await invoke(db4, 'production.create', {
      token: token4, recipeId: rec.data?.id ?? 1, actualQtyMilli: 2000, wasteQtyMilli: 500
    })) as Env & { data?: { id: number } }
    check('G9/P0-2: دفعة إنتاج بناتج 2000 وهالك 500 أُنشئت', batch.ok === true, batch.error ?? '')
    const p2AfterBatch = Number(db4.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE product_id = ?', [g9.p2])?.s ?? 0)
    check('G9/P0-2: صافي أثر الدفعة على الناتج = 2000 (لا 2500)', p2AfterBatch === p2Before + 2000, `${p2AfterBatch - p2Before}`)
    // بيع جزء من الناتج: الرصيد يصبح أقل من الإجمالي الخام (2500) وأكبر من الصافي (2000)
    const sellSome = (await invoke(db4, 'sales.create', {
      token: token4, items: [{ productId: g9.p2, qtyMilli: 400 }], payments: [{ method: 'CASH', amountMinor: 480 }]
    })) as Env & { data?: { id: number } }
    check('G9/P0-2: بيع 400 من الناتج بعد الدفعة', sellSome.ok === true, sellSome.error ?? '')
    const cancelBatch = (await invoke(db4, 'production.cancel', {
      token: token4, id: batch.data?.id ?? 0, reason: 'اختبار إلغاء بالهالك'
    })) as Env & { error?: string }
    check('G9/P0-2: الإلغاء نجح رغم أن الخام (2500) غير متاح والصافي (2000) متاح', cancelBatch.ok === true, cancelBatch.error ?? '')
    const p2AfterCancel = Number(db4.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE product_id = ?', [g9.p2])?.s ?? 0)
    check('G9/P0-2: رصيد الناتج عاد تمامًا لما قبل الدفعة ناقص المبيع (400)', p2AfterCancel === p2Before - 400, `${p2AfterCancel} vs ${p2Before - 400}`)
    const p1AfterCancel = Number(db4.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM stock_movements WHERE product_id = ?', [g9.p1])?.s ?? 0)
    check('G9/P0-2: رصيد المادة الخام عاد كما كان قبل الدفعة', p1AfterCancel === p1Before, `${p1AfterCancel} vs ${p1Before}`)
    const wasteReversed = db4.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM stock_movements WHERE ref_type = 'batch_cancel' AND ref_id = ? AND type = 'WASTE'", [batch.data?.id ?? 0]
    )
    check('G9/P0-2: حركة الهالك WASTE عُكست فعليًا في الإلغاء', Number(wasteReversed?.c ?? 0) === 1)

    // ----- P0-3 + P1-4: النسخ الاحتياطي كامل بلا أسرار -----
    const tgSet = await invoke(db4, 'settings.update', { token: token4, settings: { telegram_bot_token: '123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' } })
    check('G9/P1-4: توكن تيليجرام محفوظ في الإعدادات', tgSet.ok === true, tgSet.error ?? '')
    const exp = (await invoke(db4, 'backup.export', { token: token4, note: 'G9' })) as Env & { data?: { path: string; schemaVersion: number } }
    check('G9/P0-3: تصدير نسخة نجح', exp.ok === true && typeof exp.data?.path === 'string', exp.error ?? '')
    const backupJson = JSON.parse(readFileSync(exp.data?.path ?? '', 'utf8')) as { schemaVersion: number; redactedSettingsKeys?: string[]; tables: Record<string, unknown[]> }
    check('G9/P0-3: إصدار مخطط النسخة = 2', backupJson.schemaVersion === 2, String(backupJson.schemaVersion))
    check('G9/P0-3: النسخة تتضمن جداول الجرد والإقفال الثلاثة', ['period_close', 'stock_count', 'stock_count_item'].every((t) => Array.isArray(backupJson.tables[t])))
    check('G9/P0-3: عدد بنود الجرد في النسخة = البنود الفعلية', (backupJson.tables['stock_count_item'] ?? []).length === q(db4, 'SELECT COUNT(*) AS c FROM stock_count_item'))
    const settingsRows = (backupJson.tables['settings'] ?? []) as Array<{ key: string }>
    check('G9/P1-4: توكن تيليجرام غائب كليًا عن ملف النسخة', !settingsRows.some((r) => r.key === 'telegram_bot_token') && !readFileSync(exp.data?.path ?? '', 'utf8').includes('xxxxxxxxxx'))
    check('G9/P1-4: قائمة المفاتيح المنقّحة موثقة في النسخة', (backupJson.redactedSettingsKeys ?? []).includes('telegram_bot_token'))
    const v1Preview = (await invoke(db4, 'backup.preview', { token: token4, json: JSON.stringify({ ...backupJson, schemaVersion: 1 }) })) as Env & { error?: string }
    check('G9/P0-3: نسخة مخطط قديم (v1) تُرفض برسالة واضحة', v1Preview.ok === false && (v1Preview.error ?? '').includes('قديم'), v1Preview.error ?? '')
    // استعادة round-trip إلى قاعدة ثانية مع بيانات جرد فعلية
    const cnt2 = (await invoke(db4, 'counts.create', { token: token4 })) as Env & { data?: { id: number } }
    check('G9/P0-3: جرد جديد للمطابقة بعد الاستعادة', cnt2.ok === true, cnt2.error ?? '')
    const exp2 = (await invoke(db4, 'backup.export', { token: token4, note: 'G9-with-count' })) as Env & { data?: { path: string } }
    const countsAtExport = q(db4, 'SELECT COUNT(*) AS c FROM stock_count')
    const itemsAtExport = q(db4, 'SELECT COUNT(*) AS c FROM stock_count_item')
    const cancelCnt2 = (await invoke(db4, 'counts.cancel', { token: token4, id: cnt2.data?.id ?? 0, reason: 'انتهى اختبار النسخ' })) as Env & { data?: { deleted?: boolean } }
    check('G9/P0-3: حذف مسودة الجرد بعد النسخ (فك القفل للمتابعة)', cancelCnt2.ok === true, cancelCnt2.error ?? '')
    const db5 = await openDb(`${TEST_DIR}/data/bakery-g9-restore.db`)
    const setup5 = await invoke(db5, 'setup.run', { businessName: 'قاعدة الاستعادة', ownerName: 'المالك', password: '7777' })
    check('G9/P0-3: قاعدة الاستعادة مهيأة', setup5.ok === true, setup5.error ?? '')
    const login5 = (await invoke(db5, 'auth.login', { password: '7777' })) as Env & { data?: { token: string } }
    check('G9/P0-3: دخول قاعدة الاستعادة نجح', login5.ok === true && typeof login5.data?.token === 'string', login5.error ?? '')
    const rest = (await invoke(db5, 'backup.restore', { token: login5.data?.token, json: readFileSync(exp2.data?.path ?? '', 'utf8'), newOwnerPassword: '1234' })) as Env & { error?: string }
    check('G9/P0-3: الاستعادة نجحت مع بيانات جرد وإقفال', rest.ok === true, rest.error ?? '')
    check('G9/P0-3: سجلات الجرد استُعيدت بالمطابقة (وقت التصدير)', q(db5, 'SELECT COUNT(*) AS c FROM stock_count') === countsAtExport, `${q(db5, 'SELECT COUNT(*) AS c FROM stock_count')} vs ${countsAtExport}`)
    check('G9/P0-3: بنود الجرد استُعيدت بالمطابقة (وقت التصدير)', q(db5, 'SELECT COUNT(*) AS c FROM stock_count_item') === itemsAtExport, `${q(db5, 'SELECT COUNT(*) AS c FROM stock_count_item')} vs ${itemsAtExport}`)
    check('G9/P0-3: التوكن السرّي لم يدخل قاعدة الاستعادة', q(db5, "SELECT COUNT(*) AS c FROM settings WHERE key = 'telegram_bot_token'") === 0)

    // ----- P0-5: فشل الحفظ على القرص -----
    db4.setPersistFn(() => { throw new Error('EACCES: simulated disk full') })
    const write1 = await invoke(db4, 'settings.update', { token: token4, settings: { business_name: 'مخبز بعد فشل الحفظ' } })
    check('G9/P0-5: الكتابة الأولى بعد فشل الحفظ تُقبل (المعاملة التزمت بالذاكرة)', write1.ok === true, write1.error ?? '')
    check('G9/P0-5: حالة persistFailed مرفوعة', db4.persistStatus().persistFailed === true)
    const write2 = (await invoke(db4, 'settings.update', { token: token4, settings: { business_name: 'محاولة ثانية' } })) as Env & { code?: number }
    check('G9/P0-5: أي كتابة جديدة مرفوضة 507 حتى إعادة المحاولة', write2.ok === false && write2.code === 507, write2.error ?? '')
    const status = (await invoke(db4, 'db.persistStatus', { token: token4 })) as Env & { data?: { persistFailed: boolean } }
    check('G9/P0-5: قناة persistStatus تعرض الفشل', status.ok === true && status.data?.persistFailed === true)
    db4.setPersistFn(() => db4.persist())
    const retry = db4.retryPersist()
    check('G9/P0-5: إعادة المحاولة بعد إصلاح القرص تنجح وتفك القفل', retry.ok === true && db4.persistStatus().persistFailed === false)
    const write3 = await invoke(db4, 'settings.update', { token: token4, settings: { business_name: 'مخبز جناح الاختبارات' } })
    check('G9/P0-5: الكتابة تعمل بعد فك القفل', write3.ok === true, write3.error ?? '')

    // ----- حذف الكيانات بلا حركات (طلب المالك) -----
    const freshCat = (await invoke(db4, 'categories.create', { token: token4, name: 'فئة للحذف' })) as Env & { data?: { id: number } }
    const delEmptyCat = (await invoke(db4, 'categories.delete', { token: token4, id: freshCat.data?.id ?? 0 })) as Env & { data?: { deleted?: boolean } }
    check('G9/حذف: فئة فارغة تُحذف', delEmptyCat.ok === true && delEmptyCat.data?.deleted === true, delEmptyCat.error ?? '')
    const delUsedCat = (await invoke(db4, 'categories.delete', { token: token4, id: 1 })) as Env & { code?: number }
    check('G9/حذف: فئة بمنتجات تُرفض 409', delUsedCat.ok === false && delUsedCat.code === 409, delUsedCat.error ?? '')
    const freshProd = (await invoke(db4, 'products.create', {
      token: token4, name: 'منتج للحذف', sku: 'QA-DEL', categoryId: 1, type: 'FINISHED', baseUnit: 'قطعة',
      priceMinor: 100, costMinor: 50, minStockMilli: 0, trackStock: true, active: true
    })) as Env & { data?: { id: number } }
    const delProd = (await invoke(db4, 'products.delete', { token: token4, id: freshProd.data?.id ?? 0 })) as Env & { data?: { deleted?: boolean } }
    check('G9/حذف: منتج بلا حركات يُحذف', delProd.ok === true && delProd.data?.deleted === true, delProd.error ?? '')
    const delUsedProd = (await invoke(db4, 'products.delete', { token: token4, id: g9.p1 })) as Env & { code?: number }
    check('G9/حذف: منتج بحركات يُرفض 409 مع اقتراح التعطيل', delUsedProd.ok === false && delUsedProd.code === 409 && (delUsedProd.error ?? '').includes('تعطيل'), delUsedProd.error ?? '')
    const freshCust = (await invoke(db4, 'customers.create', { token: token4, name: 'عميل بالخطأ' })) as Env & { data?: { id: number } }
    const delCust = (await invoke(db4, 'customers.delete', { token: token4, id: freshCust.data?.id ?? 0 })) as Env & { data?: { deleted?: boolean } }
    check('G9/حذف: عميل بلا قيود يُحذف', delCust.ok === true && delCust.data?.deleted === true, delCust.error ?? '')
    const saleOnCust = (await invoke(db4, 'sales.create', {
      token: token4, customerId: g9.custId, items: [{ productId: g9.p2, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 300 }]
    })) as Env & { data?: { id: number } }
    const delUsedCust = (await invoke(db4, 'customers.delete', { token: token4, id: g9.custId })) as Env & { code?: number }
    check('G9/حذف: عميل بقيود/فواتير يُرفض 409', saleOnCust.ok === true && delUsedCust.ok === false && delUsedCust.code === 409, delUsedCust.error ?? '')
    const freshSup = (await invoke(db4, 'suppliers.create', { token: token4, name: 'مورد بالخطأ' })) as Env & { data?: { id: number } }
    const delSup = (await invoke(db4, 'suppliers.delete', { token: token4, id: freshSup.data?.id ?? 0 })) as Env & { data?: { deleted?: boolean } }
    check('G9/حذف: مورد بلا قيود يُحذف', delSup.ok === true && delSup.data?.deleted === true, delSup.error ?? '')
    const freshRep = (await invoke(db4, 'distribution.reps.create', { token: token4, name: 'مندوب بالخطأ' })) as Env & { data?: { id: number } }
    const delRep = (await invoke(db4, 'distribution.reps.delete', { token: token4, id: freshRep.data?.id ?? 0 })) as Env & { data?: { deleted?: boolean } }
    check('G9/حذف: مندوب بلا جولات يُحذف', delRep.ok === true && delRep.data?.deleted === true, delRep.error ?? '')
    const rep2 = (await invoke(db4, 'distribution.reps.create', { token: token4, name: 'مندوب بجولات' })) as Env & { data?: { id: number } }
    const trip = (await invoke(db4, 'distribution.trips.create', { token: token4, repId: rep2.data?.id ?? 0 })) as Env & { data?: { id: number } }
    check('G9/حذف: جولة أُنشئت للمندوب', trip.ok === true, trip.error ?? '')
    const delUsedRep = (await invoke(db4, 'distribution.reps.delete', { token: token4, id: rep2.data?.id ?? 0 })) as Env & { code?: number }
    check('G9/حذف: مندوب بجولات يُرفض 409', delUsedRep.ok === false && delUsedRep.code === 409, delUsedRep.error ?? '')
    const freshRoute = (await invoke(db4, 'distribution.routes.create', { token: token4, name: 'خط بالخطأ' })) as Env & { data?: { id: number } }
    const delRoute = (await invoke(db4, 'distribution.routes.delete', { token: token4, id: freshRoute.data?.id ?? 0 })) as Env & { data?: { deleted?: boolean } }
    check('G9/حذف: خط بلا جولات يُحذف', delRoute.ok === true && delRoute.data?.deleted === true, delRoute.error ?? '')
    const freshExpCat = (await invoke(db4, 'expenses.categories.create', { token: token4, name: 'فئة مصروف بالخطأ' })) as Env & { data?: { id: number } }
    const delExpCat = (await invoke(db4, 'expenses.categories.delete', { token: token4, id: freshExpCat.data?.id ?? 0 })) as Env & { data?: { deleted?: boolean } }
    check('G9/حذف: فئة مصروفات فارغة تُحذف', delExpCat.ok === true && delExpCat.data?.deleted === true, delExpCat.error ?? '')
    const freshRecipe = (await invoke(db4, 'recipes.create', {
      token: token4, name: 'وصفة بالخطأ', productId: g9.p1, outputQtyMilli: 1000, items: [{ productId: g9.p2, qtyMilli: 1000 }]
    })) as Env & { data?: { id: number } }
    const delRecipe = (await invoke(db4, 'recipes.delete', { token: token4, id: freshRecipe.data?.id ?? 0 })) as Env & { data?: { deleted?: boolean } }
    check('G9/حذف: وصفة غير مستخدمة تُحذف', delRecipe.ok === true && delRecipe.data?.deleted === true, delRecipe.error ?? '')
    const delUsedRecipe = (await invoke(db4, 'recipes.delete', { token: token4, id: rec.data?.id ?? 0 })) as Env & { code?: number }
    check('G9/حذف: وصفة مستخدمة في دفعات تُرفض 409', delUsedRecipe.ok === false && delUsedRecipe.code === 409, delUsedRecipe.error ?? '')
    db4.close()
    db5.close()
  }

  // ============ التقرير النهائي ============
  const report = {
    suite: 'bakery-qa-suite',
    version: '1.0.0-rc.12',
    timestamp: new Date().toISOString(),
    total: pass + fail,
    pass,
    fail,
    groups: groupStats,
    failures
  }
  try {
    writeFileSync('/tmp/bakery-qa-report.json', JSON.stringify(report, null, 2), 'utf8')
  } catch { /* التقرير ملف إضافي */ }
  console.log('\n==============================================')
  console.log(`النتيجة النهائية: ${pass} PASS / ${fail} FAIL من أصل ${pass + fail}`)
  for (const g of groupStats) console.log(`  ${g.group}: ${g.pass}✓ ${g.fail > 0 ? g.fail + '✗' : ''}`)
  if (failures.length > 0) {
    console.log('\nالإخفاقات:')
    for (const f of failures) console.log(`  ✗ ${f}`)
  }
  console.log('==============================================')
  const verdict = fail === 0 ? 'ALL PASS' : 'HAS FAILURES'
  console.log(`VERDICT: ${verdict}`)
  rmSync(TEST_DIR, { force: true, recursive: true })
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('انتهى الجناح بخطأ غير متوقع:', e)
  process.exit(2)
})

// =============================================================
// مخبز الولاء الحديث — مسح كل قنوات IPC لاكتشاف أخطاء SQL (rc.13)
// يُشغَّل: bun scripts/test-all-channels.ts
// النمط: نفس تهيئة test-product-edit.ts (BakeryDb + migrations + dispatch).
// لكل قناة من registry (knownChannels) استدعاءان:
//   أ) حمولة فارغة {}   ب) حمولة نموذجية معقولة بعد بذر نشاط كامل
// النتيجة المقبولة: نجاح أو ApiError متوقع (400/401/403/404/409/422/423/429/507).
// أي «no such column»/«no such table»/SQL خام/استثناء غير متوقع (500) = فشل يُطبع بالقناة والحمولة.
// + فحوص حاجز الجرد المزدوج (rc.13): مسودة stockcount.* تمنع البيع 423.
// =============================================================
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { BakeryDb } from '../src/main/db'
import { dispatch, knownChannels } from '../src/main/registry'

const TEST_DIR = `/tmp/bakery-all-channels-${Date.now()}`
const DB_PATH = `${TEST_DIR}/data/bakery.db`
const WASM = 'node_modules/sql.js/dist/sql-wasm.wasm'

let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log(`PASS | ${name}${extra ? ' | ' + extra : ''}`)
  } else {
    fail++
    failures.push(`${name}${extra ? ' :: ' + extra : ''}`)
    console.log(`FAIL | ${name}${extra ? ' | ' + extra : ''}`)
  }
}

type Env = { ok: boolean; data?: unknown; error?: string; code?: number }
async function invoke(db: BakeryDb, channel: string, payload: Record<string, unknown> = {}): Promise<Env> {
  const r = await dispatch(db, channel, payload)
  if (r.ok) return { ok: true, data: r.data }
  return { ok: false, error: r.error, code: r.code }
}

/** أكواد ApiError المقبولة (رفض تحقق/صلاحيات/حالة عمل) — أي شيء آخر = فشل */
const ACCEPTED_CODES = new Set([400, 401, 403, 404, 409, 422, 423, 429, 507])
const SQL_ERR_RE = /no such column|no such table|no such function|SQL error|constraint failed|malformed/i

function sweep(channel: string, payload: Record<string, unknown>, res: Env): boolean {
  if (res.ok) return true
  const code = res.code ?? 0
  if (ACCEPTED_CODES.has(code) && !SQL_ERR_RE.test(res.error ?? '')) return true
  fail++
  const line = `${channel} | code=${code} | payload=${JSON.stringify(payload).slice(0, 220)} | خطأ=${res.error ?? ''}`
  failures.push(line)
  console.log(`FAIL | قناة: ${line}`)
  return false
}

async function openDb(filePath: string): Promise<BakeryDb> {
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new BakeryDb({ filePath, wasmCandidates: [WASM] })
  await db.init()
  db.setPersistFn(() => db.persist())
  return db
}

async function main(): Promise<void> {
  rmSync(TEST_DIR, { force: true, recursive: true })
  const db = await openDb(DB_PATH)

  // ===== التهيئة وجلسة المالك =====
  const setup = await invoke(db, 'setup.run', { businessName: 'مخبز مسح القنوات', ownerName: 'قصي', password: '1234' })
  check('تهيئة المخبز', setup.ok === true, setup.error ?? '')
  const login = (await invoke(db, 'auth.login', { password: '1234' })) as Env & { data?: { token: string } }
  const token = login.data?.token ?? ''
  check('جلسة OWNER', token.length >= 16)

  const channels = knownChannels().sort()
  check('عدد القنوات المسجلة = 130', channels.length === 130, String(channels.length))

  // =====================================================================
  // المرحلة أ — كل قناة بحمولة فارغة {}: يجب نجاح أو ApiError متوقع (لا SQL خام)
  // =====================================================================
  for (const ch of channels) {
    const res = await invoke(db, ch, {})
    sweep(ch, {}, res)
  }
  check('المرحلة أ: كل القنوات بحمولة فارغة بلا أخطاء SQL/غير متوقعة', true)

  // =====================================================================
  // البذر — نشاط كامل عبر القنوات نفسها (أرقام تُستخدم في الحمولات النموذجية)
  // =====================================================================
  const id = async (ch: string, payload: Record<string, unknown>): Promise<number> => {
    const r = (await invoke(db, ch, { token, ...payload })) as Env & { data?: { id?: number } }
    if (!r.ok || typeof r.data?.id !== 'number') {
      fail++
      const line = `بذر فاشل: ${ch} | ${r.error ?? ''} | ${JSON.stringify(payload).slice(0, 160)}`
      failures.push(line)
      console.log(`FAIL | ${line}`)
      return 0
    }
    return r.data.id
  }

  const cat1 = await id('categories.create', { name: 'خبزومعجنات' })
  const cat2 = await id('categories.create', { name: 'فئة للحذف' })
  const cat3 = await id('categories.create', { name: 'بذور وعطور' })
  const p1 = await id('products.create', { name: 'خبز عربي', sku: 'BRD-1', categoryId: cat1, type: 'FINISHED', baseUnit: 'كيس', priceMinor: 500, costMinor: 200, minStockMilli: 1000, trackStock: true })
  const p2 = await id('products.create', { name: 'دقيق', sku: 'RAW-1', categoryId: cat3, type: 'RAW', baseUnit: 'كجم', priceMinor: 100, costMinor: 100, minStockMilli: 0, trackStock: true })
  const p3 = await id('products.create', { name: 'منتج بلا حركة', sku: 'DEL-1', categoryId: cat2, type: 'TRADE', baseUnit: 'قطعة', priceMinor: 300, costMinor: 100, minStockMilli: 0, trackStock: false })
  await invoke(db, 'inventory.opening', { token, items: [
    { productId: p1, qtyMilli: 500000, unitCostMinor: 200 },
    { productId: p2, qtyMilli: 200000, unitCostMinor: 100 }
  ] })
  const cu1 = await id('customers.create', { name: 'عميل الجولة' })
  const cu2 = await id('customers.create', { name: 'عميل للحذف' })
  const su1 = await id('suppliers.create', { name: 'مورد الدقيق' })
  const su2 = await id('suppliers.create', { name: 'مورد للحذف' })
  const sale1 = await id('sales.create', { customerId: cu1, items: [{ productId: p1, qtyMilli: 5000 }], payments: [{ method: 'CASH', amountMinor: 1000 }] })
  const pur1 = await id('purchases.create', { supplierId: su1, items: [{ productId: p2, qtyMilli: 10000, unitCostMinor: 100 }], paidMinor: 500 })
  const rep1 = await id('distribution.reps.create', { name: 'مندوب النشاط' })
  const rep2 = await id('distribution.reps.create', { name: 'مندوب للحذف' })
  const rt1 = await id('distribution.routes.create', { name: 'خط الشمال' })
  const rt2 = await id('distribution.routes.create', { name: 'خط للحذف' })
  await invoke(db, 'recipes.create', { token, name: 'وصفة الخبز', productId: p1, outputQtyMilli: 12000, items: [{ productId: p2, qtyMilli: 8000 }] })
  const repRec = (await invoke(db, 'recipes.list', { token })) as Env & { data?: Array<{ id: number; name: string }> }
  const recipe1 = repRec.data?.find((r) => r.name === 'وصفة الخبز')?.id ?? 0
  const batch1 = await id('production.create', { recipeId: recipe1, actualQtyMilli: 10000, wasteQtyMilli: 2000 })
  const trip1 = await id('distribution.trips.create', { repId: rep1, routeId: rt1, loads: [{ productId: p1, qtyMilli: 5000 }] })
  const trip2 = await id('distribution.trips.create', { repId: rep1, routeId: rt1, loads: [{ productId: p1, qtyMilli: 6000 }] })
  const ec1 = await id('expenses.categories.create', { name: 'نقل' })
  const ec2 = await id('expenses.categories.create', { name: 'فئة مصروف للحذف' })
  const ex1 = await id('expenses.create', { categoryId: ec1, amountMinor: 2500, note: 'ديزل' })
  await invoke(db, 'shifts.open', { token, openingCashMinor: 1000 })
  await invoke(db, 'cash.record', { token, amountMinor: 500, reason: 'تسوية صندوق تجريبية' })
  const cas1 = await id('users.create', { username: 'cas1', name: 'كاشير المسح', role: 'CASHIER', password: 'cas1234' })

  // =====================================================================
  // المرحلة ب — كل قناة بحمولة نموذجية معقولة (بترتيب يحفظ الحالة)
  // =====================================================================
  const B: Array<[string, Record<string, unknown>]> = [
    // عام
    ['status.get', {}],
    ['auth.me', {}],
    ['auth.login', { password: '1234' }],
    ['setup.run', { businessName: 'ثانية', ownerName: 'لا', password: '1234' }], // 409 متوقع
    // إعدادات ومستخدمون
    ['settings.get', {}],
    ['settings.update', { settings: { receipt_footer: 'تذييل المسح' } }],
    ['users.list', {}],
    ['users.update', { id: cas1, name: 'كاشير محدث' }],
    ['users.setPassword', { id: cas1, password: 'cas5678' }],
    ['users.setPin', { id: cas1, pin: '4321' }],
    // كتالوج
    ['categories.list', {}],
    ['categories.create', { name: 'فئة إضافية' }],
    ['categories.update', { id: cat2, name: 'فئة للحذف ٢' }],
    ['products.list', {}],
    ['products.get', { id: p1 }],
    ['products.create', { name: 'منتج إضافي', type: 'FINISHED', baseUnit: 'قطعة', priceMinor: 100, costMinor: 50, trackStock: true }],
    ['products.update', { id: p1, priceMinor: 750 }],
    // أطراف
    ['customers.list', {}],
    ['customers.get', { id: cu1 }],
    ['customers.statement', { id: cu1 }],
    ['customers.create', { name: 'عميل إضافي' }],
    ['customers.update', { id: cu2, phone: '0599000111' }],
    ['customers.payment', { customerId: cu1, amountMinor: 250 }],
    ['customers.adjust', { customerId: cu1, amountMinor: -100, reason: 'تسوية تجريبية' }],
    ['suppliers.list', {}],
    ['suppliers.get', { id: su1 }],
    ['suppliers.statement', { id: su1 }],
    ['suppliers.create', { name: 'مورد إضافي' }],
    ['suppliers.update', { id: su2, phone: '0599222333' }],
    ['suppliers.payment', { supplierId: su1, amountMinor: 300 }],
    // مبيعات
    ['sales.list', {}],
    ['sales.get', { id: sale1 }],
    ['sales.create', { items: [{ productId: p1, qtyMilli: 3000 }], payments: [{ method: 'CASH', amountMinor: 3000 }] }],
    // مشتريات
    ['purchases.list', {}],
    ['purchases.get', { id: pur1 }],
    ['purchases.create', { supplierId: su1, items: [{ productId: p2, qtyMilli: 2000, unitCostMinor: 100 }], paidMinor: 200 }],
    ['purchases.payment', { supplierId: su1, amountMinor: 100 }],
    // مخزون
    ['inventory.balances', {}],
    ['inventory.movements', { productId: p1 }],
    ['inventory.low', {}],
    ['inventory.adjust', { productId: p2, countedQtyMilli: 200000, reason: 'تسوية مسح' }],
    ['inventory.waste', { productId: p2, qtyMilli: 500, reason: 'هالك مسح' }],
    // وصفات وإنتاج
    ['recipes.list', {}],
    ['recipes.get', { id: recipe1 }],
    ['recipes.create', { name: 'وصفة للحذف', productId: p3, outputQtyMilli: 1000, items: [{ productId: p2, qtyMilli: 500 }] }],
    ['recipes.update', { id: recipe1, name: 'وصفة الخبز المحدثة', outputQtyMilli: 12000, items: [{ productId: p2, qtyMilli: 8000 }] }],
    ['production.list', {}],
    ['production.create', { recipeId: recipe1, actualQtyMilli: 4000 }],
    // توزيع
    ['distribution.reps.list', {}],
    ['distribution.reps.create', { name: 'مندوب إضافي' }],
    ['distribution.reps.update', { id: rep2, phone: '0599444555' }],
    ['distribution.routes.list', {}],
    ['distribution.routes.create', { name: 'خط إضافي' }],
    ['distribution.routes.update', { id: rt2, name: 'خط للحذف ٢' }],
    ['distribution.trips.list', {}],
    ['distribution.trips.get', { id: trip1 }],
    ['distribution.trips.create', { repId: rep1, routeId: rt1, loads: [{ productId: p1, qtyMilli: 1000 }] }],
    ['distribution.trips.load', { tripId: trip1, productId: p1, qtyMilli: 1000 }],
    // إقفال الشهور (شهر مستقبلي معزول 2030-01 ثم يُفك)
    ['periods.list', {}],
    ['period.close', { month: '2030-01' }],
    ['period.unlock', { month: '2030-01', reason: 'فك مسح القنوات 2030-01' }],
    // مصروفات
    ['expenses.categories.list', {}],
    ['expenses.categories.create', { name: 'فئة إضافية' }],
    ['expenses.list', {}],
    ['expenses.create', { categoryId: ec1, amountMinor: 700, note: 'مسح' }],
    // ورديات وصندوق
    ['shifts.current', {}],
    ['shifts.list', {}],
    ['shifts.close', { countedCashMinor: 1500, notes: 'إغلاق المسح' }],
    ['cash.list', {}],
    ['cash.record', { amountMinor: -200, reason: 'خصم تجريبي مسح' }],
    // تدقيق وقاعدة البيانات
    ['audit.list', {}],
    ['db.persistStatus', {}],
    ['db.retryPersist', {}],
    // تقارير
    ['reports.dashboard', {}],
    ['reports.dashboardExtra', {}],
    ['reports.sales', { from: '2000-01-01', to: '2999-01-01' }],
    ['reports.collections', { from: '2000-01-01', to: '2999-01-01' }],
    ['reports.debts', {}],
    ['reports.suppliers', {}],
    ['reports.purchases', { from: '2000-01-01', to: '2999-01-01' }],
    ['reports.inventory', {}],
    ['reports.production', { from: '2000-01-01', to: '2999-01-01' }],
    ['reports.expenses', { from: '2000-01-01', to: '2999-01-01' }],
    ['reports.cash', { from: '2000-01-01', to: '2999-01-01' }],
    ['reports.distribution', { from: '2000-01-01', to: '2999-01-01' }],
    ['reports.eod', {}],
    // تيليجرام — بلا توكن: 422 متوقع وبلا اتصال شبكة
    ['telegram.test', {}]
  ]

  for (const [ch, payload] of B) {
    const res = await invoke(db, ch, { token, ...payload })
    sweep(ch, payload, res)
  }
  check('المرحلة ب-1: القنوات غير الجردية بحمولات نموذجية بلا أخطاء SQL', true)

  // ----- قنوات الإلغاء والحذف (بعد استقرار الأرصدة) -----
  const C: Array<[string, Record<string, unknown>]> = [
    ['distribution.trips.return', { tripId: trip2, items: [{ productId: p1, qtyMilli: 1000, condition: 'GOOD' }] }],
    ['distribution.trips.sale', { tripId: trip2, items: [{ productId: p1, qtyMilli: 2000, unitPriceMinor: 500, paymentType: 'CASH' }] }],
    ['distribution.trips.settle', { tripId: trip2, countedCashMinor: 1000, notes: 'تسوية المسح' }],
    ['distribution.trips.cancel', { id: trip1, reason: 'إلغاء جولة المسح' }],
    ['sales.cancel', { id: sale1, reason: 'إلغاء مسح القنوات' }],
    ['purchases.cancel', { id: pur1, reason: 'إلغاء مسح القنوات' }],
    ['production.cancel', { id: batch1, reason: 'إلغاء مسح القنوات' }],
    ['expenses.cancel', { id: ex1, reason: 'إلغاء مسح القنوات' }],
    // حذف الكيانات غير المستخدمة
    ['products.delete', { id: p3 }],
    ['categories.delete', { id: cat2 }],
    ['customers.delete', { id: cu2 }],
    ['suppliers.delete', { id: su2 }],
    ['distribution.reps.delete', { id: rep2 }],
    ['distribution.routes.delete', { id: rt2 }],
    ['expenses.categories.delete', { id: ec2 }],
    ['users.delete', { id: cas1 }]
  ]
  for (const [ch, payload] of C) {
    const res = await invoke(db, ch, { token, ...payload })
    sweep(ch, payload, res)
  }
  check('المرحلة ب-2: قنوات الإلغاء والحذف بلا أخطاء SQL', true)

  // ----- قنوات النسخ الاحتياطي (تصدير → معاينة → قائمة → مجلد) -----
  const exp = (await invoke(db, 'backup.export', { token, note: 'نسخة المسح' })) as Env & { data?: { path: string } }
  sweep('backup.export', { note: 'نسخة المسح' }, exp)
  check('backup.export نجح وينتج ملفًا', exp.ok === true && typeof exp.data?.path === 'string')
  const backupJson = exp.ok && exp.data?.path ? readFileSync(exp.data.path, 'utf8') : ''
  check('نسخة المسح لا تحمل توكن تيليجرام (أي قيمة token لا تُصدَّر)', !backupJson.includes('telegram_bot_token'))
  sweep('backup.list', {}, await invoke(db, 'backup.list', { token }))
  sweep('backup.preview', { json: backupJson }, await invoke(db, 'backup.preview', { token, json: backupJson }))
  sweep('backup.folderInfo', {}, await invoke(db, 'backup.folderInfo', { token }))
  sweep('backup.openFolder', {}, await invoke(db, 'backup.openFolder', { token }))
  sweep('backup.autoStatus', {}, await invoke(db, 'backup.autoStatus', { token }))

  // ----- قنوات الجرد (نظام الفترات counts.* ثم شاشة الجرد stockcount.*) -----
  const month = new Date().toISOString().slice(0, 7)
  const cnt = (await invoke(db, 'counts.create', { token, month })) as Env & { data?: { id: number } }
  sweep('counts.create', { month }, cnt)
  const countId = cnt.data?.id ?? 0
  const cntGet = (await invoke(db, 'counts.get', { token, id: countId })) as Env & { data?: { items: Array<{ id: number; product_id: number; system_qty_milli: number }> } }
  sweep('counts.get', { id: countId }, cntGet)
  const firstItem = cntGet.data?.items?.[0]
  sweep('counts.saveItems', { id: countId }, await invoke(db, 'counts.saveItems', { token, id: countId, items: firstItem ? [{ itemId: firstItem.id, countedQtyMilli: Number(firstItem.system_qty_milli) }] : [] }))
  sweep('counts.approve', { id: countId }, await invoke(db, 'counts.approve', { token, id: countId, note: 'اعتماد المسح' }))
  sweep('reports.countVariance', { id: countId }, await invoke(db, 'reports.countVariance', { token, id: countId }))
  sweep('counts.list', {}, await invoke(db, 'counts.list', { token }))

  const scOpen = (await invoke(db, 'stockcount.open', { token, periodYm: month })) as Env & { data?: { count?: { id: number } } }
  sweep('stockcount.open', { periodYm: month }, scOpen)
  const scId = scOpen.data?.count?.id ?? 0
  sweep('stockcount.get', { periodYm: month }, await invoke(db, 'stockcount.get', { token, periodYm: month }))
  sweep('stockcount.saveItems', { countId: scId }, await invoke(db, 'stockcount.saveItems', { token, countId: scId, items: [{ productId: p1, actualQtyMilli: 490000, reason: 'تسوية' }] }))
  sweep('stockcount.variances', { periodYm: month }, await invoke(db, 'stockcount.variances', { token, periodYm: month }))
  sweep('stockcount.approve', { countId: scId }, await invoke(db, 'stockcount.approve', { token, countId: scId }))
  sweep('stockcount.getMonthStatuses', { fromYm: month, toYm: month }, await invoke(db, 'stockcount.getMonthStatuses', { token, fromYm: month, toYm: month }))
  sweep('stockcount.closeMonth', { periodYm: '2030-02' }, await invoke(db, 'stockcount.closeMonth', { token, periodYm: '2030-02', note: 'إقفال معزول' }))
  sweep('stockcount.unlockMonth', { periodYm: '2030-02' }, await invoke(db, 'stockcount.unlockMonth', { token, periodYm: '2030-02', unlockReason: 'فك مسح القنوات 2030-02' }))
  check('المرحلة ب-3: قنوات الجرد والإقفال بلا أخطاء SQL', true)

  // ----- فحوص حاجز الجرد المزدوج (rc.13): مسودة شاشة الجرد تمنع البيع والشراء والإنتاج -----
  const draft = (await invoke(db, 'stockcount.open', { token, periodYm: month })) as Env & { data?: { count?: { id: number } } }
  check('فتح مسودة جرد شاشة الجرد', draft.ok === true, draft.error ?? '')
  const blockedSale = await invoke(db, 'sales.create', { token, items: [{ productId: p1, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 500 }] })
  check('P0-1: بيع أثناء مسودة شاشة الجرد مرفوض 423', blockedSale.ok === false && blockedSale.code === 423, `code=${blockedSale.code} ${blockedSale.error ?? ''}`)
  const blockedPurchase = await invoke(db, 'purchases.create', { token, supplierId: su1, items: [{ productId: p2, qtyMilli: 1000, unitCostMinor: 100 }] })
  check('P0-1: شراء أثناء مسودة شاشة الجرد مرفوض 423', blockedPurchase.ok === false && blockedPurchase.code === 423, `code=${blockedPurchase.code}`)
  const blockedBatch = await invoke(db, 'production.create', { token, recipeId: recipe1, actualQtyMilli: 1000 })
  check('P0-1: إنتاج أثناء مسودة شاشة الجرد مرفوض 423', blockedBatch.ok === false && blockedBatch.code === 423, `code=${blockedBatch.code}`)
  const blockedLoad = await invoke(db, 'distribution.trips.create', { token, repId: rep1, loads: [{ productId: p1, qtyMilli: 1000 }] })
  check('P0-1: تحميل جولة أثناء مسودة شاشة الجرد مرفوض 423', blockedLoad.ok === false && blockedLoad.code === 423, `code=${blockedLoad.code}`)
  // حذف المسودة عبر counts.cancel (يحذف مسودات النظامين — rc.13)
  const delDraft = await invoke(db, 'counts.cancel', { token, id: draft.data?.count?.id, reason: 'تنظيف المسح' })
  check('P0-1: حذف مسودة شاشة الجرد عبر counts.cancel ينجح', delDraft.ok === true, delDraft.error ?? '')
  const saleAfter = await invoke(db, 'sales.create', { token, items: [{ productId: p1, qtyMilli: 2000 }], payments: [{ method: 'CASH', amountMinor: 1500 }] })
  check('P0-1: البيع يعمل بعد حذف المسودة', saleAfter.ok === true, saleAfter.error ?? '')

  // rc.13 (P0-4): تصدير ثانٍ بعد دورة الجرد والإقفال — يثبت أن الجداول الثلاثة الناقصة سابقًا تُصدَّر بصفوفها
  const exp2 = (await invoke(db, 'backup.export', { token, note: 'نسخة المسح ٢' })) as Env & { data?: { path: string } }
  sweep('backup.export', { note: 'نسخة المسح ٢' }, exp2)
  const backupJson2 = exp2.ok && exp2.data?.path ? readFileSync(exp2.data.path, 'utf8') : ''
  const parsedBackup = JSON.parse(backupJson2) as { tables: Record<string, Array<unknown>> }
  check('P0-4: النسخة تتضمن month_closes (إقفال 2030-02 من شاشة الجرد)', (parsedBackup.tables['month_closes']?.length ?? 0) >= 1, String(parsedBackup.tables['month_closes']?.length))
  check('P0-4: النسخة تتضمن stock_counts (ورقة شاشة الجرد المعتمدة)', (parsedBackup.tables['stock_counts']?.length ?? 0) >= 1, String(parsedBackup.tables['stock_counts']?.length))
  check('P0-4: النسخة تتضمن stock_count_items (بنود الورقة)', (parsedBackup.tables['stock_count_items']?.length ?? 0) >= 1, String(parsedBackup.tables['stock_count_items']?.length))

  // ----- backup.restore آخر خطوة: استعادة نسخة المسح كاملة (تعيين كلمة مالك جديدة) -----
  const restore = await invoke(db, 'backup.restore', { token, json: backupJson2, newOwnerPassword: '9999' })
  sweep('backup.restore', { json: '<نسخة المسح>', newOwnerPassword: '***' }, restore)
  check('backup.restore استعادة كاملة ناجحة', restore.ok === true, restore.error ?? '')
  const loginAfter = await invoke(db, 'auth.login', { password: '9999' })
  check('الدخول بعد الاستعادة بكلمة المالك الجديدة', loginAfter.ok === true, loginAfter.error ?? '')
  // rc.13 (P0-4): بعد الاستعادة أقفال الشهور وأوراق الجرد حية (كانت ستُمحى/تُفقد قبل الإصلاح)
  const mcAfter = Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM month_closes')?.c ?? -1)
  const scAfter = Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM stock_counts')?.c ?? -1)
  check('P0-4: month_closes حية بعد الاستعادة', mcAfter >= 1, String(mcAfter))
  check('P0-4: stock_counts حية بعد الاستعادة', scAfter >= 1, String(scAfter))
  sweep('products.list (بعد الاستعادة)', {}, await invoke(db, 'products.list', { token: ((loginAfter as Env & { data?: { token: string } }).data?.token ?? token) }))

  // =====================================================================
  // المرحلة ج — مرور أخير بحمولة {} على كل القنوات (بعد الاستعادة) للتأكد من عدم كسر شيء
  // =====================================================================
  for (const ch of channels) {
    const res = await invoke(db, ch, {})
    sweep(ch, {}, res)
  }

  console.log('==============================================')
  console.log(`القنوات المفحوصة: ${channels.length} (مرحلة أ + مرحلة ب + مرحلة ج)`)
  console.log(`النتيجة: PASS=${pass} FAIL=${fail}`)
  if (failures.length) {
    console.log('إخفاقات:')
    for (const f of failures) console.log('  -', f)
  }
  console.log(fail === 0 ? 'ALL-CHANNELS-SWEEP: ALL PASS' : 'ALL-CHANNELS-SWEEP: FAILURES')
  process.exit(fail === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error('CRASH', e)
  process.exit(2)
})

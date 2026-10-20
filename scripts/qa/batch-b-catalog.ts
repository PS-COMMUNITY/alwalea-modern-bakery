// =============================================================
// QA الدفعة B — المنتجات والتصنيفات والعملاء والموردون
// DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/batch-b-catalog.ts
// =============================================================
import { call, captureSession, state, t, expect, eq, finish, db, customerDebtMinor, supplierDueMinor } from './harness'

const ids = await Bun.file('/tmp/qa-bakery/ids.json').json()
// دخول جديد لكل دفعة (عملية مستقلة)
{
  const l = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(l.status, 200, 'دخول مالك لبدء الدفعة')
  captureSession(l)
}
// تنظيف بقايا تشغيل سابق (معزول)
await db.customerLedgerEntry.deleteMany({ where: { customer: { name: 'عميل QA دين' } } })
await db.customer.deleteMany({ where: { name: 'عميل QA دين' } })
await db.product.deleteMany({ where: { name: { contains: 'QA' } } })

/* ---------- المنتجات ---------- */
let qaProductId = ''
await t('إنشاء منتج بكود وباركود', { screen: 'المنتجات', uiPath: 'المنتجات → منتج جديد → حفظ', expected: '200 + سجل جديد', testRef: 'batch-b' }, async () => {
  const r = await call('POST', '/api/products', { body: { name: 'عصير QA', code: 'QA-J1', barcode: 'QA-BAR-1', categoryId: ids.cats['مشروبات'], type: 'TRADE', priceMinor: 500, costMinor: 300, minStockMilli: 2000 } })
  eq(r.status, 200, 'status')
  qaProductId = r.json.id
  const row = await db.product.findUnique({ where: { id: qaProductId } })
  eq(row?.code, 'QA-J1', 'الكود محفوظ')
  return 'منتج تجاري جديد بكود وباركود'
})

await t('رفض كود/باركود مكرر', { screen: 'المنتجات', uiPath: 'منتج جديد بكود مستخدم', expected: '409 لكليهما', testRef: 'batch-b' }, async () => {
  const dupCode = await call('POST', '/api/products', { body: { name: 'مكرر كود', code: 'QA-J1' } })
  eq(dupCode.status, 409, 'كود مكرر')
  const dupBar = await call('POST', '/api/products', { body: { name: 'مكرر باركود', barcode: 'QA-BAR-1' } })
  eq(dupBar.status, 409, 'باركود مكرر')
})

await t('رفض بيانات منتج غير صالحة (نوع/سعر/تصنيف)', { screen: 'المنتجات', uiPath: 'منتج جديد ببيانات خاطئة', expected: '400 في الحالات الثلاث', testRef: 'batch-b' }, async () => {
  const badType = await call('POST', '/api/products', { body: { name: 'نوع خاطئ', type: 'UNKNOWN' } })
  eq(badType.status, 400, 'نوع غير معروف')
  const badPrice = await call('POST', '/api/products', { body: { name: 'سعر خاطئ', priceMinor: -5 } })
  eq(badPrice.status, 400, 'سعر سالب')
  const badCat = await call('POST', '/api/products', { body: { name: 'تصنيف خاطئ', categoryId: 'nonexistent-cat' } })
  eq(badCat.status, 400, 'تصنيف غير موجود')
  const noName = await call('POST', '/api/products', { body: { name: '  ' } })
  eq(noName.status, 400, 'اسم فارغ')
})

await t('بحث المنتجات بالاسم/الكود + رصيد كل منتج', { screen: 'المنتجات', uiPath: 'البحث في شاشة المنتجات', expected: 'q يعمل + stockMilli محسوب', testRef: 'batch-b' }, async () => {
  const byName = await call('GET', '/api/products', { query: { q: 'خبز عادي' } })
  eq(byName.status, 200, 'status')
  expect(byName.json.items.some((x: any) => x.name === 'خبز عادي'), 'وجد المنتج بالاسم')
  const byCode = await call('GET', '/api/products', { query: { q: 'QA-J1' } })
  expect(byCode.json.items.some((x: any) => x.id === qaProductId), 'وجد بالكود')
  const flour = byName.json.items.find((x: any) => x.id === ids.p['خبز عادي'])
  const expectStock = 0 // خبز عادي بلا حركات بعد
  eq(flour?.stockMilli, expectStock, 'stockMilli للمنتج بلا حركات')
  const flour2 = (await call('GET', '/api/products', { query: { q: 'دقيق' } })).json.items[0]
  eq(flour2.stockMilli, 150000, 'دقيق: افتتاحي 100000 + شراء 50000')
})

await t('تعديل سعر منتج → تدقيق PRICE_UPDATE', { screen: 'المنتجات', uiPath: 'تعديل منتج → سعر جديد', expected: '200 + تدقيق بالقديم والجديد', testRef: 'batch-b' }, async () => {
  const r = await call('PUT', `/api/products/${qaProductId}`, { body: { priceMinor: 600 } })
  eq(r.status, 200, 'status')
  const a = await db.auditLog.findFirst({ where: { action: 'PRICE_UPDATE' }, orderBy: { date: 'desc' } })
  expect(a, 'سجل PRICE_UPDATE موجود')
  expect(String(a?.details).includes('600'), 'السعر الجديد موثق')
})

await t('تعطيل منتج ثم إخفاؤه من القائمة النشطة', { screen: 'المنتجات', uiPath: 'تعديل منتج → تعطيل', expected: 'active=false + فلتر active=true يستبعده', testRef: 'batch-b' }, async () => {
  const r = await call('PUT', `/api/products/${ids.p['خبز قديم']}`, { body: { active: false } })
  eq(r.status, 200, 'status')
  const list = await call('GET', '/api/products', { query: { active: 'true' } })
  expect(!list.json.items.some((x: any) => x.id === ids.p['خبز قديم']), 'المعطل مستبعد من النشطين')
  const all = await call('GET', '/api/products', { query: { active: 'false' } })
  expect(all.json.items.some((x: any) => x.id === ids.p['خبز قديم']), 'يظهر في المعطلين')
})

/* ---------- التصنيفات ---------- */
await t('تصنيف: تكرار الاسم → 409، تعديل وإلغاء تفعيل', { screen: 'التصنيفات', uiPath: 'إدارة التصنيفات داخل شاشة المنتجات', expected: '409 + 200 + فلاتر', testRef: 'batch-b' }, async () => {
  const dup = await call('POST', '/api/categories', { body: { name: 'خبز' } })
  eq(dup.status, 409, 'اسم مكرر')
  const created = await call('POST', '/api/categories', { body: { name: 'تصنيف QA' } })
  eq(created.status, 200, 'إنشاء')
  const upd = await call('PUT', `/api/categories/${created.json.id}`, { body: { name: 'تصنيف QA معدل', active: false } })
  eq(upd.status, 200, 'تعديل')
  const list = await call('GET', '/api/categories', { query: { active: 'true' } })
  expect(!list.json.items.some((x: any) => x.id === created.json.id), 'المعطل مستبعد')
  const nf = await call('PUT', '/api/categories/nonexistent', { body: { name: 'x' } })
  eq(nf.status, 404, 'تصنيف غير موجود')
})

/* ---------- العملاء ---------- */
let qaDebtor = ''
await t('إنشاء عميل بحد ائتمان + رفض نوع سعر خاطئ', { screen: 'العملاء', uiPath: 'العملاء → عميل جديد', expected: '200 + 400', testRef: 'batch-b' }, async () => {
  const ok1 = await call('POST', '/api/customers', { body: { name: 'عميل QA دين', creditLimitMinor: 10000, defaultPriceType: 'RETAIL' } })
  eq(ok1.status, 200, 'status')
  qaDebtor = ok1.json.id
  const bad = await call('POST', '/api/customers', { body: { name: 'سعر خاطئ', defaultPriceType: 'VIP' } })
  eq(bad.status, 400, 'نوع سعر غير معروف')
  const badLimit = await call('POST', '/api/customers', { body: { name: 'حد خاطئ', creditLimitMinor: -1 } })
  eq(badLimit.status, 400, 'حد ائتمان سالب')
})

await t('تسوية دفتر العميل: زيادة دين بمالك فقط', { screen: 'العملاء → كشف الحساب', uiPath: 'كشف الحساب → تسوية', expected: '200 للمالك + 400 بلا سبب', testRef: 'batch-b' }, async () => {
  const noReason = await call('POST', `/api/customers/${qaDebtor}/adjustments`, { body: { amountMinor: 5000, reason: '' } })
  eq(noReason.status, 400, 'سبب مطلوب')
  const zero = await call('POST', `/api/customers/${qaDebtor}/adjustments`, { body: { amountMinor: 0, reason: 'صفر' } })
  eq(zero.status, 400, 'صفر مرفوض')
  const ok1 = await call('POST', `/api/customers/${qaDebtor}/adjustments`, { body: { amountMinor: 5000, reason: 'دين افتتاحي قديم' } })
  eq(ok1.status, 200, 'تسوية موجبة')
  eq(await customerDebtMinor(qaDebtor), 5000, 'الدين = 5000')
})

await t('تحصيل دفعة نقدية: دفتر + صندوق الوردية المفتوحة', { screen: 'العملاء', uiPath: 'العملاء → تحصيل دفعة', expected: 'الدين 5000→3000 + CashMovement CUSTOMER_PAYMENT +2000', testRef: 'batch-b' }, async () => {
  const cashBefore = await db.cashMovement.aggregate({ where: { type: 'CUSTOMER_PAYMENT' }, _sum: { amountMinor: true } })
  const r = await call('POST', `/api/customers/${qaDebtor}/payments`, { body: { amountMinor: 2000, method: 'CASH', note: 'دفعة أولى' } })
  eq(r.status, 200, 'status')
  eq(r.json.debtMinorBefore, 5000, 'قبل الدفع')
  eq(r.json.debtMinorAfter, 3000, 'بعد الدفع')
  eq(await customerDebtMinor(qaDebtor), 3000, 'رصيد الدفتر')
  const pay = await db.salePayment.findFirst({ where: { customerId: qaDebtor, saleId: null } })
  expect(pay, 'صف SalePayment تحصيل مستقل')
  eq(pay?.shiftId, ids.shiftId, 'مرتبط بالوردية المفتوحة')
  const cashAfter = await db.cashMovement.aggregate({ where: { type: 'CUSTOMER_PAYMENT' }, _sum: { amountMinor: true } })
  eq((cashAfter._sum.amountMinor ?? 0) - (cashBefore._sum.amountMinor ?? 0), 2000, 'حركة صندوق +2000')
})

await t('تحصيل أكبر من الدين → تحذير واضح لا رفض', { screen: 'العملاء', uiPath: 'تحصيل مبلغ زائد', expected: '200 + warning عربي', testRef: 'batch-b' }, async () => {
  const r = await call('POST', `/api/customers/${qaDebtor}/payments`, { body: { amountMinor: 99999, method: 'CASH' } })
  eq(r.status, 200, 'مقبول كرصيد دائن')
  expect(String(r.json.warning).includes('أكبر من الدين'), 'تحذير: ' + r.json.warning)
  eq(await customerDebtMinor(qaDebtor), 3000 - 99999, 'رصيد سالب (دفع زائد) موثق في الدفتر')
  // إعادة الضبط: تسوية سالبة لإلغاء الزيادة (لنؤكد أن الدين 3000 كما قبل التحصيل الزائد)
  await call('POST', `/api/customers/${qaDebtor}/adjustments`, { body: { amountMinor: 99999, reason: 'تصحيح دفعة زائدة اختبارية' } })
  eq(await customerDebtMinor(qaDebtor), 3000, 'الرصيد عاد 3000')
})

await t('طريقة دفع غير صالحة → 400', { screen: 'العملاء', uiPath: 'تحصيل بطريقة غير معروفة', expected: '400', testRef: 'batch-b' }, async () => {
  const r = await call('POST', `/api/customers/${qaDebtor}/payments`, { body: { amountMinor: 100, method: 'BITCOIN' } })
  eq(r.status, 400, 'status')
})

await t('كشف حساب العميل: أرصدة جارية صحيحة', { screen: 'العملاء → كشف الحساب', uiPath: 'كشف حساب عميل', expected: 'أرصدة متسلسلة = مجموع القيود', testRef: 'batch-b' }, async () => {
  const r = await call('GET', `/api/customers/${qaDebtor}/statement`)
  eq(r.status, 200, 'status')
  const entries = r.json.entries
  expect(entries.length >= 3, `قيود كافية (${entries.length})`)
  let running = 0
  for (const e of entries) {
    running += e.amountMinor
    eq(e.balanceMinor, running, `رصيد جارٍ بعد ${e.type}`)
  }
  eq(r.json.closingBalanceMinor, 3000, 'الرصيد الختامي')
})

/* ---------- الموردون ---------- */
let qaSupplier = ''
await t('إنشاء مورد + كشف حساب فارغ', { screen: 'الموردون', uiPath: 'الموردون → مورد جديد', expected: '200 + أرصدة صفرية', testRef: 'batch-b' }, async () => {
  const r = await call('POST', '/api/suppliers', { body: { name: 'مورد QA' } })
  eq(r.status, 200, 'status')
  qaSupplier = r.json.id
  const st = await call('GET', `/api/suppliers/${qaSupplier}/statement`)
  eq(st.json.closingBalanceMinor, 0, 'رصيد افتتاحي صفر')
  const noName = await call('POST', '/api/suppliers', { body: { name: '' } })
  eq(noName.status, 400, 'اسم مطلوب')
})

await t('دفع لمورد نقدًا: دفتر + صندوق (−)', { screen: 'الموردون', uiPath: 'الموردون → دفعة لمورد', expected: 'CashMovement PURCHASE_PAYMENT −500', testRef: 'batch-b' }, async () => {
  const r = await call('POST', `/api/suppliers/${qaSupplier}/payments`, { body: { amountMinor: 500, method: 'CASH' } })
  eq(r.status, 200, 'status')
  eq(r.json.dueMinorAfter, -500, 'مستحقات سالبة (دفع مقدمة)')
  const cm = await db.cashMovement.findFirst({ where: { type: 'PURCHASE_PAYMENT', refType: 'PurchasePayment' }, orderBy: { date: 'desc' } })
  eq(cm?.amountMinor, -500, 'حركة صندوق سالبة')
  const badMethod = await call('POST', `/api/suppliers/${qaSupplier}/payments`, { body: { amountMinor: 100, method: 'CASH2' } })
  eq(badMethod.status, 400, 'طريقة غير صالحة')
})

await finish('batch-b-catalog')
process.exit(0)

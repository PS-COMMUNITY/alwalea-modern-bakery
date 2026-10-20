// =============================================================
// QA الدفعة E — التقارير والتصدير والنسخ الاحتياطي/الاستعادة (قاعدة منفصلة)
// DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/batch-e-reports.ts
// =============================================================
import { call, captureSession, t, expect, eq, finish, db, stockOf, customerDebtMinor } from './harness'

const ids = await Bun.file('/tmp/qa-bakery/ids.json').json()
{
  const l = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(l.status, 200, 'دخول مالك')
  captureSession(l)
}
const today = new Date()
const dstr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const range = { from: dstr(today), to: dstr(today) }

/* ---------- لوحة التحكم ---------- */
await t('لوحة التحكم: أرقام مطابقة لمصدر البيانات', { screen: 'لوحة التحكم', uiPath: 'فتح لوحة التحكم', expected: 'مبيعات اليوم = تجميع القاعدة + ديون = دفتر العملاء', testRef: 'batch-e' }, async () => {
  const r = await call('GET', '/api/reports/dashboard', { query: range })
  eq(r.status, 200, 'status')
  const dbSales = await db.sale.aggregate({ where: { status: 'COMPLETED', date: { gte: new Date(`${range.from}T00:00:00.000`), lte: new Date(`${range.to}T23:59:59.999`) } }, _sum: { totalMinor: true }, _count: true })
  eq(r.json.today.salesTotalMinor, dbSales._sum.totalMinor ?? 0, 'مبيعات اليوم')
  eq(r.json.today.invoicesCount, dbSales._count, 'عدد الفواتير')
  const debts = await db.customerLedgerEntry.groupBy({ by: ['customerId'], _sum: { amountMinor: true } })
  const positive = debts.filter(d => (d._sum.amountMinor ?? 0) > 0).reduce((a, d) => a + (d._sum.amountMinor ?? 0), 0)
  eq(r.json.customerDebts.totalMinor, positive, 'إجمالي الديون الموجبة')
  expect(typeof r.json.stockAlerts.count === 'number', 'تنبيهات المخزون قائمة')
  expect(r.json.openOperations.openShift !== undefined, 'حالة الوردية موجودة')
})

await t('تقرير المبيعات: إجماليات + حسب المنتج مطابقة للبنود', { screen: 'التقارير → المبيعات', uiPath: 'التقارير → المبيعات مع فلاتر التاريخ', expected: 'totals = تجميع الفواتير + byProduct من البنود', testRef: 'batch-e' }, async () => {
  const r = await call('GET', '/api/reports/sales', { query: range })
  eq(r.status, 200, 'status')
  const agg = await db.sale.aggregate({ where: { status: 'COMPLETED', date: { gte: new Date(`${range.from}T00:00:00.000`), lte: new Date(`${range.to}T23:59:59.999`) } }, _sum: { totalMinor: true, subtotalMinor: true, taxMinor: true, discountMinor: true } })
  eq(r.json.totals.totalMinor, agg._sum.totalMinor ?? 0, 'الإجمالي')
  eq(r.json.totals.taxMinor, agg._sum.taxMinor ?? 0, 'الضريبة')
  const teaItems = await db.saleItem.aggregate({ where: { productId: ids.p['شاي'], sale: { status: 'COMPLETED' } }, _sum: { lineTotalMinor: true } })
  const teaRow = r.json.byProduct.find((x: any) => x.productId === ids.p['شاي'])
  expect(teaRow, 'صف الشاي في byProduct')
  eq(teaRow.totalMinor, teaItems._sum.lineTotalMinor ?? 0, 'إجمالي الشاي من البنود')
})

await t('تقرير الربح: COGS من تكلفة البنود', { screen: 'التقارير → الربح', uiPath: 'التقارير → الربحية', expected: 'grossProfit = sales − cogs (تجميع البنود)', testRef: 'batch-e' }, async () => {
  const r = await call('GET', '/api/reports/profit', { query: range })
  eq(r.status, 200, 'status')
  const items = await db.saleItem.findMany({ where: { sale: { status: 'COMPLETED', date: { gte: new Date(`${range.from}T00:00:00.000`), lte: new Date(`${range.to}T23:59:59.999`) } } } })
  const cogs = items.reduce((a, i) => a + Math.round((i.qtyMilli * i.costMinor) / 1000), 0)
  const sales = await db.sale.aggregate({ where: { status: 'COMPLETED', date: { gte: new Date(`${range.from}T00:00:00.000`), lte: new Date(`${range.to}T23:59:59.999`) } }, _sum: { totalMinor: true } })
  eq(r.json.sales.totalMinor, sales._sum.totalMinor ?? 0, 'المبيعات')
  eq(r.json.cogsMinor, cogs, 'تكلفة المبيعات')
  eq(r.json.grossProfitMinor, (sales._sum.totalMinor ?? 0) - cogs, 'الربح الإجمالي')
})

await t('تقرير الصندوق: صافي الحركات = مجموع CashMovement', { screen: 'التقارير → الصندوق', uiPath: 'التقارير → حركة الصندوق', expected: 'net = Σ(حركات) + تدفقات موقعة', testRef: 'batch-e' }, async () => {
  const r = await call('GET', '/api/reports/cash', { query: range })
  eq(r.status, 200, 'status')
  const agg = await db.cashMovement.aggregate({ where: { date: { gte: new Date(`${range.from}T00:00:00.000`), lte: new Date(`${range.to}T23:59:59.999`) } }, _sum: { amountMinor: true } })
  eq(r.json.netMinor, agg._sum.amountMinor ?? 0, 'الصافي')
})

await t('تقارير الديون والتحصيلات والمصروفات والمشتريات والموردين', { screen: 'التقارير', uiPath: 'خمس شاشات تقارير', expected: 'كل تقرير = تجميعه المباشر', testRef: 'batch-e' }, async () => {
  const debts = await call('GET', '/api/reports/debts')
  const amal = await customerDebtMinor(ids.c['متجر الأمل'])
  const amalRow = debts.json.items.find((x: any) => x.customerId === ids.c['متجر الأمل'])
  expect(amal > 0, 'للعميل دين')
  eq(amalRow.debtMinor, amal, 'دين العميل في التقرير')
  const coll = await call('GET', '/api/reports/collections', { query: range })
  const payAgg = await db.salePayment.aggregate({ where: { date: { gte: new Date(`${range.from}T00:00:00.000`), lte: new Date(`${range.to}T23:59:59.999`) } }, _sum: { amountMinor: true }, _count: true })
  eq(coll.json.totalMinor, payAgg._sum.amountMinor ?? 0, 'إجمالي التحصيلات')
  const exp = await call('GET', '/api/reports/expenses', { query: range })
  const expAgg = await db.expense.aggregate({ where: { status: 'COMPLETED', date: { gte: new Date(`${range.from}T00:00:00.000`), lte: new Date(`${range.to}T23:59:59.999`) } }, _sum: { amountMinor: true } })
  eq(exp.json.totalMinor, expAgg._sum.amountMinor ?? 0, 'إجمالي المصروفات')
  const pur = await call('GET', '/api/reports/purchases', { query: range })
  const purAgg = await db.purchase.aggregate({ where: { status: 'COMPLETED', date: { gte: new Date(`${range.from}T00:00:00.000`), lte: new Date(`${range.to}T23:59:59.999`) } }, _sum: { totalMinor: true } })
  eq(pur.json.totals.totalMinor, purAgg._sum.totalMinor ?? 0, 'إجمالي المشتريات')
  const sup = await call('GET', '/api/reports/suppliers')
  expect(Array.isArray(sup.json.items), 'قائمة الموردين')
})

await t('تقارير الإنتاج والتقييم والتوزيع + رفض تاريخ غير صالح', { screen: 'التقارير', uiPath: 'ثلاث شاشات + فلتر تاريخ خاطئ', expected: 'تقارير تعمل + 400 لتاريخ خاطئ', testRef: 'batch-e' }, async () => {
  const prod = await call('GET', '/api/reports/production', { query: range })
  eq(prod.status, 200, 'الإنتاج')
  const val = await call('GET', '/api/reports/inventory-valuation')
  eq(val.status, 200, 'التقييم')
  const invAgg = await db.stockMovement.groupBy({ by: ['productId'], _sum: { qtyMilli: true } })
  let totalValue = 0
  for (const g of invAgg) {
    const p = await db.product.findUnique({ where: { id: g.productId } })
    totalValue += Math.round(((g._sum.qtyMilli ?? 0) * (p?.costMinor ?? 0)) / 1000)
  }
  eq(val.json.totalValueMinor, totalValue, 'قيمة المخزون الإجمالية')
  const dist = await call('GET', '/api/reports/distribution', { query: range })
  eq(dist.status, 200, 'التوزيع')
  const bad = await call('GET', '/api/reports/sales', { query: { from: 'bad-date' } })
  eq(bad.status, 400, 'تاريخ غير صالح مرفوض')
})

/* ---------- التصدير ---------- */
await t('تصدير CSV: BOM + صفوف عربية + نوع غير معروف → 404', { screen: 'التصدير', uiPath: 'التقارير/الإعدادات → تصدير', expected: 'CSV بـ UTF-8 BOM لثلاث كيانات + 404', testRef: 'batch-e' }, async () => {
  for (const entity of ['products', 'sales', 'audit'] as const) {
    const r = await call('GET', `/api/export/${entity}`)
    eq(r.status, 200, entity)
    expect(r.text.charCodeAt(0) === 0xFEFF, `${entity}: BOM موجود`)
    expect(r.text.split('\n').length >= 2, `${entity}: رؤوس وصفوف`)
    expect(/[\u0600-\u06FF]/.test(r.text), `${entity}: رؤوس عربية`)
  }
  const unknown = await call('GET', '/api/export/secret_table')
  eq(unknown.status, 404, 'كيان غير معروف')
  const noAuth = await call('GET', '/api/export/products', { session: 'none' })
  eq(noAuth.status, 401, 'بلا جلسة')
})

/* ---------- النسخ الاحتياطي والاستعادة ---------- */
await t('تصدير نسخة: مستخدمون مغقّمون + جداول كاملة', { screen: 'الإعدادات → النسخ الاحتياطي', uiPath: 'تصدير نسخة احتياطية', expected: 'JSON بلا هاشات + جميع الجداول', testRef: 'batch-e' }, async () => {
  const r = await call('GET', '/api/backup/export')
  eq(r.status, 200, 'status')
  const data = JSON.parse(r.text)
  expect(data.tables, 'قسم الجداول موجود')
  const users = data.tables.users ?? []
  expect(users.length >= 2, 'مستخدمان على الأقل')
  expect(users.every((u: any) => !u.passwordHash && !u.passwordSalt), 'بلا هاشات (مغقّم)')
  for (const tname of ['sales', 'sale_items', 'stock_movements', 'products', 'customers']) {
    expect(Array.isArray(data.tables[tname]), `جدول ${tname} موجود`)
  }
  await Bun.write('/tmp/qa-bakery/export.json', r.text)
  // لقطة عدادات للتحقق في القاعدة المنفصلة
  const counts: Record<string, number> = {}
  for (const [table, model] of Object.entries({ sales: 'sale', saleItems: 'saleItem', purchases: 'purchase', stockMovements: 'stockMovement', ledger: 'customerLedgerEntry', products: 'product', users: 'user' } as const)) {
    counts[table] = await (db as any)[model].count()
  }
  counts.debtAmal = await customerDebtMinor(ids.c['متجر الأمل'])
  counts.flourStock = await stockOf(ids.p['دقيق'])
  await Bun.write('/tmp/qa-bakery/snapshot.json', JSON.stringify(counts))
})

await t('معاينة النسخة: تحذير مصادقة + needsOwnerPassword', { screen: 'الإعدادات → النسخ الاحتياطي', uiPath: 'استيراد نسخة → معاينة', expected: 'authReady=false + needsOwnerPassword=true', testRef: 'batch-e' }, async () => {
  const body = await Bun.file('/tmp/qa-bakery/export.json').text()
  const r = await call('POST', '/api/backup/preview', { body: { data: body } })
  eq(r.status, 200, 'status')
  eq(r.json.auth.authReady, false, 'غير جاهزة مصادقيًا (مغقّمة)')
  eq(r.json.auth.needsOwnerPassword, true, 'تتطلب كلمة مالك جديدة')
  const bad = await call('POST', '/api/backup/preview', { body: { data: 'not json' } })
  eq(bad.status, 400, 'JSON غير صالح')
  const noData = await call('POST', '/api/backup/preview', { body: {} })
  eq(noData.status, 400, 'بلا محتوى')
})

await t('بيانات تجريبية فوق بيانات فعلية → رفض', { screen: 'الإعدادات', uiPath: 'تحميل بيانات تجريبية بقاعدة فيها عمليات', expected: '409', testRef: 'batch-e' }, async () => {
  const r = await call('POST', '/api/backup/demo', { body: {} })
  eq(r.status, 409, 'status')
})

await t('استعادة كاملة في قاعدة منفصلة: العدادات والأرصدة والدخول', { screen: 'الإعدادات → النسخ الاحتياطي', uiPath: 'استعادة نسخة في قاعدة جديدة بكلمة مالك جديدة', expected: 'عملية فرعية على restore-target.db: عدادات متطابقة + دخول بالكلمة الجديدة + القاعدة الأصلية لم تتأثر', testRef: 'batch-e' }, async () => {
  // قاعدة مستهدفة معزولة جديدة (حذف بقايا تشغيل سابق)
  const { rm } = await import('fs/promises')
  await rm('/tmp/qa-bakery/restore-target.db', { force: true })
  await rm('/tmp/qa-bakery/restore-target.db-journal', { force: true })
  await Bun.spawn(['bunx', 'prisma', 'db', 'push', '--skip-generate'], { env: { ...process.env, DATABASE_URL: 'file:/tmp/qa-bakery/restore-target.db' }, stdout: 'pipe', stderr: 'pipe' }).exited
  const proc = Bun.spawn(['bun', 'scripts/qa/restore-child.ts'], {
    env: { ...process.env, DATABASE_URL: 'file:/tmp/qa-bakery/restore-target.db' },
    stdout: 'pipe', stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  const code = await proc.exited
  expect(code === 0, `العملية الفرعية فشلت (exit ${code})\n${out}\n${err}`)
  console.log(out.trim().split('\n').map(l => '     [child] ' + l).join('\n'))
  // القاعدة الأصلية لم تمس
  const me = await call('GET', '/api/auth/me')
  expect(me.json.user, 'جلسة الأصل سليمة')
  const loginOld = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(loginOld.status, 200, 'دخول 1234 في الأصل ما زال يعمل')
})

await finish('batch-e-reports')
process.exit(0)

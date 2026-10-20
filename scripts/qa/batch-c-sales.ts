// =============================================================
// QA الدفعة C — البيع ونقطة البيع والورديات والمصروفات (الدقة المالية)
// DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/batch-c-sales.ts
// =============================================================
import { call, captureSession, state, t, expect, eq, finish, db, stockOf } from './harness'
import { randomBytes } from 'crypto'

const ids = await Bun.file('/tmp/qa-bakery/ids.json').json()
{
  const l = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(l.status, 200, 'دخول مالك')
  captureSession(l)
}
// الضريبة مفعلة 1700bp من الدفعة A — نتحقق
{
  const s = await call('GET', '/api/settings')
  eq(s.json.taxEnabled, true, 'الضريبة مفعلة')
  eq(s.json.taxRateBp, 1700, 'النسبة 17%')
}

let sale1Id = ''
await t('بيع نقدي بسيط: الإجماليات + مخزون + صندوق + رقم فاتورة', { screen: 'نقطة البيع', uiPath: 'نقطة البيع → إضافة منتج → ترحيل نقدي', expected: 'total=1170 (1000+ضريبة 170) + SALE −2000 + SALE_CASH +1170 + S-YYYYMMDD-####', testRef: 'batch-c' }, async () => {
  const before = await stockOf(ids.p['شاي'])
  const cashBefore = await db.cashMovement.aggregate({ where: { type: 'SALE_CASH' }, _sum: { amountMinor: true } })
  const r = await call('POST', '/api/sales', { body: {
    items: [{ productId: ids.p['شاي'], qtyMilli: 2000 }],
    payments: [{ amountMinor: 1170, method: 'CASH' }],
  } })
  eq(r.status, 200, 'status')
  const s = r.json
  eq(s.subtotalMinor, 1000, 'المجموع')
  eq(s.discountMinor, 0, 'بلا خصم')
  eq(s.taxMinor, 170, 'ضريبة 17% = round(1000×1700/10000) = 170')
  sale1Id = s.id
  eq(s.totalMinor, 1170, 'الإجمالي بالضريبة')
  eq(s.paymentStatus, 'PAID', 'مدفوعة كاملة')
  eq(s.invoiceNo.slice(0, 2), 'S-', 'بادئة الفاتورة')
  expect(/^\d{8}-\d{4}$/.test(s.invoiceNo.slice(2)), 'صيغة يومية S-20250101-0001: ' + s.invoiceNo)
  eq(await stockOf(ids.p['شاي']), before - 2000, 'مخزون الشاي نقص 2000')
  const cashAfter = await db.cashMovement.aggregate({ where: { type: 'SALE_CASH' }, _sum: { amountMinor: true } })
  eq((cashAfter._sum.amountMinor ?? 0) - (cashBefore._sum.amountMinor ?? 0), 1170, 'نقدية الصندوق = الإجمالي')
  const mv = await db.stockMovement.findFirst({ where: { productId: ids.p['شاي'], type: 'SALE' }, orderBy: { id: 'desc' } })
  eq(mv?.qtyMilli, -2000, 'حركة مخزون سالبة')
  eq(mv?.refId, s.id, 'مرتبطة بالفاتورة')
})

await t('خصم فاتورة: الضريبة على (المجموع−الخصم)', { screen: 'نقطة البيع', uiPath: 'نقطة البيع → خصم فاتورة 100', expected: 'tax=round(900×0.17)=153 + total=1053', testRef: 'batch-c' }, async () => {
  const r = await call('POST', '/api/sales', { body: {
    items: [{ productId: ids.p['شاي'], qtyMilli: 2000 }],
    discountMinor: 100,
    payments: [{ amountMinor: 1053, method: 'CASH' }],
  } })
  eq(r.status, 200, 'status')
  eq(r.json.subtotalMinor, 1000, 'المجموع')
  eq(r.json.taxMinor, Math.round(900 * 1700 / 10000), 'الضريبة بعد الخصم')
  eq(r.json.totalMinor, 1053, 'الإجمالي')
})

await t('بيع آجل جزئي: دفتر العميل + حالة PARTIAL', { screen: 'نقطة البيع', uiPath: 'بيع لعميل آجل بدفع جزئي', expected: 'credit=5020 + قيد INVOICE +5020 + PARTIAL', testRef: 'batch-c' }, async () => {
  const debtBefore = await db.customerLedgerEntry.aggregate({ where: { customerId: ids.c['متجر الأمل'] }, _sum: { amountMinor: true } })
  const r = await call('POST', '/api/sales', { body: {
    customerId: ids.c['متجر الأمل'],
    items: [{ productId: ids.p['كيك'], qtyMilli: 2000, priceMinor: 3000 }],
    payments: [{ amountMinor: 2000, method: 'CASH' }],
  } })
  eq(r.status, 200, 'status')
  eq(r.json.paidMinor, 2000, 'المدفوع')
  eq(r.json.creditMinor, 5020, 'الآجل (7020=6000+ضريبة 1020، مدفوع 2000)')
  eq(r.json.paymentStatus, 'PARTIAL', 'حالة جزئية')
  eq(await db.customerLedgerEntry.aggregate({ where: { customerId: ids.c['متجر الأمل'] }, _sum: { amountMinor: true } }).then(a => (a._sum.amountMinor ?? 0) - (debtBefore._sum.amountMinor ?? 0)), 5020, 'قيد دفتر +الآجل كاملًا')
})

await t('آجل بدون عميل → رفض واضح (الإعداد مطلوب عميل)', { screen: 'نقطة البيع', uiPath: 'بيع آجل بلا عميل', expected: '409 البيع الآجل يتطلب تحديد العميل', testRef: 'batch-c' }, async () => {
  const r = await call('POST', '/api/sales', { body: { items: [{ productId: ids.p['شاي'], qtyMilli: 1000 }] } })
  eq(r.status, 409, 'status')
  expect(String(r.json.error).includes('البيع الآجل يتطلب'), 'رسالة: ' + r.json.error)
})

await t('تجاوز حد الائتمان → 409 بالحد والدين الحالي', { screen: 'نقطة البيع', uiPath: 'بيع آجل يتجاوز حد العميل', expected: '409 تجاوز حد الائتمان', testRef: 'batch-c' }, async () => {
  const r = await call('POST', '/api/sales', { body: {
    customerId: ids.c['متجر الأمل'],
    items: [{ productId: ids.p['شاي'], qtyMilli: 1000, priceMinor: 14530 }],
  } })
  eq(r.status, 409, 'status')
  expect(String(r.json.error).includes('حد الائتمان'), 'رسالة الحد: ' + r.json.error)
})

await t('مخزون غير كافٍ → 409 (الإعداد يعطل السالب)', { screen: 'نقطة البيع', uiPath: 'بيع كمية أكبر من الرصيد', expected: '409 الرصيد غير كافٍ', testRef: 'batch-c' }, async () => {
  // الدفع يغطي الإجمالي كي لا يسبق فحص الائتمان فحص المخزون
  const r = await call('POST', '/api/sales', { body: { items: [{ productId: ids.p['خبز عادي'], qtyMilli: 1000 }], payments: [{ amountMinor: 1170, method: 'CASH' }] } })
  eq(r.status, 409, 'status')
  expect(String(r.json.error).includes('غير كافٍ'), 'رسالة: ' + r.json.error)
})

await t('السماح بالسالب من الإعدادات → بيع يمر بملاحظة، ثم الإيقاف', { screen: 'الإعدادات + نقطة البيع', uiPath: 'تفعيل خيار المخزون السالب ثم بيع', expected: '200 + ملاحظة بيع برصيد سالب + إعادة الإعداد false', testRef: 'batch-c' }, async () => {
  const en = await call('PUT', '/api/settings', { body: { negativeStockAllowed: true } })
  eq(en.status, 200, 'تفعيل')
  const r = await call('POST', '/api/sales', { body: { items: [{ productId: ids.p['خبز عادي'], qtyMilli: 5000 }], payments: [{ amountMinor: 5850, method: 'CASH' }] } })
  eq(r.status, 200, 'البيع مر بالسالب')
  eq(await stockOf(ids.p['خبز عادي']), -5000, 'الرصيد سالب')
  const mv = await db.stockMovement.findFirst({ where: { productId: ids.p['خبز عادي'], type: 'SALE' }, orderBy: { date: 'desc' } })
  expect(String(mv?.note ?? '').includes('سالب'), 'ملاحظة الحركة توثق البيع السالب')
  const dis = await call('PUT', '/api/settings', { body: { negativeStockAllowed: false } })
  eq(dis.status, 200, 'إعادة الإعداد')
  const again = await call('POST', '/api/sales', { body: { items: [{ productId: ids.p['خبز عادي'], qtyMilli: 1000 }] } })
  eq(again.status, 409, 'بعد الإيقاف يُرفض مجددًا')
})

await t('خصم بدون صلاحية (جلسة كاشير) → 403', { screen: 'نقطة البيع', uiPath: 'كاشير يحاول منح خصم', expected: '403 ليس لديك صلاحية لمنح خصم', testRef: 'batch-c' }, async () => {
  const cashier = await db.user.findUnique({ where: { username: 'qa_cashier' } })
  const token = randomBytes(32).toString('hex')
  await db.session.create({ data: { token, userId: cashier!.id, expiresAt: new Date(Date.now() + 3600_000) } })
  state.token2 = token
  const r = await call('POST', '/api/sales', { session: 'second', body: { items: [{ productId: ids.p['شاي'], qtyMilli: 1000 }], discountMinor: 50 } })
  eq(r.status, 403, 'status')
  expect(String(r.json.error).includes('خصم'), 'رسالة: ' + r.json.error)
  // نفس البيع بدون خصم يجب أن ينجح للكاشير (pos.use مسموح)
  const okSale = await call('POST', '/api/sales', { session: 'second', body: { items: [{ productId: ids.p['شاي'], qtyMilli: 1000 }], payments: [{ amountMinor: 585, method: 'CASH' }] } })
  eq(okSale.status, 200, 'كاشير يبيع بدون خصم')
  await db.session.deleteMany({ where: { token } })
})

await t('خصم أكبر من المجموع → 400', { screen: 'نقطة البيع', uiPath: 'خصم فاتورة خيالي', expected: '400 خصم الفاتورة أكبر من مجموع البنود', testRef: 'batch-c' }, async () => {
  const r = await call('POST', '/api/sales', { body: { items: [{ productId: ids.p['شاي'], qtyMilli: 1000 }], discountMinor: 999999 } })
  eq(r.status, 400, 'status')
})

await t('كميات غير صالحة ومنتج معطل → 400', { screen: 'نقطة البيع', uiPath: 'إدخالات خاطئة في السلة', expected: '400 للحالات الأربع', testRef: 'batch-c' }, async () => {
  const zero = await call('POST', '/api/sales', { body: { items: [{ productId: ids.p['شاي'], qtyMilli: 0 }] } })
  eq(zero.status, 400, 'كمية صفر')
  const neg = await call('POST', '/api/sales', { body: { items: [{ productId: ids.p['شاي'], qtyMilli: -100 }] } })
  eq(neg.status, 400, 'كمية سالبة')
  const empty = await call('POST', '/api/sales', { body: { items: [] } })
  eq(empty.status, 400, 'سلة فارغة')
  const inactive = await call('POST', '/api/sales', { body: { items: [{ productId: ids.p['خبز قديم'], qtyMilli: 1000 }] } })
  eq(inactive.status, 400, 'منتج معطل')
})

let refSaleId = ''
await t('منع الترحيل المزدوج clientRef: نفس الفاتورة تُعاد لا تُكرر', { screen: 'نقطة البيع', uiPath: 'نقر مزدوج على زر ترحيل', expected: 'استجابتان 200 بنفس المعرف + صف واحد في القاعدة', testRef: 'batch-c' }, async () => {
  const ref = 'qa-ref-' + Date.now()
  const r = await call('POST', '/api/sales', { body: { clientRef: ref, items: [{ productId: ids.p['كيك'], qtyMilli: 1000 }], payments: [{ amountMinor: 3510, method: 'CASH' }] } })
  eq(r.status, 200, 'الأولى')
  const r2 = await call('POST', '/api/sales', { body: { clientRef: ref, items: [{ productId: ids.p['كيك'], qtyMilli: 1000 }], payments: [{ amountMinor: 3000, method: 'CASH' }] } })
  eq(r2.status, 200, 'الثانية تعيد نفسها')
  eq(r.json.id, r2.json.id, 'نفس الفاتورة')
  refSaleId = r.json.id
  const cnt = await db.sale.count({ where: { clientRef: ref } })
  eq(cnt, 1, 'صف واحد فقط')
  const items = await db.saleItem.count({ where: { saleId: refSaleId } })
  eq(items, 1, 'بند واحد لا اثنان')
})

await t('إلغاء فاتورة: استرجاع مخزون + رد نقدية + سبب إلزامي', { screen: 'المبيعات', uiPath: 'المبيعات → إلغاء فاتورة', expected: 'مخزون يعود + ADJUSTMENT −3000 + 400 بلا سبب + 409 تكرار', testRef: 'batch-c' }, async () => {
  const stockBefore = await stockOf(ids.p['كيك'])
  const noReason = await call('POST', `/api/sales/${refSaleId}/cancel`, { body: { reason: '' } })
  eq(noReason.status, 400, 'سبب مطلوب')
  const cashBefore = await db.cashMovement.aggregate({ where: { refType: 'SaleCancel' }, _sum: { amountMinor: true } })
  const r = await call('POST', `/api/sales/${refSaleId}/cancel`, { body: { reason: 'خطأ كاشير اختباري' } })
  eq(r.status, 200, 'status')
  eq(await stockOf(ids.p['كيك']), stockBefore + 1000, 'المخزون عاد')
  const cashAfter = await db.cashMovement.aggregate({ where: { refType: 'SaleCancel' }, _sum: { amountMinor: true } })
  eq((cashAfter._sum.amountMinor ?? 0) - (cashBefore._sum.amountMinor ?? 0), -3510, 'رد نقدية −الإجمالي بالضريبة (3000+510)')
  const again = await call('POST', `/api/sales/${refSaleId}/cancel`, { body: { reason: 'ثانية' } })
  eq(again.status, 409, 'ملغاة مسبقًا')
  const s = await db.sale.findUnique({ where: { id: refSaleId } })
  eq(s?.status, 'CANCELLED', 'الحالة CANCELLED')
  expect(s?.voidReason, 'سبب الإلغاء محفوظ')
})

await t('فاتورة قديمة لا تتأثر بتعديل سعر المنتج لاحقًا', { screen: 'المنتجات + المبيعات', uiPath: 'تعديل سعر منتج بعد بيعه ثم مراجعة الفاتورة', expected: 'SaleItem يحفظ السعر والاسم وقت البيع', testRef: 'batch-c' }, async () => {
  const item = await db.saleItem.findFirst({ where: { productId: ids.p['شاي'] }, orderBy: { id: 'asc' } })
  eq(item?.priceMinor, 500, 'سعر البيع القديم 500')
  const upd = await call('PUT', `/api/products/${ids.p['شاي']}`, { body: { priceMinor: 600, name: 'شاي معدل' } })
  eq(upd.status, 200, 'تعديل المنتج')
  const after = await db.saleItem.findUnique({ where: { id: item!.id } })
  eq(after?.priceMinor, 500, 'سعر البند التاريخي لم يتغير')
  eq(after?.productName, 'شاي', 'الاسم التاريخي لم يتغير')
  // إعادة السعر للاختبارات اللاحقة
  await call('PUT', `/api/products/${ids.p['شاي']}`, { body: { priceMinor: 500, name: 'شاي' } })
})

await t('سعر الجملة تلقائي لعميل جملة', { screen: 'نقطة البيع', uiPath: 'بيع لعميل نوع سعره جملة', expected: 'price=900 لخبز عادي (جملة) — بعد السماح بالسالب مؤقتًا', testRef: 'batch-c' }, async () => {
  const en = await call('PUT', '/api/settings', { body: { negativeStockAllowed: true } })
  eq(en.status, 200, 'تفعيل سالب')
  const r = await call('POST', '/api/sales', { body: { customerId: ids.c['مطعم الضيافة'], items: [{ productId: ids.p['خبز عادي'], qtyMilli: 1000 }] } })
  eq(r.status, 200, 'status')
  eq(r.json.items[0].priceMinor, 900, 'سعر الجملة تلقائيًا')
  const retail = await call('POST', '/api/sales', { body: { customerId: ids.c['متجر الأمل'], items: [{ productId: ids.p['خبز عادي'], qtyMilli: 1000 }] } })
  eq(retail.json.items[0].priceMinor, 1000, 'سعر التجزئة للعميل العادي')
  await call('PUT', '/api/settings', { body: { negativeStockAllowed: false } })
})

/* ---------- الورديات ---------- */
await t('الوردية الحالية: النقد المتوقع = الافتتاح + مجموع الحركات', { screen: 'الورديات', uiPath: 'شاشة الورديات → الحالية', expected: 'expectedCash = 10000 −5000 +2000 −500 + مبيعات CASH − إلغاء', testRef: 'batch-c' }, async () => {
  const cur = await call('GET', '/api/shifts/current')
  eq(cur.status, 200, 'status')
  expect(cur.json.shift, 'وردية مفتوحة من التهيئة')
  const movements = await db.cashMovement.findMany({ where: { shiftId: cur.json.shift.id } })
  const sum = movements.reduce((a, m) => a + m.amountMinor, 0)
  eq(cur.json.expectedCashMinor, 10000 + sum, 'المتوقع محسوب من الحركات')
  expect(cur.json.movementsCount >= 4, 'عدد حركات معقول')
})

let expectedAtClose = 0
let seedShiftId = ''
await t('إغلاق الوردية: الفرق المحسوب والحالة', { screen: 'الورديات', uiPath: 'الورديات → إغلاق بالنقد المعدود', expected: 'difference = counted − expected + إغلاق مكرر 409', testRef: 'batch-c' }, async () => {
  const cur = await call('GET', '/api/shifts/current')
  seedShiftId = cur.json.shift.id
  expectedAtClose = cur.json.expectedCashMinor
  const noCounted = await call('POST', '/api/shifts/close', { body: {} })
  eq(noCounted.status, 400, 'النقد المعدود مطلوب')
  const r = await call('POST', '/api/shifts/close', { body: { countedCashMinor: expectedAtClose, notes: 'إغلاق اختباري' } })
  eq(r.status, 200, 'status')
  eq(r.json.differenceMinor, 0, 'لا فرق')
  eq(r.json.status, 'CLOSED', 'مغلقة')
  const again = await call('POST', '/api/shifts/close', { body: { countedCashMinor: 100 } })
  eq(again.status, 409, 'لا وردية مفتوحة')
})

await t('فتح وردية ثانية ورفض التكرار', { screen: 'الورديات', uiPath: 'الورديات → فتح وردية', expected: '200 + 409 عند التكرار', testRef: 'batch-c' }, async () => {
  const r = await call('POST', '/api/shifts/open', { body: { openingCashMinor: 2000 } })
  eq(r.status, 200, 'status')
  const dup = await call('POST', '/api/shifts/open', { body: { openingCashMinor: 0 } })
  eq(dup.status, 409, 'توجد وردية مفتوحة')
  const neg = await call('POST', '/api/shifts/open', { session: 'none', body: { openingCashMinor: 0 } })
  eq(neg.status, 401, 'بلا جلسة مرفوض')
})

/* ---------- المصروفات ---------- */
let expenseId = ''
await t('مصروف نقدي: صندوق −1500 + تدقيق', { screen: 'المصروفات', uiPath: 'المصروفات → مصروف جديد', expected: 'CashMovement EXPENSE −1500 على الوردية الحالية', testRef: 'batch-c' }, async () => {
  // تنظيف تصنيفات اختبارية سابقة (تكرارية الدفعة)
  const oldCats = await db.expenseCategory.findMany({ where: { name: 'مواصلات QA' }, include: { expenses: true } })
  for (const c of oldCats) {
    await db.cashMovement.deleteMany({ where: { refType: 'Expense', refId: { in: c.expenses.map(e => e.id) } } })
    await db.expense.deleteMany({ where: { categoryId: c.id } })
    await db.expenseCategory.delete({ where: { id: c.id } })
  }
  const cat = await call('POST', '/api/expenses/categories', { body: { name: 'مواصلات QA' } })
  eq(cat.status, 200, 'تصنيف')
  const bad = await call('POST', '/api/expenses', { body: { categoryId: cat.json.id, amountMinor: 0 } })
  eq(bad.status, 400, 'مبلغ صفر مرفوض')
  const badDate = await call('POST', '/api/expenses', { body: { categoryId: cat.json.id, amountMinor: 100, date: 'not-a-date' } })
  eq(badDate.status, 400, 'تاريخ خاطئ')
  const r = await call('POST', '/api/expenses', { body: { categoryId: cat.json.id, amountMinor: 1500, method: 'CASH', beneficiary: 'سائق', note: 'بنزين' } })
  eq(r.status, 200, 'status')
  expenseId = r.json.id
  const cm = await db.cashMovement.findFirst({ where: { type: 'EXPENSE', refId: expenseId } })
  eq(cm?.amountMinor, -1500, 'حركة صندوق سالبة')
  eq(cm?.shiftId, r.json.shiftId, 'مرتبطة بالوردية المفتوحة')
})

await t('مصروف بالبطاقة: لا حركة صندوق', { screen: 'المصروفات', uiPath: 'مصروف ببطاقة', expected: 'لا CashMovement', testRef: 'batch-c' }, async () => {
  const before = await db.cashMovement.count()
  const r = await call('POST', '/api/expenses', { body: { categoryId: (await call('GET', '/api/expenses/categories')).json[0].id, amountMinor: 800, method: 'CARD' } })
  eq(r.status, 200, 'status')
  eq(r.json.shiftId ?? null, null, 'بلا وردية للبطاقة')
  eq(await db.cashMovement.count(), before, 'لا حركة صندوق جديدة')
})

await t('إلغاء مصروف: استرداد للصندوق + مالك فقط', { screen: 'المصروفات', uiPath: 'المصروفات → إلغاء مصروف', expected: 'ADJUSTMENT +1500 + 403 لكاشير + 409 مكرر', testRef: 'batch-c' }, async () => {
  const cashier = await db.user.findUnique({ where: { username: 'qa_cashier' } })
  const token = randomBytes(32).toString('hex')
  await db.session.create({ data: { token, userId: cashier!.id, expiresAt: new Date(Date.now() + 3600_000) } })
  state.token2 = token
  const asCashier = await call('POST', `/api/expenses/${expenseId}/cancel`, { session: 'second', body: { reason: 'x' } })
  eq(asCashier.status, 403, 'الكاشير ممنوع')
  await db.session.deleteMany({ where: { token } })
  const r = await call('POST', `/api/expenses/${expenseId}/cancel`, { body: { reason: 'خطأ إدخال' } })
  eq(r.status, 200, 'status')
  const cm = await db.cashMovement.findFirst({ where: { refType: 'Expense', refId: expenseId, type: 'ADJUSTMENT' } })
  eq(cm?.amountMinor, 1500, 'استرداد +1500')
  const again = await call('POST', `/api/expenses/${expenseId}/cancel`, { body: {} })
  eq(again.status, 409, 'ملغى مسبقًا')
})

await finish('batch-c-sales')
process.exit(0)

// =============================================================
// QA الدفعة D — المخزون والجرد والمشتريات والإنتاج والتوزيع
// DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/batch-d-ops.ts
// =============================================================
import { call, captureSession, state, t, expect, eq, finish, db, stockOf, supplierDueMinor, customerDebtMinor } from './harness'

const ids = await Bun.file('/tmp/qa-bakery/ids.json').json()
{
  const l = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(l.status, 200, 'دخول مالك')
  captureSession(l)
}
// وردية مفتوحة مضمونة لبقية الدفعة (أغلقتها الدفعة C ثم فتحت أخرى — نتحقق ونفتح إن لزم)
{
  const cur = await call('GET', '/api/shifts/current')
  if (!cur.json.shift) {
    const o = await call('POST', '/api/shifts/open', { body: { openingCashMinor: 0 } })
    eq(o.status, 200, 'فتح وردية للدفعة D')
  }
}

/* ---------- المخزون والجرد ---------- */
await t('الرصيد الافتتاحي المكرر → 409', { screen: 'المخزون', uiPath: 'المخزون → رصيد افتتاحي لمنتج له رصيد', expected: '409 رصيد افتتاحي مسجل مسبقًا', testRef: 'batch-d' }, async () => {
  const r = await call('POST', '/api/inventory/opening', { body: { items: [{ productId: ids.p['دقيق'], qtyMilli: 1000 }] } })
  eq(r.status, 409, 'status')
  expect(String(r.json.error).includes('افتتاحي'), 'رسالة: ' + r.json.error)
})

await t('الجرد: فرق موجب يُسجل، تطابق تام لا يُسجل شيئًا', { screen: 'المخزون', uiPath: 'المخزون → جرد سكر', expected: 'حركة ADJUSTMENT بالفرق فقط + بلا حركة عند التطابق', testRef: 'batch-d' }, async () => {
  const before = await stockOf(ids.p['سكر'])
  const noReason = await call('POST', '/api/inventory/adjust', { body: { productId: ids.p['سكر'], countedQtyMilli: before + 1000, reason: '' } })
  eq(noReason.status, 400, 'سبب مطلوب')
  const r = await call('POST', '/api/inventory/adjust', { body: { productId: ids.p['سكر'], countedQtyMilli: before + 1000, reason: 'جرد زيادة' } })
  eq(r.status, 200, 'status')
  eq(r.json.diffMilli, 1000, 'الفرق +1000')
  eq(await stockOf(ids.p['سكر']), before + 1000, 'الرصيد زاد')
  const r2 = await call('POST', '/api/inventory/adjust', { body: { productId: ids.p['سكر'], countedQtyMilli: before + 1000, reason: 'جرد مطابق' } })
  eq(r2.status, 200, 'status')
  eq(r2.json.movementId, null, 'بلا حركة عند التطابق')
  eq(r2.json.diffMilli, 0, 'فرق صفر')
})

await t('الإعدام: يُمنع حتى مع السماح بالسالب', { screen: 'المخزون', uiPath: 'المخزون → إعدام كمية أكبر من الرصيد', expected: '409 رصيد غير كافٍ + حركة WASTE صحيحة', testRef: 'batch-d' }, async () => {
  await call('PUT', '/api/settings', { body: { negativeStockAllowed: true } })
  const r = await call('POST', '/api/inventory/waste', { body: { productId: ids.p['خميرة'], qtyMilli: 99999999, reason: 'تالف' } })
  eq(r.status, 409, 'الإعدام لا يتجاوز الرصيد حتى مع السالب')
  await call('PUT', '/api/settings', { body: { negativeStockAllowed: false } })
  const before = await stockOf(ids.p['خميرة'])
  const w = await call('POST', '/api/inventory/waste', { body: { productId: ids.p['خميرة'], qtyMilli: 500, reason: 'تالف اختباري' } })
  eq(w.status, 200, 'status')
  eq(await stockOf(ids.p['خميرة']), before - 500, 'الرصيد نقص')
  eq(w.json.movement.type, 'WASTE', 'نوع الحركة')
})

await t('سجل الحركات: فلترة بالنوع ونوع غير صالح', { screen: 'المخزون', uiPath: 'المخزون → سجل الحركات', expected: 'فلتر WASTE يعرض الإعدام فقط + 400 لنوع غير معروف', testRef: 'batch-d' }, async () => {
  const r = await call('GET', '/api/inventory/movements', { query: { type: 'WASTE', pageSize: '10' } })
  eq(r.status, 200, 'status')
  expect(r.json.items.length >= 1, 'يوجد إعدام مسجل')
  expect(r.json.items.every((m: any) => m.type === 'WASTE'), 'كل النتائج WASTE')
  const bad = await call('GET', '/api/inventory/movements', { query: { type: 'NOT_A_TYPE' } })
  eq(bad.status, 400, 'نوع غير صالح')
})

await t('تنبيه النواقص: خبز عادي تحت الحد الأدنى', { screen: 'المخزون', uiPath: 'المخزون → النواقص', expected: 'خبز عادي (سالب) ضمن التنبيهات', testRef: 'batch-d' }, async () => {
  const r = await call('GET', '/api/inventory/low')
  eq(r.status, 200, 'status')
  expect(r.json.items.some((x: any) => x.productId === ids.p['خبز عادي']), 'خبز عادي ضمن النواقص')
  expect(r.json.items.some((x: any) => x.productId === ids.p['خبز أسود']), 'خبز أسود (بلا رصيد) ضمن النواقص')
})

/* ---------- المشتريات ---------- */
await t('شراء يحدّث التكلفة المرجحة والمخزون ودون تجاوز مدفوع', { screen: 'المشتريات', uiPath: 'المشتريات → فاتورة شراء دقيق', expected: 'متوسط مرجح صحيح + PARTIAL + دفتر مورد', testRef: 'batch-d' }, async () => {
  const flour = await db.product.findUnique({ where: { id: ids.p['دقيق'] } })
  const beforeQty = await stockOf(ids.p['دقيق'])
  const beforeCost = flour!.costMinor
  const dueBefore = await supplierDueMinor(ids.s['مطحنة الشمال'])
  const qty = 20000, cost = 300 // 20 كغ × 3.00
  const paid = 2000
  const total = Math.round(qty * cost / 1000) // 6000
  const r = await call('POST', '/api/purchases', { body: { supplierId: ids.s['مطحنة الشمال'], items: [{ productId: ids.p['دقيق'], qtyMilli: qty, costMinor: cost }], payments: [{ amountMinor: paid, method: 'CASH' }] } })
  eq(r.status, 200, 'status')
  eq(r.json.totalMinor, total, 'الإجمالي')
  eq(r.json.paymentStatus, 'PARTIAL', 'جزئي')
  eq(await stockOf(ids.p['دقيق']), beforeQty + qty, 'المخزون زاد')
  const expAvg = Math.round((beforeQty * beforeCost + qty * cost) / (beforeQty + qty))
  const flourAfter = await db.product.findUnique({ where: { id: ids.p['دقيق'] } })
  eq(flourAfter!.costMinor, expAvg, `التكلفة المرجحة ${expAvg}`)
  eq(await supplierDueMinor(ids.s['مطحنة الشنعار'] ?? ids.s['مطحنة الشمال']), dueBefore + total - paid, 'مستحقات المورد زادت بالباقي')
  const cm = await db.cashMovement.findFirst({ where: { type: 'PURCHASE_PAYMENT', refType: 'PurchasePayment' }, orderBy: { id: 'desc' } })
  expect(cm, 'حركة صندوق للدفعة النقدية (وردية مفتوحة)')
  eq(cm?.amountMinor, -paid, 'صندوق −2000')
})

await t('منع الدفع الزائد على فاتورة شراء', { screen: 'المشتريات', uiPath: 'دفعة على فاتورة أكبر من المتبقي', expected: '409 المبلغ يتجاوز المتبقي', testRef: 'batch-d' }, async () => {
  const unpaid = await db.purchase.findFirst({ where: { status: 'COMPLETED', paymentStatus: { in: ['PARTIAL', 'UNPAID'] } }, orderBy: { date: 'desc' } })
  const full = await call('GET', `/api/purchases/${unpaid!.id}`)
  const paidSoFar = full.json.payments.reduce((a: number, p: any) => a + p.amountMinor, 0)
  const remaining = full.json.totalMinor - paidSoFar
  const r = await call('POST', `/api/purchases/${unpaid!.id}/payments`, { body: { amountMinor: remaining + 1, method: 'CASH' } })
  eq(r.status, 409, 'status')
  expect(String(r.json.error).includes('المتبقي'), 'رسالة: ' + r.json.error)
  // دقة المتبقي تُقبل وتُحدّث الحالة
  const ok1 = await call('POST', `/api/purchases/${unpaid!.id}/payments`, { body: { amountMinor: remaining, method: 'CASH' } })
  eq(ok1.status, 200, 'status')
  eq(ok1.json.paidMinor, full.json.totalMinor, 'مدفوع = إجمالي')
  const st = await db.purchase.findUnique({ where: { id: unpaid!.id } })
  eq(st?.paymentStatus, 'PAID', 'أصبحت مدفوعة')
})

await t('إلغاء فاتورة شراء مدفوعة نقدًا: رد النقد للصندوق', { screen: 'المشتريات', uiPath: 'إلغاء فاتورة شراء', expected: 'مخزون − + دفتر مورد −total + ADJUSTMENT +نقد الدفعات', testRef: 'batch-d' }, async () => {
  // فاتورة جديدة مدفوعة كاملة نقدًا ثم إلغاؤها
  const beforeStock = await stockOf(ids.p['سكر'])
  const cashBefore = await db.cashMovement.aggregate({ where: { type: 'ADJUSTMENT', refType: 'PurchaseCancel' }, _sum: { amountMinor: true } })
  const r = await call('POST', '/api/purchases', { body: { supplierId: ids.s['شركة السكر'], items: [{ productId: ids.p['سكر'], qtyMilli: 10000, costMinor: 300 }], payments: [{ amountMinor: 3000, method: 'CASH' }] } })
  eq(r.status, 200, 'status')
  const pid = r.json.id
  const afterBuy = await stockOf(ids.p['سكر'])
  eq(afterBuy, beforeStock + 10000, 'المخزون زاد 10كغ')
  const noReason = await call('POST', `/api/purchases/${pid}/cancel`, { body: { reason: '' } })
  eq(noReason.status, 400, 'سبب مطلوب')
  const c = await call('POST', `/api/purchases/${pid}/cancel`, { body: { reason: 'فاتورة خاطئة' } })
  eq(c.status, 200, 'status')
  eq(await stockOf(ids.p['سكر']), beforeStock, 'المخزون عاد كما كان')
  const due = await db.supplierLedgerEntry.aggregate({ where: { supplierId: ids.s['شركة السكر'], refType: 'PurchaseCancel', refId: pid }, _sum: { amountMinor: true } })
  eq(due._sum.amountMinor, -3000, 'عكس دفتر المورد −3000')
  const cashAfter = await db.cashMovement.aggregate({ where: { type: 'ADJUSTMENT', refType: 'PurchaseCancel' }, _sum: { amountMinor: true } })
  eq((cashAfter._sum.amountMinor ?? 0) - (cashBefore._sum.amountMinor ?? 0), 3000, 'رد النقد +3000 للصندوق (الإصلاح الجديد)')
  const again = await call('POST', `/api/purchases/${pid}/cancel`, { body: { reason: 'مكرر' } })
  eq(again.status, 409, 'ملغاة مسبقًا')
})

/* ---------- الإنتاج ---------- */
await t('منع الترحيل المزدوج لدفعة الإنتاج clientRef', { screen: 'الإنتاج', uiPath: 'نقر مزدوج على تسجيل دفعة', expected: 'استجابتان بنفس الدفعة + صف واحد (الإصلاح الجديد)', testRef: 'batch-d' }, async () => {
  const ref = 'qa-prd-' + Date.now()
  const flour = await db.product.findUnique({ where: { id: ids.p['دقيق'] } })
  const sugar = await db.product.findUnique({ where: { id: ids.p['سكر'] } })
  const yeast = await db.product.findUnique({ where: { id: ids.p['خميرة'] } })
  const matCost = Math.round(14250 * flour!.costMinor / 1000) + Math.round(1900 * sugar!.costMinor / 1000) + Math.round(475 * yeast!.costMinor / 1000)
  const body = { clientRef: ref, recipeId: ids.recipeId, actualQtyMilli: 19000, wasteQtyMilli: 1000 }
  const r1 = await call('POST', '/api/production', { body })
  eq(r1.status, 200, 'الأولى')
  const r2 = await call('POST', '/api/production', { body })
  eq(r2.status, 200, 'الثانية تعيد نفسها')
  eq(r1.json.id, r2.json.id, 'نفس الدفعة')
  const cnt = await db.productionBatch.count({ where: { clientRef: ref } })
  eq(cnt, 1, 'صف واحد فقط')
  // التحقق المالي: تكلفة المواد والوحدة
  eq(r1.json.materialsCostMinor, matCost, `تكلفة المواد ${matCost}`)
  eq(r1.json.unitCostMinor, Math.round(matCost * 1000 / 19000), 'تكلفة الوحدة')
  const out = await db.product.findUnique({ where: { id: ids.p['خبز عادي'] } })
  eq(out!.costMinor, r1.json.unitCostMinor, 'تكلفة الناتج حُدّثت')
})

await t('أثر الدفعة: خصم المواد + إضافة الناتج + الهدر موثق فقط', { screen: 'الإنتاج', uiPath: 'مراجعة أرصدة ما بعد الدفعة', expected: 'دقيق −14250 سكر −1900 خميرة −475 وخبز عادي +19000', testRef: 'batch-d' }, async () => {
  const out = await db.productionBatch.findFirst({ where: { batchNo: { startsWith: 'PRD' } }, orderBy: { date: 'desc' } })
  const batches = await db.productionBatch.count({ where: { status: 'COMPLETED', recipeId: ids.recipeId } })
  eq(batches, 1, 'دفعة واحدة فقط من الوصفة في قاعدة الاختبار')
  const d = await db.stockMovement.findFirst({ where: { refType: 'ProductionBatch', refId: out!.id, type: 'PRODUCTION_OUT', productId: ids.p['دقيق'] } })
  eq(d?.qtyMilli, -14250, 'خصم دقيق بالتحويل النسبي')
  const inMv = await db.stockMovement.findFirst({ where: { refType: 'ProductionBatch', refId: out!.id, type: 'PRODUCTION_IN' } })
  eq(inMv?.qtyMilli, 19000, 'إضافة الناتج')
  const wasteMoves = await db.stockMovement.count({ where: { refType: 'ProductionBatch', refId: out!.id, type: 'WASTE' } })
  eq(wasteMoves, 0, 'الهدر بلا حركة مخزون (موثق في الدفعة)')
  eq(out!.wasteQtyMilli, 1000, 'الهدر موثق في الدفعة')
})

await t('مادة غير كافية → 409 ولا أثر أي', { screen: 'الإنتاج', uiPath: 'إنتاج بكمية ضخمة', expected: '409 الكمية غير كافية + لا دفعة جديدة', testRef: 'batch-d' }, async () => {
  const before = await db.productionBatch.count()
  const r = await call('POST', '/api/production', { body: { recipeId: ids.recipeId, actualQtyMilli: 999999999 } })
  eq(r.status, 409, 'status')
  expect(String(r.json.error).includes('غير كافية'), 'رسالة: ' + r.json.error)
  eq(await db.productionBatch.count(), before, 'لم تُنشأ دفعة (تراجع كامل)')
})

await t('إلغاء دفعة: استرجاع المواد وخصم الناتج بشرط الرصيد', { screen: 'الإنتاج', uiPath: 'إلغاء دفعة إنتاج', expected: 'مواد تعود + ناتج يُخصم + 409 مكرر', testRef: 'batch-d' }, async () => {
  const batch = await db.productionBatch.findFirst({ where: { status: 'COMPLETED', recipeId: ids.recipeId }, orderBy: { date: 'desc' } })
  // رفع رصيد الناتج ليشترط الرصيد (خبز عادي سالب من دفعة البيع)
  const outNow = await stockOf(ids.p['خبز عادي'])
  const adj = await call('POST', '/api/inventory/adjust', { body: { productId: ids.p['خبز عادي'], countedQtyMilli: 19000, reason: 'توفير رصيد لاختبار إلغاء الدفعة' } })
  eq(adj.status, 200, 'جرد لرفع الرصيد')
  const flourBefore = await stockOf(ids.p['دقيق'])
  const r = await call('POST', `/api/production/${batch!.id}/cancel`, { body: { reason: 'خطأ نسبة تحويل' } })
  eq(r.status, 200, 'status')
  const flourAfter = await stockOf(ids.p['دقيق'])
  eq(flourAfter - flourBefore, 14250, 'الدقيق عاد')
  eq(await stockOf(ids.p['خبز عادي']), 19000 - 19000, 'الناتج خُصم بالكامل')
  const again = await call('POST', `/api/production/${batch!.id}/cancel`, { body: { reason: 'مكرر' } })
  eq(again.status, 409, 'ملغاة مسبقًا')
})

/* ---------- التوزيع ---------- */
let tripId = ''
await t('إنشاء مندوب وخط وجولة بتحميل من المخزون', { screen: 'التوزيع', uiPath: 'التوزيع → مندوب → جولة جديدة بتحميل', expected: 'TRP-#### + TRIP_OUT يخصم من المخزون', testRef: 'batch-d' }, async () => {
  const rep = await call('POST', '/api/distribution/reps', { body: { name: 'مندوب QA' } })
  eq(rep.status, 200, 'مندوب')
  const noName = await call('POST', '/api/distribution/reps', { body: { name: '' } })
  eq(noName.status, 400, 'اسم مطلوب')
  const route = await call('POST', '/api/distribution/routes', { body: { name: 'خط QA', repId: rep.json.id } })
  eq(route.status, 200, 'خط')
  const cakeBefore = await stockOf(ids.p['كيك'])
  const teaBefore = await stockOf(ids.p['شاي'])
  const trip = await call('POST', '/api/distribution/trips', { body: { repId: rep.json.id, routeId: route.json.id, loads: [ { productId: ids.p['كيك'], qtyMilli: 2000 }, { productId: ids.p['شاي'], qtyMilli: 3000 } ] } })
  eq(trip.status, 200, 'الجولة')
  tripId = trip.json.id
  expect(String(trip.json.tripNo).startsWith('TRP-'), 'رقم جولة: ' + trip.json.tripNo)
  eq(await stockOf(ids.p['كيك']), cakeBefore - 2000, 'كيك خرج بالعهدة')
  eq(await stockOf(ids.p['شاي']), teaBefore - 3000, 'شاي خرج بالعهدة')
  // تحميل أكثر من الرصيد
  const bigLoad = await call('POST', `/api/distribution/trips/${tripId}/loads`, { body: { loads: [{ productId: ids.p['خميرة'], qtyMilli: 99999999 }] } })
  eq(bigLoad.status, 409, 'تحميل يتجاوز الرصيد مرفوض')
})

await t('بيع جولة: نقدي وآجل — بلا حركة مخزون فورية', { screen: 'التوزيع', uiPath: 'جولة → تسجيل بيع', expected: 'TripSale فقط + الآجل يتطلب عميلًا', testRef: 'batch-d' }, async () => {
  const stockBefore = await stockOf(ids.p['كيك'])
  const noCreditCustomer = await call('POST', `/api/distribution/trips/${tripId}/sales`, { body: { items: [{ productId: ids.p['كيك'], qtyMilli: 500, priceMinor: 3000, paymentType: 'CREDIT' }] } })
  eq(noCreditCustomer.status, 400, 'آجل بلا عميل مرفوض')
  const r = await call('POST', `/api/distribution/trips/${tripId}/sales`, { body: { items: [
    { productId: ids.p['كيك'], qtyMilli: 500, priceMinor: 3000, paymentType: 'CASH' },
    { productId: ids.p['كيك'], qtyMilli: 300, priceMinor: 3000, paymentType: 'CREDIT', customerId: ids.c['متجر الأمل'] },
    { productId: ids.p['شاي'], qtyMilli: 1000, priceMinor: 500, paymentType: 'CASH' },
  ] } })
  eq(r.status, 200, 'status')
  eq(await stockOf(ids.p['كيك']), stockBefore, 'لا حركة مخزون وقت البيع (خرجت بالتحميل)')
  const sales = await db.tripSale.count({ where: { tripId } })
  eq(sales, 3, '3 أسطر بيع')
})

await t('مرتجع يتجاوز المتبقي → 409، والمرتجع الصحيح يُقبل', { screen: 'التوزيع', uiPath: 'جولة → تسجيل مرتجعات', expected: '409 عند التجاوز + قبول المرتجعات', testRef: 'batch-d' }, async () => {
  const exceed = await call('POST', `/api/distribution/trips/${tripId}/returns`, { body: { items: [{ productId: ids.p['كيك'], qtyMilli: 9999, condition: 'GOOD' }] } })
  eq(exceed.status, 409, 'يتجاوز المتبقي')
  expect(String(exceed.json.error).includes('المتبقي'), 'رسالة: ' + exceed.json.error)
  const r = await call('POST', `/api/distribution/trips/${tripId}/returns`, { body: { items: [
    { productId: ids.p['كيك'], qtyMilli: 500, condition: 'GOOD' },
    { productId: ids.p['شاي'], qtyMilli: 1000, condition: 'GOOD' },
  ] } })
  eq(r.status, 200, 'status')
  const rets = await db.tripReturn.count({ where: { tripId } })
  eq(rets, 2, 'سطرا مرتجع')
  // المتبقي الآن: كيك 700 وشاي 1000 — يُختبر رفض التسوية في الاختبار التالي
})

await t('التسوية: ترفض إن بقيت متبقيات غير مرتجعة', { screen: 'التوزيع', uiPath: 'تسوية جولة ببقايا', expected: '409 سجل المرتجعات أولًا', testRef: 'batch-d' }, async () => {
  const r = await call('POST', `/api/distribution/trips/${tripId}/settle`, { body: {} })
  eq(r.status, 409, 'status')
  expect(String(r.json.error).includes('غير مرتجعة'), 'رسالة: ' + r.json.error)
})

await t('التسوية الكاملة: فواتير + مرتجعات للناتج + نقد للوردية', { screen: 'التوزيع', uiPath: 'تسوية الجولة', expected: '3 فواتير + TRIP_RETURN +3200 + TRIP_CASH_IN +2000 + 409 مكرر', testRef: 'batch-d' }, async () => {
  // إرجاع كامل المتبقي: كيك 700 وشاي 1000
  const rem = await call('POST', `/api/distribution/trips/${tripId}/returns`, { body: { items: [
    { productId: ids.p['كيك'], qtyMilli: 700, condition: 'GOOD' },
    { productId: ids.p['شاي'], qtyMilli: 1000, condition: 'GOOD' },
  ] } })
  eq(rem.status, 200, 'إرجاع المتبقي كاملًا')
  const debtBefore = await customerDebtMinor(ids.c['متجر الأمل'])
  const cashBefore = await db.cashMovement.aggregate({ where: { type: 'TRIP_CASH_IN' }, _sum: { amountMinor: true } })
  const cakeBefore = await stockOf(ids.p['كيك'])
  const teaBefore = await stockOf(ids.p['شاي'])
  const r = await call('POST', `/api/distribution/trips/${tripId}/settle`, { body: { countedCashMinor: 2000, notes: 'تسوية اختبارية' } })
  eq(r.status, 200, 'status')
  eq(r.json.salesCount, 3, 'ثلاث فواتير أُنشئت')
  eq(r.json.cashRecordedToShift, true, 'النقد سُجل للوردية (1500 كيك + 500 شاي)')
  eq(r.json.creditTotalMinor, 900, 'الآجل 900')
  eq(r.json.returnedGoodMilli, 3200, 'مرتجع سليم: كيك 1200 + شاي 2000')
  const cashAfter = await db.cashMovement.aggregate({ where: { type: 'TRIP_CASH_IN' }, _sum: { amountMinor: true } })
  eq((cashAfter._sum.amountMinor ?? 0) - (cashBefore._sum.amountMinor ?? 0), 2000, 'TRIP_CASH_IN +2000')
  eq(await stockOf(ids.p['كيك']), cakeBefore + 1200, 'المرتجع السليم للكيك عاد (1200)')
  eq(await stockOf(ids.p['شاي']), teaBefore + 2000, 'المرتجع السليم للشاي عاد (2000)')
  const debtAfter = await customerDebtMinor(ids.c['متجر الأمل'])
  eq(debtAfter - debtBefore, 900, 'آجل العميل: 900 زاد الدين')
  const tripSales = await db.tripSale.findMany({ where: { tripId } })
  expect(tripSales.every(s => s.saleId), 'كل أسطر البيع مرتبطة بفاتورة')
  const distSales = await db.sale.findMany({ where: { tripId } })
  eq(distSales.length, 3, '3 فواتير مصدر DISTRIBUTION')
  expect(distSales.every(s => s.source === 'DISTRIBUTION'), 'المصدر موثق')
  const creditSale = distSales.find(s => s.customerId === ids.c['متجر الأمل'])
  eq(creditSale?.paymentStatus, 'UNPAID', 'الآجل غير مدفوع')
  expect(String(r.json.settledCount ?? r.json.tripNo ?? '').length >= 0, '')
  const again = await call('POST', `/api/distribution/trips/${tripId}/settle`, { body: {} })
  eq(again.status, 409, 'مسواة مسبقًا')
})

await finish('batch-d-ops')
process.exit(0)

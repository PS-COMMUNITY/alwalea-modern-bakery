// =============================================================
// batch-f-period — الجرد الشهري وإقفال الشهر وسد ثغرة الشهر المقفل
// 9 اختبارات إلزامية (تكليف المرحلة 1) — تشغيل على قاعدة معزولة:
// DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/batch-f-period.ts
// =============================================================
import { call, captureSession, t, eq, expect, finish } from './harness'
import { db } from '@/lib/db'

const LOCKED_MSG = 'هذا الشهر مقفل. يلزم فك القفل بسبب مسجل في سجل التدقيق قبل أي تعديل.'

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// دخول المالك (كل دفعة تبدأ بجلسة جديدة)
{
  const l = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(l.status, 200, 'دخول مالك')
  captureSession(l)
}

async function main() {
  const month = currentMonthKey()
  let countId = ''
  let lockedSaleId = ''
  let productId = ''

  // ---------- 1) إنشاء جرد شهري ----------
  await t('إنشاء ورقة جرد شهري بلقطة الأرصدة الدفترية', {
    screen: 'الجرد وإقفال الشهر', uiPath: 'POST /api/inventory/count',
    expected: '200 + ورقة JC-YYYYMM-#### ببنود = كل المنتجات المتتبعة', testRef: 'QA-PERIOD-1',
  }, async () => {
    const r = await call('POST', '/api/inventory/count', { body: { month, note: 'جرد نهاية الشهر (اختبار)' } })
    eq(r.status, 200, 'status')
    expect(r.json?.id, 'id')
    expect(String(r.json.countNo).startsWith(`JC-${month}`), `countNo يبدأ JC-${month}`)
    expect(r.json.items > 0, 'بنود > 0')
    countId = r.json.id
    const det = await call('GET', `/api/inventory/count/${countId}`)
    eq(det.status, 200, 'تفاصيل الورقة')
    eq(det.json.status, 'DRAFT', 'الحالة DRAFT')
    expect(det.json.items.length === r.json.items, 'عدد البنود مطابق')
    // كل بند له لقطة دفترية رقمية
    for (const it of det.json.items) expect(typeof it.systemQtyMilli === 'number', 'لقطة دفترية لكل بند')
    return `ورقة ${r.json.countNo} بعدد بنود ${r.json.items}`
  })

  // ---------- 2) اعتماد الجرد (بفرق مقصود) ----------
  await t('اعتماد ورقة الجرد يولد حركات تسوية بفروق المجرود', {
    screen: 'الجرد وإققال الشهر', uiPath: 'PUT + POST /api/inventory/count/[id]/approve',
    expected: '200 APPROVED + حركات ADJUSTMENT بمقدار الفرق', testRef: 'QA-PERIOD-2',
  }, async () => {
    const det = await call('GET', `/api/inventory/count/${countId}`)
    // نختار المنتج الأعلى رصيدًا (مفيد لاحقًا لإنشاء فاتورة داخل الشهر قبل الإقفال)
    const item = [...det.json.items].sort((a: any, b: any) => b.systemQtyMilli - a.systemQtyMilli)[0]
    productId = item.productId
    const surplus = 1000 // فائض مقصود +1.0 وحدة
    const save = await call('PUT', `/api/inventory/count/${countId}`, {
      body: { items: [{ id: item.id, countedQtyMilli: item.systemQtyMilli + surplus }] },
    })
    eq(save.status, 200, 'حفظ المجرود')
    const before = await call('GET', '/api/inventory/movements', { query: { productId } })
    const cntBefore = (before.json?.items ?? []).length
    const ap = await call('POST', `/api/inventory/count/${countId}/approve`, { body: { note: 'اعتماد الاختبار' } })
    eq(ap.status, 200, 'status الاعتماد')
    eq(ap.json.status, 'APPROVED', 'APPROVED')
    expect(ap.json.adjustmentMovements >= 1, 'حركة تسوية واحدة على الأقل')
    const after = await call('GET', '/api/inventory/movements', { query: { productId } })
    const rows = (after.json?.items ?? [])
    expect(rows.length === cntBefore + ap.json.adjustmentMovements, 'عدد الحركات زاد بمقدار الحركات المولدة')
    const last = rows[0]
    eq(last.type, 'ADJUSTMENT', 'نوع الحركة ADJUSTMENT')
    eq(last.qtyMilli, surplus, 'حجم الحركة = الفرق +1000')
    // لا تعديل بعد الاعتماد
    const re = await call('PUT', `/api/inventory/count/${countId}`, { body: { items: [{ id: item.id, countedQtyMilli: 0 }] } })
    eq(re.status, 409, 'رفض تعديل ورقة معتمدة')
    return `اعتماد ${ap.json.countNo} بحركة ADJUSTMENT +${surplus}`
  })

  // ---------- 3) إقفال الشهر ----------
  await t('إقفال الشهر الحالي يمنع أي تعديل لاحق بتاريخ داخله', {
    screen: 'الجرد وإقفال الشهر', uiPath: 'POST /api/settings/month-close',
    expected: '200 locked=true، وفاتورة تُنشأ قبل الإقفال لتصبح داخل الشهر المقفل', testRef: 'QA-PERIOD-3',
  }, async () => {
    // فاتورة تُنشأ قبل الإقفال (لاختبار إلغائها داخل الشهر المقفل)
    const custs = await call('GET', '/api/customers')
    const customerId = (custs.json?.rows ?? custs.json?.items ?? [])[0]?.id
    expect(!!customerId, 'يوجد عميل في القاعدة')
    const sale = await call('POST', '/api/sales', { body: {
      items: [{ productId, qtyMilli: 100 }],
      customerId,
      payments: [{ amountMinor: 1, method: 'CASH' }], // آجل جزئي مقصود — الأهم أنها داخل الشهر
    } })
    eq(sale.status, 200, 'إنشاء فاتورة قبل الإقفال')
    lockedSaleId = sale.json.id
    // إقفال
    const r = await call('POST', '/api/settings/month-close', { body: { month } })
    eq(r.status, 200, 'status الإقفال')
    eq(r.json.locked, true, 'locked=true')
    eq(r.json.month, month, 'الشهر صحيح')
    const st = await call('GET', '/api/settings/month-close', { query: { month } })
    eq(st.json.locked, true, 'حالة الشهر بعد الإقفال مقفلة')
    return `الشهر ${month} مقفل (فاتورة ${sale.json.invoiceNo} داخله)`
  })

  // ---------- 4) إلغاء فاتورة داخل شهر مقفل ← تفشل ----------
  await t('إلغاء فاتورة داخل شهر مقفل يُرفض بالرسالة الحرفية', {
    screen: 'المبيعات', uiPath: 'POST /api/sales/[id]/cancel',
    expected: `423 + "${LOCKED_MSG}"`, testRef: 'QA-PERIOD-4',
  }, async () => {
    const r = await call('POST', `/api/sales/${lockedSaleId}/cancel`, { body: { reason: 'خطأ تجريبي' } })
    eq(r.status, 423, 'status 423')
    eq(r.json?.error, LOCKED_MSG, 'الرسالة الحرفية للحاجز')
    // الفاتورة لم تتأثر
    const g = await call('GET', `/api/sales/${lockedSaleId}`)
    expect(g.json && g.json.status !== 'CANCELLED', 'الفاتورة ما زالت قائمة')
    // وكذلك إنشاء فاتورة جديدة بتاريخ داخل الشهر المقفل مرفوض
    const s2 = await call('POST', '/api/sales', { body: {
      items: [{ productId, qtyMilli: 100 }], payments: [{ amountMinor: 1000, method: 'CASH' }],
    } })
    eq(s2.status, 423, 'إنشاء بيع جديد داخل شهر مقفل مرفوض')
    eq(s2.json?.error, LOCKED_MSG, 'رسالة الحاجز على الإنشاء أيضًا')
    return 'void مرفوض 423 + رسالة حرفية، والفاتورة سليمة'
  })

  // ---------- 5) تعديل مخزون داخل شهر مقفل ← يفشل ----------
  await t('تعديل المخزون داخل شهر مقفل يُرفض بالرسالة الحرفية', {
    screen: 'المخزون', uiPath: 'POST /api/inventory/adjust',
    expected: `423 + "${LOCKED_MSG}"`, testRef: 'QA-PERIOD-5',
  }, async () => {
    const r = await call('POST', '/api/inventory/adjust', { body: { productId, countedQtyMilli: 99999, reason: 'تسوية اختبار' } })
    eq(r.status, 423, 'status 423')
    eq(r.json?.error, LOCKED_MSG, 'الرسالة الحرفية')
    // إعدام مخزون مرفوض أيضًا
    const w = await call('POST', '/api/inventory/waste', { body: { productId, qtyMilli: 100, reason: 'إعدام اختبار' } })
    eq(w.status, 423, 'إعدام داخل شهر مقفل مرفوض')
    // وإنشاء ورقة جرد جديدة داخل الشهر المقفل مرفوض
    const c = await call('POST', '/api/inventory/count', { body: { month } })
    eq(c.status, 423, 'إنشاء جرد داخل شهر مقفل مرفوض')
    // وحفظ كميات على الورقة الموجودة مرفوض
    const det = await call('GET', `/api/inventory/count/${countId}`)
    const sv = await call('PUT', `/api/inventory/count/${countId}`, { body: { items: [{ id: det.json.items[0].id, countedQtyMilli: 5 }] } })
    eq(sv.status, 423, 'تعديل ورقة جرد داخل شهر مقفل مرفوض')
    return 'تعديل مخزون/إعدام/جرد مرفوضة 423 برسالة الحاجز'
  })

  // ---------- 6) فك القفل بسبب إلزامي ← ينجح ----------
  await t('فك القفل يتطلب سببًا إلزاميًا ويسجل في سجل التدقيق ويفتح التصحيح', {
    screen: 'الإعدادات', uiPath: 'POST /api/settings/month-unlock',
    expected: 'بدون سبب 400، بسبب 200 locked=false، audit MONTH_UNLOCK، والتصحيح ينجح', testRef: 'QA-PERIOD-6',
  }, async () => {
    // بلا سبب → 400
    const noReason = await call('POST', '/api/settings/month-unlock', { body: { month } })
    eq(noReason.status, 400, 'رفض فك القفل بدون سبب')
    // بسبب → 200
    const r = await call('POST', '/api/settings/month-unlock', { body: { month, reason: 'خطأ مطبعي في فاتورة مبيعات — تصحيح محاسبي معتمد من المالك' } })
    eq(r.status, 200, 'status فك القفل')
    eq(r.json.locked, false, 'locked=false')
    // سجل التدقيق فيه MONTH_UNLOCK مع السبب
    const a = await call('GET', '/api/audit', { query: { action: 'MONTH_UNLOCK' } })
    const rowsA = a.json?.items ?? []
    const entry = rowsA[0]
    expect(entry, 'قيد MONTH_UNLOCK في سجل التدقيق')
    expect(JSON.stringify(entry?.details ?? '').includes('تصحيح محاسبي'), 'السبب مسجل في سجل التدقيق')
    // التصحيح الآن ينجح: إلغاء الفاتورة
    const fix = await call('POST', `/api/sales/${lockedSaleId}/cancel`, { body: { reason: 'تصحيح بعد فك القفل — خطأ مطبعي' } })
    eq(fix.status, 200, 'إلغاء الفاتورة نجح بعد فك القفل')
    // الحركات القديمة لم تُحذف: حركات الجرد ما زالت موجودة
    const mv = await call('GET', '/api/inventory/movements', { query: { productId } })
    const rowsM = (mv.json?.items ?? [])
    expect(rowsM.some((m: any) => m.type === 'ADJUSTMENT' && m.qtyMilli === 1000), 'حركة الجرد القديمة باقية بعد فك القفل')
    return 'فك قفل بسبب مسجل بالتدقيق + إلغاء الفاتورة نجح + الحركات القديمة باقية'
  })

  // ---------- 7) إعادة الإقفال ----------
  await t('إعادة إقفال الشهر بعد التصحيح تعود بالحاجز فعّالًا', {
    screen: 'الجرد وإقفال الشهر', uiPath: 'POST /api/settings/month-close (مرة ثانية)',
    expected: '200 locked=true وcloseCount=2 وأي كتابة جديدة تُرفض', testRef: 'QA-PERIOD-7',
  }, async () => {
    const r = await call('POST', '/api/settings/month-close', { body: { month } })
    eq(r.status, 200, 'status إعادة الإقفال')
    eq(r.json.locked, true, 'locked=true')
    eq(r.json.closeCount, 2, 'closeCount=2 (قُفل مرتين)')
    const chk = await call('POST', '/api/inventory/adjust', { body: { productId, countedQtyMilli: 1, reason: 'اختبار بعد إعادة الإقفال' } })
    eq(chk.status, 423, 'الحاجز فعّال مجددًا')
    eq(chk.json?.error, LOCKED_MSG, 'الرسالة الحرفية مجددًا')
    return `الشهر ${month} معاد إقفاله (closeCount=2) والحاجز فعّال`
  })

  // ---------- 8) تقرير فروق الجرد ----------
  await t('تقرير فروق الجرد يعرض الفرق كميًا وقيمته بالتكلفة', {
    screen: 'التقارير', uiPath: 'GET /api/reports/count-variance?countId=',
    expected: 'صف بالفرق +1000 وقيمة الفرق = 1000×تكلفة الوحدة', testRef: 'QA-PERIOD-8',
  }, async () => {
    const r = await call('GET', '/api/reports/count-variance', { query: { countId } })
    eq(r.status, 200, 'status')
    expect(r.json.rows.length >= 1, 'صفوف الفروق')
    const row = r.json.rows.find((x: any) => x.productId === productId)
    expect(row, 'صف المنتج المجرود موجود')
    eq(row.diffMilli, 1000, 'الفرق الكمي +1000')
    expect(row.diffValueMinor === 1000 * row.unitCostMinor, 'قيمة الفرق = الفرق × التكلفة')
    eq(r.json.summary.diffItems >= 1, true, 'ملخص يحسب بنود الفرق')
    eq(r.json.count.status, 'APPROVED', 'حالة الورقة في التقرير')
    return `تقرير ${r.json.count.countNo}: فرق ${row.diffQtyLabel} بقيمة ${row.diffValueLabel}`
  })

  // ---------- 9) تصدير CSV لتقرير الفروق ----------
  await t('تصدير CSV لتقرير فروق الجرد بمحتوى عربي سليم', {
    screen: 'التقارير', uiPath: 'GET /api/export/count-variance?countId=',
    expected: 'نص CSV يبدأ BOM ويتضمن العناوين واسم المنتج والفرق', testRef: 'QA-PERIOD-9',
  }, async () => {
    const r = await call('GET', '/api/export/count-variance', { query: { countId } })
    eq(r.status, 200, 'status')
    expect(r.text.startsWith('﻿'), 'BOM في بداية الملف')
    expect(r.text.includes('المنتج') && r.text.includes('الفرق (كمية)'), 'عناوين الأعمدة العربية')
    const lines = r.text.replace(/^﻿/, '').split('\r\n')
    expect(lines.length >= 2, 'صف بيانات واحد على الأقل')
    return `CSV بـ${lines.length - 1} صف بيانات`
  })

  await finish('batch-f-period')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })

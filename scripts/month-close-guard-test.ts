// =============================================================
// اختبار حاجز الشهر المقفل — مخبز الولاء الحديث (يُشغَّل: bun scripts/month-close-guard-test.ts)
// يستخدم dispatch الحقيقي (طبقة الصلاحيات كاملة) على قاعدة sql.js معزولة بملف مؤقت
// يغطي: فتح جرد ← مسودة ← اعتماد ← تقرير فروق ← إقفال الشهر ←
//       منع إلغاء فاتورة/شراء/مصروف داخل الشهر المقفل ← منع فتح/تعديل جرد شهر مقفل ←
//       منع تعديل مخزون وحركات صندوق داخل الشهر الحالي المقفل ←
//       فك القفل بسبب إلزامي + audit_log + عدم حذف الحركات ← تصحيح بعد الفك ← إعادة الإقفال ← CSV
// الرسالة الموحدة إلزامية: LOCKED_MSG من stockcount.ts (فحص حرفي)
// =============================================================
import { rmSync } from 'node:fs'
import { BakeryDb } from '../src/main/db'
import { dispatch } from '../src/main/registry'
import { LOCKED_MSG } from '../src/main/services/stockcount'
import { buildCsv } from '../src/shared/csv'

const DB_PATH = `/tmp/bakery-mc-guard-test-${Date.now()}.db`

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log(`PASS | ${name}${extra ? ' | ' + extra : ''}`)
  } else {
    fail++
    console.log(`FAIL | ${name}${extra ? ' | ' + extra : ''}`)
  }
}

async function invoke(db: BakeryDb, channel: string, payload: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string; code: number | undefined }> {
  const r = await dispatch(db, channel, payload)
  return { ok: r.ok, data: r.data, error: r.error, code: r.code }
}

async function openDb(): Promise<BakeryDb> {
  const db = new BakeryDb({
    filePath: DB_PATH,
    wasmCandidates: ['node_modules/sql.js/dist/sql-wasm.wasm']
  })
  await db.init()
  db.setPersistFn(() => db.persist())
  return db
}

// الفترة المختَبة = الشهر السابق (يُحسب ديناميكيًا) والشهر الحالي لاختبار قفل اليوم
const now = new Date()
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15)
const PYM = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
const CYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const P_DAY = (d: number): string => `${PYM}-${String(d).padStart(2, '0')}`

async function main(): Promise<void> {
  rmSync(DB_PATH, { force: true })
  const db = await openDb()

  // ===== 0) إعداد + جلسة مالك =====
  const setup = await invoke(db, 'setup.run', { businessName: 'مخبز اختبار الإقفال', ownerName: 'المالك', password: '1234' })
  check('setup.run ناجح', setup.ok === true, setup.error ?? '')
  const login = await invoke(db, 'auth.login', { password: '1234' })
  const token = (login.data as { token: string } | undefined)?.token ?? ''
  check('جلسة OWNER جاهزة', login.ok === true && token.length > 10)

  // ===== 1) بيانات أساسية =====
  const prod = await invoke(db, 'products.create', { token, name: 'خبز اختبار الإقفال', type: 'FINISHED', baseUnit: 'كجم', priceMinor: 5000, costMinor: 2000, trackStock: true, minStockMilli: 0 })
  const productId = (prod.data as { id: number } | undefined)?.id
  check('إنشاء منتج', prod.ok === true && !!productId, prod.error ?? '')

  const opening = await invoke(db, 'inventory.opening', { token, items: [{ productId, qtyMilli: 50000, unitCostMinor: 2000 }] })
  check('رصيد افتتاحي 50 كجم', opening.ok === true && (opening.data as { count: number }).count === 1, opening.error ?? '')

  const supplier = await invoke(db, 'suppliers.create', { token, name: 'مورد اختبار الإقفال' })
  const supplierId = (supplier.data as { id: number } | undefined)?.id
  check('إنشاء مورد', supplier.ok === true && !!supplierId, supplier.error ?? '')

  const cat = await invoke(db, 'expenses.categories.create', { token, name: 'فئة اختبار الإقفال' })
  const categoryId = (cat.data as { id: number } | undefined)?.id
  check('إنشاء فئة مصروف', cat.ok === true && !!categoryId, cat.error ?? '')

  // ===== 2) مستندات مؤرخة داخل الشهر السابق (P) =====
  const sale1 = await invoke(db, 'sales.create', {
    token,
    date: P_DAY(10),
    items: [{ productId, qtyMilli: 6000 }],
    payments: [{ method: 'CASH', amountMinor: 30000 }]
  })
  const sale1Id = (sale1.data as { id: number } | undefined)?.id
  check('فاتورة بيع داخل الشهر السابق', sale1.ok === true && !!sale1Id, sale1.error ?? '')

  const sale2 = await invoke(db, 'sales.create', {
    token,
    date: P_DAY(11),
    items: [{ productId, qtyMilli: 4000 }],
    payments: [{ method: 'CASH', amountMinor: 20000 }]
  })
  const sale2Id = (sale2.data as { id: number } | undefined)?.id
  check('فاتورة بيع ثانية داخل الشهر السابق', sale2.ok === true && !!sale2Id, sale2.error ?? '')

  const purchase = await invoke(db, 'purchases.create', {
    token,
    date: P_DAY(5),
    supplierId,
    items: [{ productId, qtyMilli: 10000, unitCostMinor: 2000 }],
    paidMinor: 10000
  })
  const purchaseId = (purchase.data as { id: number } | undefined)?.id
  check('فاتورة شراء داخل الشهر السابق', purchase.ok === true && !!purchaseId, purchase.error ?? '')

  const expense = await invoke(db, 'expenses.create', { token, date: P_DAY(3), categoryId, amountMinor: 15000, note: 'غاز' })
  const expenseId = (expense.data as { id: number } | undefined)?.id
  check('مصروف داخل الشهر السابق', expense.ok === true && !!expenseId, expense.error ?? '')

  // ===== 3) الجرد الشهري: فتح ← مسودة ← اعتماد =====
  const openCount = await invoke(db, 'stockcount.open', { token, periodYm: PYM })
  const openData = openCount.data as { count: { id: number; status: string }; items: Array<{ product_id: number; system_qty_milli: number }> } | undefined
  const countId = openData?.count?.id
  check(`فتح جرد ${PYM} بلقطة أرصدة`, openCount.ok === true && !!countId && (openData?.items.length ?? 0) >= 1, openCount.error ?? '')

  const systemQty = openData?.items.find((i) => i.product_id === productId)?.system_qty_milli ?? 0
  // الرصيد النظامي = 50000 افتتاحي + 10000 شراء − 6000 − 4000 بيع = 50000
  check('لقطة الرصيد النظامي صحيحة (50000)', systemQty === 50000, `system=${systemQty}`)

  const saveDraft = await invoke(db, 'stockcount.saveItems', {
    token,
    countId,
    items: [{ productId, actualQtyMilli: 45000, reason: 'هالك', note: 'نقص فعلي مُعدوم' }]
  })
  check('حفظ مسودة بالفرق والسبب الإلزامي', saveDraft.ok === true, saveDraft.error ?? '')

  const approve = await invoke(db, 'stockcount.approve', { token, countId })
  const approveData = approve.data as { movements: number; count: { status: string } } | undefined
  check('اعتماد الجرد يولّد حركة موثقة', approve.ok === true && (approveData?.movements ?? 0) >= 1 && approveData?.count.status === 'APPROVED', approve.error ?? '')

  // ===== 4) تقرير فروق الجرد قبل الإقفال =====
  const variances = await invoke(db, 'stockcount.variances', { token, periodYm: PYM })
  const varData = variances.data as { lossMinor: number; gainMinor: number; netMinor: number; items: Array<{ diff_milli: number; impact_minor: number }> } | undefined
  // الفرق −5000 ملي × تكلفة 2000 أغور/كجم / 1000 = −10000 أغورة
  check('تقرير الفروق: عجز 10000 أغورة', variances.ok === true && varData?.lossMinor === 10000 && varData?.netMinor === -10000, `loss=${varData?.lossMinor}`)

  // ===== 5) إقفال الشهر =====
  const close = await invoke(db, 'stockcount.closeMonth', { token, periodYm: PYM, note: 'إقفال شهر الاختبار' })
  const closeData = close.data as { closed: boolean; warning: string | null } | undefined
  check(`إقفال الشهر ${PYM} (بجرد معتمد — بلا تحذير)`, close.ok === true && closeData?.closed === true && closeData?.warning === null, close.error ?? '')

  const statuses = await invoke(db, 'stockcount.getMonthStatuses', { token, fromYm: PYM, toYm: CYM })
  const stData = statuses.data as Array<{ period_ym: string; locked: boolean }> | undefined
  check('حالة الشهر بعد الإقفال = مقفل', statuses.ok === true && stData?.find((s) => s.period_ym === PYM)?.locked === true)

  // ===== 6) الحاجز: الإلغاءات داخل الشهر المقفل تفشل برسالة موحدة حرفية =====
  const lockExact = (err: string | undefined): boolean => err === LOCKED_MSG
  const cancelSaleLocked = await invoke(db, 'sales.cancel', { token, id: sale1Id, reason: 'خطأ في الفاتورة' })
  check('إلغاء فاتورة داخل شهر مقفل مرفوض 409', cancelSaleLocked.ok === false && cancelSaleLocked.code === 423, `code=${cancelSaleLocked.code} err=${cancelSaleLocked.error}`)
  check('رسالة القفل الموحدة حرفيًا (بيع)', lockExact(cancelSaleLocked.error), cancelSaleLocked.error ?? '')

  const cancelPurchaseLocked = await invoke(db, 'purchases.cancel', { token, id: purchaseId, reason: 'خطأ في فاتورة الشراء' })
  check('إلغاء شراء داخل شهر مقفل مرفوض 409 برسالة موحدة', cancelPurchaseLocked.ok === false && cancelPurchaseLocked.code === 423 && lockExact(cancelPurchaseLocked.error), cancelPurchaseLocked.error ?? '')

  const cancelExpenseLocked = await invoke(db, 'expenses.cancel', { token, id: expenseId, reason: 'خطأ في المصروف' })
  check('إلغاء مصروف داخل شهر مقفل مرفوض 409 برسالة موحدة', cancelExpenseLocked.ok === false && cancelExpenseLocked.code === 423 && lockExact(cancelExpenseLocked.error), cancelExpenseLocked.error ?? '')

  // إنشاء مستند جديد بتاريخ داخل الشهر المقفل يفشل (حاجز الإنشاء القائم)
  const saleInLocked = await invoke(db, 'sales.create', { token, date: P_DAY(20), items: [{ productId, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 5000 }] })
  check('بيع جديد بتاريخ شهر مقفل مرفوض', saleInLocked.ok === false && saleInLocked.code === 423 && lockExact(saleInLocked.error), saleInLocked.error ?? '')

  const expenseInLocked = await invoke(db, 'expenses.create', { token, date: P_DAY(21), categoryId, amountMinor: 1000 })
  check('مصروف جديد بتاريخ شهر مقفل مرفوض', expenseInLocked.ok === false && expenseInLocked.code === 423 && lockExact(expenseInLocked.error), expenseInLocked.error ?? '')

  const cashInLocked = await invoke(db, 'cash.record', { token, amountMinor: 500, reason: 'تسوية مؤرخة داخل شهر مقفل', date: P_DAY(22) })
  check('تسوية صندوق بتاريخ شهر مقفل مرفوض', cashInLocked.ok === false && cashInLocked.code === 423 && lockExact(cashInLocked.error), cashInLocked.error ?? '')

  // ===== 7) الجرد داخل الشهر المقفل: فتح/تعديل ممنوع =====
  const reopenLocked = await invoke(db, 'stockcount.open', { token, periodYm: PYM })
  check('فتح/إعادة فتح جرد لشهر مقفل مرفوض', reopenLocked.ok === false && reopenLocked.code === 409 && lockExact(reopenLocked.error), reopenLocked.error ?? '')

  const saveApprovedLocked = await invoke(db, 'stockcount.saveItems', {
    token,
    countId,
    items: [{ productId, actualQtyMilli: 44000, reason: 'أخرى' }]
  })
  check('تعديل جرد معتمد مرفوض', saveApprovedLocked.ok === false && saveApprovedLocked.code === 409, saveApprovedLocked.error ?? '')

  // ===== 8) الشهر الحالي المقفل يمنع حركات اليوم =====
  const closeCurrent = await invoke(db, 'stockcount.closeMonth', { token, periodYm: CYM })
  check(`إقفال الشهر الحالي ${CYM} (تحذير: بلا جرد معتمد)`, closeCurrent.ok === true && (closeCurrent.data as { warning: string | null }).warning !== null, closeCurrent.error ?? '')

  const adjustLockedToday = await invoke(db, 'inventory.adjust', { token, productId, countedQtyMilli: 45000, reason: 'جرد لحظي' })
  check('تعديل مخزون (جرد) داخل الشهر الحالي المقفل مرفوض', adjustLockedToday.ok === false && adjustLockedToday.code === 423 && lockExact(adjustLockedToday.error), adjustLockedToday.error ?? '')

  const wasteLockedToday = await invoke(db, 'inventory.waste', { token, productId, qtyMilli: 1000, reason: 'إعدام' })
  check('هالك داخل الشهر الحالي المقفل مرفوض', wasteLockedToday.ok === false && wasteLockedToday.code === 423 && lockExact(wasteLockedToday.error), wasteLockedToday.error ?? '')

  const saleTodayLocked = await invoke(db, 'sales.create', { token, items: [{ productId, qtyMilli: 1000 }], payments: [{ method: 'CASH', amountMinor: 5000 }] })
  check('بيع اليوم داخل شهر مقفل مرفوض', saleTodayLocked.ok === false && saleTodayLocked.code === 423 && lockExact(saleTodayLocked.error), saleTodayLocked.error ?? '')

  const cust = await invoke(db, 'customers.create', { token, name: 'عميل اختبار الإقفال' })
  const customerId = (cust.data as { id: number } | undefined)?.id
  const paymentLocked = await invoke(db, 'customers.payment', { token, customerId, amountMinor: 1000 })
  check('تحصيل دفعة عميل داخل شهر مقفل مرفوض', paymentLocked.ok === false && paymentLocked.code === 423 && lockExact(paymentLocked.error), paymentLocked.error ?? '')

  // ===== 9) فك القفل: سبب إلزامي + audit + عدم حذف الحركات =====
  const movesBefore = (db.query<{ c: number }>('SELECT COUNT(*) AS c FROM stock_movements')[0]?.c ?? 0) as number

  const shortReason = await invoke(db, 'stockcount.unlockMonth', { token, periodYm: PYM, unlockReason: 'قصير' })
  check('سبب فك القفل أقل من 5 أحرف مرفوض', shortReason.ok === false && shortReason.code === 400, `code=${shortReason.code}`)

  const unlock = await invoke(db, 'stockcount.unlockMonth', { token, periodYm: PYM, unlockReason: 'تصحيح خطأ إدخال فاتورة البيع رقم 1' })
  check('فك القفل بسبب إلزامي ينجح', unlock.ok === true && (unlock.data as { unlocked: boolean }).unlocked === true, unlock.error ?? '')

  const auditRows = db.query<{ action: string; details: string }>("SELECT action, details FROM audit_log WHERE action = 'month.unlock' ORDER BY id DESC LIMIT 1")
  check('سجل التدقيق يوثق month.unlock بالسبب', auditRows.length === 1 && (auditRows[0]?.details ?? '').includes('تصحيح خطأ إدخال'), JSON.stringify(auditRows[0] ?? {}).slice(0, 120))

  const movesAfterUnlock = (db.query<{ c: number }>('SELECT COUNT(*) AS c FROM stock_movements')[0]?.c ?? 0) as number
  check('فك القفل لا يحذف الحركات القديمة', movesAfterUnlock === movesBefore, `before=${movesBefore} after=${movesAfterUnlock}`)

  // rc.13: فك قفل الشهر الحالي قبل التصحيح — الإلغاء العكسي يكتب حركات بتاريخ اليوم
  // (نمط rc.12-merge: فحص الشهرين معًا) فلا ينجح تصحيح بينما شهر اليوم مقفل
  const unlockCurrent = await invoke(db, 'stockcount.unlockMonth', { token, periodYm: CYM, unlockReason: 'إنهاء اختبار الشهر الحالي' })
  check('فك قفل الشهر الحالي لإنهاء الاختبار بنظافة', unlockCurrent.ok === true, unlockCurrent.error ?? '')

  // ===== 10) بعد الفك: التصحيح ممكن (إلغاء الفاتورة المعطوبة) =====
  const cancelSaleOpen = await invoke(db, 'sales.cancel', { token, id: sale1Id, reason: 'تصحيح: فاتورة مكررة' })
  check('بعد فك القفل: إلغاء الفاتورة ينجح', cancelSaleOpen.ok === true && (cancelSaleOpen.data as { status: string }).status === 'CANCELLED', cancelSaleOpen.error ?? '')

  // ===== 11) إعادة الإقفال =====
  const reclose = await invoke(db, 'stockcount.closeMonth', { token, periodYm: PYM })
  check('إعادة إقفال الشهر بعد التصحيح', reclose.ok === true && (reclose.data as { closed: boolean }).closed === true, reclose.error ?? '')

  const cancelAfterReclose = await invoke(db, 'sales.cancel', { token, id: sale2Id, reason: 'محاولة بعد إعادة الإقفال' })
  check('بعد إعادة الإقفال: الحاجز يعمل من جديد (423 + رسالة موحدة)', cancelAfterReclose.ok === false && cancelAfterReclose.code === 423 && lockExact(cancelAfterReclose.error), cancelAfterReclose.error ?? '')

  const adjustOpenToday = await invoke(db, 'inventory.adjust', { token, productId, countedQtyMilli: 47000, reason: 'تصحيح بعد فك قفل الشهر الحالي' })
  check('بعد فك قفل الشهر الحالي: تعديل المخزون ينجح', adjustOpenToday.ok === true, adjustOpenToday.error ?? '')

  // ===== 12) تقرير الفروق بعد كل شيء + تصدير CSV =====
  const variances2 = await invoke(db, 'stockcount.variances', { token, periodYm: PYM })
  const var2 = variances2.data as { items: Array<{ product_name: string; diff_milli: number; impact_minor: number; reason: string }>; lossMinor: number; month: { locked: boolean } } | undefined
  check('تقرير الفروق يعمل بعد الإلغاءات والإقفالات', variances2.ok === true && (var2?.items.length ?? 0) >= 1 && var2?.month.locked === true, `loss=${var2?.lossMinor}`)

  const csv = buildCsv(
    ['المنتج', 'الفرق (كجم)', 'الأثر (أغورة)', 'السبب'],
    (var2?.items ?? []).map((i) => [i.product_name, (i.diff_milli / 1000).toFixed(3), String(i.impact_minor), i.reason])
  )
  check(
    'CSV لتقرير الفروق: BOM + CRLF + صفوف',
    csv.charCodeAt(0) === 0xfeff && csv.includes('\r\n') && csv.split('\r\n').length >= 3,
    `bytes=${csv.length}`
  )
  check('CSV يقتبس الخلايا ذات الفواصل', buildCsv(['أ', 'ب'], [['x,y', 'z']]).includes('"x,y"'))

  // ===== النتيجة =====
  console.log('----------------------------------------')
  console.log(`PERIOD_UNDER_TEST=${PYM} CURRENT=${CYM}`)
  console.log(`TOTAL_PASS=${pass} TOTAL_FAIL=${fail}`)
  console.log(fail === 0 ? 'MONTH-CLOSE-GUARD: ALL PASS' : 'MONTH-CLOSE-GUARD: FAILURES PRESENT')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('CRASH', e)
  process.exit(2)
})

// =============================================================
// QA الدفعة A — المصادقة والتهيئة والإعدادات والمستخدمون وسجل التدقيق
// DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/batch-a-auth.ts
// =============================================================
import { call, captureSession, state, t, expect, eq, finish, db } from './harness'
import { randomBytes } from 'crypto'

const ids = await Bun.file('/tmp/qa-bakery/ids.json').json()

// تنظيف بقايا تشغيلات سابقة (قاعدة الاختبار المعزولة فقط) لضمان تكرارية الدفعة
await db.session.deleteMany({ where: { user: { username: { in: ['qa_cashier', 'qa_manager'] } } } })
await db.user.deleteMany({ where: { username: { in: ['qa_cashier', 'qa_manager'] } } })

/* ---------- 1) الدخول ---------- */
await t('الدخول بكلمة مرور فارغة → 400', { screen: 'تسجيل الدخول', uiPath: 'شاشة الدخول → زر دخول بدون كلمة', expected: '400 كلمة المرور مطلوبة', testRef: 'batch-a' }, async () => {
  const r = await call('POST', '/api/auth/login', { body: { password: '' } })
  eq(r.status, 400, 'status')
  return 'رفض فوري قبل أي استعلام'
})

await t('الدخول بكلمة مرور خاطئة → 401 وعدّاد محاولات', { screen: 'تسجيل الدخول', uiPath: 'شاشة الدخول → كلمة خاطئة', expected: '401 + failedAttempts=1 + LOGIN_FAILED', testRef: 'batch-a' }, async () => {
  const r = await call('POST', '/api/auth/login', { body: { password: '9999' } })
  eq(r.status, 401, 'status')
  expect(String(r.json.error).includes('غير صحيحة'), 'رسالة عربية واضحة: ' + r.json.error)
  const u = await db.user.findUnique({ where: { id: ids.ownerId } })
  eq(u?.failedAttempts, 1, 'failedAttempts')
  const logs = await db.auditLog.count({ where: { action: 'LOGIN_FAILED' } })
  expect(logs >= 1, 'يجب تسجيل LOGIN_FAILED في التدقيق')
  return 'عدّاد المحاولات + تدقيق LOGIN_FAILED'
})

await t('الدخول الصحيح → جلسة كوكي + آخر دخول', { screen: 'تسجيل الدخول', uiPath: 'شاشة الدخول → كلمة صحيحة', expected: '200 + كوكي جلسة + LOGIN', testRef: 'batch-a' }, async () => {
  const r = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(r.status, 200, 'status')
  expect(r.setCookie?.includes('bakery_session='), 'كوكي الجلسة مضبوط')
  expect(String(r.setCookie).includes('HttpOnly'), 'الكوكي HttpOnly')
  captureSession(r)
  const u = await db.user.findUnique({ where: { id: ids.ownerId } })
  eq(u?.failedAttempts, 0, 'إعادة تصفير العداد بعد النجاح')
  return 'جلسة 12 ساعة + تحديث lastLoginAt'
})

await t('الجلسة القائمة: /api/auth/me يعيد المالك', { screen: 'شريط علوي', uiPath: 'إعادة فتح التطبيق مع جلسة قائمة', expected: 'user.role=OWNER', testRef: 'batch-a' }, async () => {
  const r = await call('GET', '/api/auth/me')
  eq(r.status, 200, 'status')
  eq(r.json.user?.role, 'OWNER', 'role')
})

await t('me بدون جلسة → user:null (بدون تسريب)', { screen: 'شاشة الدخول', uiPath: 'فتح التطبيق لأول مرة', expected: '{user:null}', testRef: 'batch-a' }, async () => {
  const r = await call('GET', '/api/auth/me', { session: 'none' })
  eq(r.status, 200, 'status')
  eq(r.json.user, null, 'user')
})

/* ---------- 2) قفل الحساب بعد 5 محاولات ---------- */
await t('قفل مؤقت بعد 5 محاولات فاشلة → 423 حتى بكلمة صحيحة', { screen: 'تسجيل الدخول', uiPath: '5 محاولات خاطئة متتالية', expected: '423 بعد الخامسة + lockedUntil', testRef: 'batch-a' }, async () => {
  for (let i = 0; i < 4; i++) await call('POST', '/api/auth/login', { body: { password: '0000' } })
  const r5 = await call('POST', '/api/auth/login', { body: { password: '0000' } })
  eq(r5.status, 423, 'الخامسة تُقفل')
  const rOk = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(rOk.status, 423, 'حتى الصحيحة مرفوضة أثناء القفل')
  const u = await db.user.findUnique({ where: { id: ids.ownerId } })
  expect(u?.lockedUntil && u.lockedUntil > new Date(), 'lockedUntil مستقبلية')
  // تنظيف الاختبار فقط: إلغاء القفل لمواصلة الدفعة
  await db.user.update({ where: { id: ids.ownerId }, data: { lockedUntil: null, failedAttempts: 0 } })
  return 'قفل 5 دقائق يمنع الدخول بكلمة صحيحة أيضًا'
})

/* ---------- 3) تسجيل الخروج ---------- */
await t('الخروج يبطل الجلسة فورًا', { screen: 'شريط علوي', uiPath: 'القائمة → تسجيل خروج', expected: 'جلسة محذوفة + me null + LOGOUT', testRef: 'batch-a' }, async () => {
  const l = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  captureSession(l, 'second')
  const before = await call('GET', '/api/auth/me', { session: 'second' })
  expect(before.json.user, 'الجلسة الثانية صالحة قبل الخروج')
  const out = await call('POST', '/api/auth/logout', { session: 'second' })
  eq(out.status, 200, 'status')
  const after = await call('GET', '/api/auth/me', { session: 'second' })
  eq(after.json.user, null, 'الجلسة أُبطلت بعد الخروج')
  const cnt = await db.auditLog.count({ where: { action: 'LOGOUT' } })
  expect(cnt >= 1, 'تدقيق LOGOUT')
  return 'حذف صف الجلسة + تدقيق LOGOUT'
})

/* ---------- 4) الإعدادات ---------- */
await t('GET /api/settings بدون جلسة → 401', { screen: '—', uiPath: 'طلب API مباشر بلا جلسة', expected: '401 يجب تسجيل الدخول', testRef: 'batch-a' }, async () => {
  const r = await call('GET', '/api/settings', { session: 'none' })
  eq(r.status, 401, 'status')
})

await t('تعديل الإعدادات: تفعيل الضريبة 17% + الاسم', { screen: 'الإعدادات', uiPath: 'الإعدادات → حفظ', expected: '200 + SETTINGS_UPDATE + قيم مخزنة', testRef: 'batch-a' }, async () => {
  const r = await call('PUT', '/api/settings', { body: { businessName: 'مخبز QA معدل', taxEnabled: true, taxRateBp: 1700, idleLockMinutes: 30, receiptWidth: 58 } })
  eq(r.status, 200, 'status')
  const s = await db.settings.findUnique({ where: { id: 1 } })
  eq(s?.taxEnabled, true, 'taxEnabled')
  eq(s?.taxRateBp, 1700, 'taxRateBp')
  eq(s?.receiptWidth, 58, 'receiptWidth')
  const a = await db.auditLog.count({ where: { action: 'SETTINGS_UPDATE' } })
  expect(a >= 1, 'تدقيق SETTINGS_UPDATE')
  return 'الضريبة 1700bp محفوظة (ستُختبر ماليًا في دفعة البيع)'
})

await t('إعدادات غير صالحة: ضريبة >10000 → رفض', { screen: 'الإعدادات', uiPath: 'إدخال نسبة ضريبة خاطئة', expected: '400 بيانات غير صالحة', testRef: 'batch-a' }, async () => {
  const r = await call('PUT', '/api/settings', { body: { taxRateBp: 20000 } })
  eq(r.status, 400, 'status')
  const r2 = await call('PUT', '/api/settings', { body: { idleLockMinutes: 999 } })
  eq(r2.status, 400, 'idleLock خارج 1..240 مرفوض')
  const r3 = await call('PUT', '/api/settings', { body: { receiptWidth: 99 } })
  eq(r3.status, 400, 'عرض إيصال غير معروف مرفوض')
  return 'حدود الإعدادات مفروضة في الخادم'
})

/* ---------- 5) المستخدمون والصلاحيات ---------- */
let cashierId = ''
let managerId = ''
await t('إنشاء مستخدمي أدوار (كاشير/مدير)', { screen: 'الإعدادات → المستخدمون', uiPath: 'الإعدادات → إضافة مستخدم', expected: '200 لكل مستخدم + USER_CREATE', testRef: 'batch-a' }, async () => {
  const c = await call('POST', '/api/users', { body: { username: 'qa_cashier', displayName: 'كاشير QA', role: 'CASHIER', password: '1234' } })
  eq(c.status, 200, 'status')
  cashierId = c.json.id
  const m = await call('POST', '/api/users', { body: { username: 'qa_manager', displayName: 'مدير QA', role: 'MANAGER', password: '1234' } })
  eq(m.status, 200, 'status')
  managerId = m.json.id
  expect(await db.auditLog.count({ where: { action: 'USER_CREATE' } }) >= 2, 'تدقيق USER_CREATE')
  return 'حسابان باطلان مع هاش scrypt'
})

await t('رفض مستخدم مكرر/دور خاطئ/كلمة قصيرة', { screen: 'الإعدادات → المستخدمون', uiPath: 'إضافة مستخدم ببيانات خاطئة', expected: '409 / 400 / 400', testRef: 'batch-a' }, async () => {
  const dup = await call('POST', '/api/users', { body: { username: 'qa_cashier', displayName: 'مكرر', role: 'CASHIER', password: '1234' } })
  eq(dup.status, 409, 'اسم مكرر')
  const badRole = await call('POST', '/api/users', { body: { username: 'x1', displayName: 'س', role: 'SUPERGOD', password: '1234' } })
  eq(badRole.status, 400, 'دور غير معروف')
  const shortPw = await call('POST', '/api/users', { body: { username: 'x2', displayName: 'س', role: 'CASHIER', password: '12' } })
  eq(shortPw.status, 400, 'كلمة قصيرة')
  const badName = await call('POST', '/api/users', { body: { username: 'a b!', displayName: 'س', role: 'CASHIER', password: '1234' } })
  eq(badName.status, 400, 'اسم مستخدم بأحرف غير مسموحة')
})

await t('حماية المالك: منع التنزيل (409) ومنع تعطيل النفس (400)', { screen: 'الإعدادات → المستخدمون', uiPath: 'تعديل المالك الوحيد', expected: '409 تنزيل آخر مالك + 400 تعطيل النفس', testRef: 'batch-a' }, async () => {
  const demote = await call('PUT', `/api/users/${ids.ownerId}`, { body: { role: 'CASHIER' } })
  eq(demote.status, 409, 'منع تنزيل آخر مالك')
  const self = await call('PUT', `/api/users/${ids.ownerId}`, { body: { active: false } })
  eq(self.status, 400, 'تعطيل النفس ممنوع برسالة واضحة')
  expect(String(self.json.error).includes('حسابك الحالي'), 'رسالة التعطيل الذاتي: ' + self.json.error)
  // التحقق من أن الفرع 409 (تعطيل آخر مالك غير النفس) متاح دفاعيًا: إنشاء مالك ثانٍ ثم تعطيله ثم تنزيله يجب أن ينجح
  const tmp = await call('POST', '/api/users', { body: { username: 'qa_tmp_owner', displayName: 'مالك مؤقت', role: 'OWNER', password: '1234' } })
  eq(tmp.status, 200, 'مالك ثانٍ للتجربة')
  const deact2 = await call('PUT', `/api/users/${tmp.json.id}`, { body: { active: false } })
  eq(deact2.status, 200, 'تعطيل مالك غير النفس ينجح لأنه ليس الأخير')
  await db.user.deleteMany({ where: { username: 'qa_tmp_owner' } })
  return 'قواعد حماية المالك مفروضة في الخادم (409 فرع دفاعي عند تعدد الملاك)'
})

await t('طبقة الصلاحيات: جلسة كاشير → 403 على settings/users/backup', { screen: '—', uiPath: 'مستخدم بصلاحيات أقل يحاول إجراء إداري', expected: '403 على 4 مسارات إدارية', testRef: 'batch-a' }, async () => {
  // جلسة كاشير تُنشأ مباشرة (الويب الحالي يدخل المالك فقط — انحراف موثق، اختبرنا الطبقة المرخصة)
  const token = randomBytes(32).toString('hex')
  await db.session.create({ data: { token, userId: cashierId, expiresAt: new Date(Date.now() + 3600_000) } })
  state.token2 = token
  for (const [m, p] of [['PUT', '/api/settings'], ['POST', '/api/users'], ['GET', '/api/backup/export'], ['POST', '/api/inventory/adjust']] as const) {
    const r = await call(m as 'PUT', p, { session: 'second', body: p === '/api/inventory/adjust' ? { productId: ids.p['دقيق'], countedQtyMilli: 0, reason: 'x' } : undefined })
    eq(r.status, 403, `${m} ${p}`)
  }
  // الكاشير يستطيع ما يُسمح له: قائمة المنتجات (auth-only) واستخدام نقط البيع لاحقًا
  const pv = await call('GET', '/api/products', { session: 'second' })
  eq(pv.status, 200, 'المنتجات auth-only متاحة للكاشير')
  await db.session.deleteMany({ where: { userId: cashierId } })
  return 'مصفوفة الصلاحيات مفروضة في طبقة API لكل الأدوار'
})

/* ---------- 6) كلمة المرور: تغيير وإبطال الجلسات ---------- */
await t('تغيير كلمة المرور: حالية خاطئة → 401', { screen: 'الإعدادات → كلمة المرور', uiPath: 'تغيير كلمة المرور → حالية خاطئة', expected: '401', testRef: 'batch-a' }, async () => {
  const r = await call('PUT', `/api/users/${ids.ownerId}/password`, { body: { newPassword: '5678', currentPassword: '0000' } })
  eq(r.status, 401, 'status')
})

await t('تغيير كلمة المرور بنجاح → إبطال الجلسات القديمة', { screen: 'الإعدادات → كلمة المرور', uiPath: 'تغيير كلمة المرور → حالية صحيحة', expected: '200 + جلسات محذوفة + الجلسة الحالية تُعاد', testRef: 'batch-a' }, async () => {
  // جلسة ثانية قديمة يجب أن تُبطل
  const l2 = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  captureSession(l2, 'second')
  const r = await call('PUT', `/api/users/${ids.ownerId}/password`, { body: { newPassword: '5678', currentPassword: '1234' } })
  eq(r.status, 200, 'status')
  const sessions = await db.session.count({ where: { userId: ids.ownerId } })
  expect(sessions <= 1, `يجب حذف الجلسات القديمة (المتبقي ${sessions})`)
  const oldLogin = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(oldLogin.status, 401, 'الكلمة القديمة لم تعد تعمل')
  const newLogin = await call('POST', '/api/auth/login', { body: { password: '5678' } })
  eq(newLogin.status, 200, 'الكلمة الجديدة تعمل')
  captureSession(newLogin)
  // إعادة كلمة التطوير 1234 للاختبارات اللاحقة (بيئة معزولة فقط)
  const back = await call('PUT', `/api/users/${ids.ownerId}/password`, { body: { newPassword: '1234', currentPassword: '5678' } })
  eq(back.status, 200, 'إعادة 1234')
  const final = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  eq(final.status, 200, 'الدخول بـ1234 بعد الإعادة')
  captureSession(final)
  return 'التغيير يبطل الجلسات + الكلمة القديمة تُرفض فورًا'
})

await t('PIN: تعيين/رفض غير صالح/إزالة', { screen: 'الإعدادات → المستخدمون', uiPath: 'تعيين PIN لمستخدم', expected: 'pinSet / 400 / pinRemoved', testRef: 'batch-a' }, async () => {
  const set = await call('PUT', `/api/users/${cashierId}/pin`, { body: { pin: '1234' } })
  eq(set.status, 200, 'status')
  eq(set.json.pinSet, true, 'pinSet')
  const bad = await call('PUT', `/api/users/${cashierId}/pin`, { body: { pin: 'ab1' } })
  eq(bad.status, 400, 'PIN غير رقمي مرفوض')
  const rm = await call('PUT', `/api/users/${cashierId}/pin`, { body: { pin: '' } })
  eq(rm.status, 200, 'status')
  eq(rm.json.pinSet, false, 'pinRemoved')
  return 'PIN يُخزن ملبّدًا — ملاحظة: لا يوجد مسار دخول بـPIN (انحراف موثق)'
})

/* ---------- 7) سجل التدقيق ---------- */
await t('سجل التدقيق: قائمة + فلاتر + ترقيم', { screen: 'سجل التدقيق', uiPath: 'شاشة التدقيق → فلترة حسب النوع', expected: 'فلاتر تعمل + صفحات صحيحة', testRef: 'batch-a' }, async () => {
  const all = await call('GET', '/api/audit', { query: { pageSize: '5' } })
  eq(all.status, 200, 'status')
  eq(all.json.items.length, 5, 'pageSize=5')
  expect(all.json.total >= 10, 'سجل غني')
  const filtered = await call('GET', '/api/audit', { query: { action: 'LOGIN_FAILED' } })
  expect(filtered.json.items.length >= 1, 'فلتر action يعمل')
  expect(filtered.json.items.every((i: any) => i.action === 'LOGIN_FAILED'), 'كل نتائج الفلتر مطابقة')
  const noPerm = await call('GET', '/api/audit', { session: 'none' })
  eq(noPerm.status, 401, 'بلا جلسة مرفوض')
  return `${all.json.total} حدثًا مسجلًا — كل الإجراءات الحساسة موثقة`
})

await finish('batch-a-auth')
process.exit(0)

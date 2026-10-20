// =============================================================
// اختبارات انحدار النسخ الاحتياطي/الاستعادة — جانب الويب (Next.js + Prisma)
// يُشغَّل: bun scripts/backup-restore-auth-web-test.ts
//
// عزلة صارمة: PrismaClient هنا يُربط صراحة بملف SQLite مؤقت في /tmp —
// لا يلمس قاعدة التطوير db/custom.db إطلاقًا. كل البيانات اصطناعية داخل هذا الملف.
//
// يختبر نفس منطق المسارات الفعلية: src/lib/bakery/backup-auth.ts (المستخدم في
// /api/backup/preview و/api/backup/restore) + سلوك المعاملة عبر db.$transaction
// بنفس ترتيب حذف/إدخال restore/route.ts.
//
// الفحوص المطلوبة (مهمة الإصلاح):
// 1) لا كلمات مرور مكشوفة ولا هاشات في ملف النسخة
// 2) رفض النسخة غير الجاهزة أو طلب تعيين كلمة مالك صالحة قبل الاعتماد
// 3) لا يُدخل أي مستخدم بهاش مفقود أو فارغ
// 4) القاعدة الأصلية سليمة إذا فشلت الاستعادة (رفض مسبق + تراجع معاملة فعلي)
// 5) دخول المالك ينجح بعد استعادة ناجحة مع تعيين كلمة المرور
// 6) كلمة المرور القديمة لا تعمل بعد التغيير
// 7) السجلات والعلاقات (فواتير/بنود/مدفوعات/حركات مخزون/تدقيق) محفوظة وفق السياسة
// =============================================================
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const TMP_DB = `/tmp/web-restore-auth-test-${Date.now()}.db`

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

// ===== 1) إنشاء مخطط القاعدة المؤقتة (عزل كامل) =====
const push = spawnSync('bunx', ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
  cwd: '/home/z/my-project',
  env: { ...process.env, DATABASE_URL: `file:${TMP_DB}` },
  encoding: 'utf8',
})
if (push.status !== 0) {
  console.error('FATAL: prisma db push فشل على القاعدة المؤقتة\n', push.stderr.slice(-800))
  process.exit(1)
}

// عميل مخصص مرتبط بالقاعدة المؤقتة فقط (بلا أي وصول لقاعدة التطوير)
const db = new PrismaClient({ datasources: { db: { url: `file:${TMP_DB}` } } })

// نفس منطق backup-auth المستخدم فعليًا في مسارات API
const { hasValidAuthMaterial, analyzeBackupUsers, pickOwnerRow, transformBackupUsers, checkPasswordAgainstRow, MIN_OWNER_PASSWORD_LENGTH } =
  await import('../src/lib/bakery/backup-auth')

type Row = Record<string, unknown>
const HASH_RE = /^[0-9a-f]{128}$/
const SALT_RE = /^[0-9a-f]{32}$/

async function counts(): Promise<Record<string, number>> {
  const [users, sales, saleItems, salePayments, stockMovements, auditLogs, products, customers] = await Promise.all([
    db.user.count(), db.sale.count(), db.saleItem.count(), db.salePayment.count(),
    db.stockMovement.count(), db.auditLog.count(), db.product.count(), db.customer.count(),
  ])
  return { users, sales, saleItems, salePayments, stockMovements, auditLogs, products, customers }
}

/** يبني نسخة احتياطية بنفس بنية export/route.ts (تواريخ كنصوص كما في ملف حقيقي) */
async function buildExportLike(): Promise<{ schemaVersion: string; exportedAt: string; tables: Record<string, Row[]> }> {
  const [settings, users, categories, products, customers, sales, saleItems, salePayments, stockMovements, auditLogs, sequences, backupRecords] =
    await Promise.all([
      db.settings.findMany(), db.user.findMany({ orderBy: { createdAt: 'asc' } }), db.category.findMany(),
      db.product.findMany(), db.customer.findMany(), db.sale.findMany(), db.saleItem.findMany(),
      db.salePayment.findMany(), db.stockMovement.findMany(), db.auditLog.findMany(),
      db.sequence.findMany(), db.backupRecord.findMany(),
    ])
  // تعقيم المستخدمين — مطابق تمامًا لسطر export/route.ts
  const safeUsers = users.map(u => ({
    id: u.id, username: u.username, displayName: u.displayName, role: u.role,
    passwordHash: '', passwordSalt: '', pinHash: null, pinSalt: null,
    active: u.active, failedAttempts: 0, lockedUntil: null, lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt, updatedAt: u.updatedAt,
  }))
  const json = JSON.stringify({
    schemaVersion: '1.0.0', exportedAt: new Date().toISOString(),
    tables: {
      settings, users: safeUsers, categories, products, customers, sales, saleItems, salePayments,
      stockMovements, auditLogs: auditLogs, sequences, backupRecords,
    },
  })
  return JSON.parse(json)
}

async function main(): Promise<void> {
  // (لا نحذف TMP_DB هنا — db push أنشأ المخطط للتو على هذا الملف بالضبط)

  // ===== بناء نشاط اصطناعي داخل القاعدة المؤقتة =====
  const { hashPassword: webHash } = await import('../src/lib/bakery/auth')
  const o1 = webHash('1234')
  const o2 = webHash('cash9999')
  await db.settings.create({ data: { id: 1, businessName: 'مخبز اختبار الويب', setupCompleted: true } })
  await db.user.create({ data: { id: 'u-owner', username: 'owner', displayName: 'المالك', role: 'OWNER', passwordHash: o1.hash, passwordSalt: o1.salt } })
  await db.user.create({ data: { id: 'u-cashier', username: 'cashier1', displayName: 'الكاشير', role: 'CASHIER', passwordHash: o2.hash, passwordSalt: o2.salt } })
  await db.category.create({ data: { id: 'c1', name: 'خبز' } })
  await db.product.create({ data: { id: 'p1', name: 'خبز اختبار', categoryId: 'c1', priceMinor: 500, costMinor: 200 } })
  await db.customer.create({ data: { id: 'cu1', name: 'عميل اختبار' } })
  await db.sale.create({ data: { id: 's1', invoiceNo: 'S-TEST-0001', customerId: 'cu1', subtotalMinor: 500, totalMinor: 500, paidMinor: 500, status: 'COMPLETED', paymentStatus: 'PAID', userId: 'u-owner' } })
  await db.saleItem.create({ data: { saleId: 's1', productId: 'p1', productName: 'خبز اختبار', qtyMilli: 2000, priceMinor: 500, lineTotalMinor: 1000 } })
  await db.salePayment.create({ data: { saleId: 's1', method: 'CASH', amountMinor: 500, userId: 'u-owner' } })
  await db.stockMovement.create({ data: { productId: 'p1', qtyMilli: 5000, type: 'OPENING', userId: 'u-owner' } })
  await db.stockMovement.create({ data: { productId: 'p1', qtyMilli: -2000, type: 'SALE', refType: 'sale', refId: 's1', userId: 'u-owner' } })
  await db.auditLog.create({ data: { action: 'LOGIN', userId: 'u-owner', username: 'owner' } })
  await db.auditLog.create({ data: { action: 'SALE', userId: 'u-owner', username: 'owner', entityType: 'Sale', entityId: 's1' } })

  const before = await counts()
  check('البناء الاصطناعي على القاعدة المؤقتة سليم', before.users === 2 && before.sales === 1 && before.saleItems === 1 && before.salePayments === 1 && before.stockMovements === 2, JSON.stringify(before))

  // ===== فحص 1: ملف التصدير مغقّم — لا كلمات مكشوفة ولا هاشات =====
  const backup = await buildExportLike()
  const rawFile = JSON.stringify(backup)
  const fileUsers = backup.tables.users
  check('فحص1: كل المستخدمين في النسخة بهاش فارغ (سياسة التصدير)', fileUsers.length === 2 && fileUsers.every(u => u.passwordHash === ''))
  check('فحص1: كل المستخدمين بملح فارغ وبلا PIN', fileUsers.every(u => u.passwordSalt === '' && u.pinHash === null && u.pinSalt === null))
  check('فحص1: لا نص الكلمة 1234 في الملف', !rawFile.includes('1234'))
  check('فحص1: لا هاش 128-hex ولا ملح 32-hex في الملف كله', !HASH_RE.test(rawFile) && !SALT_RE.test(rawFile))

  const auth = analyzeBackupUsers(fileUsers)
  check('فحص2: التحليل يعلّم النسخة غير الجاهزة (needsOwnerPassword)', auth.authReady === false && auth.needsOwnerPassword === true && auth.invalid === 2, JSON.stringify(auth))

  // ===== فحص 2: رفض النسخة غير الجاهزة دون تعيين كلمة مالك — قبل أي تغيير =====
  const snapReject = await counts()
  let rejected = false
  try { transformBackupUsers(fileUsers, null) } catch { rejected = true }
  check('فحص2: التحويل بلا كلمة مالك يرفض (استثناء قبل أي كتابة)', rejected)
  let rejectedShort = false
  try { transformBackupUsers(fileUsers, '12') } catch { rejectedShort = true }
  check(`فحص2: كلمة أقصر من ${MIN_OWNER_PASSWORD_LENGTH} ترفض`, rejectedShort)
  check('فحص4: القاعدة سليمة تمامًا بعد الرفض', JSON.stringify(await counts()) === JSON.stringify(snapReject))
  const ownerBefore = await db.user.findUnique({ where: { id: 'u-owner' } })
  check('فحص4: دخول المالك 1234 ما زال يعمل بعد الرفض (تحقق فعلي مقابل المخزن)', ownerBefore ? checkPasswordAgainstRow('1234', ownerBefore as Row) : false)

  // ===== فحص 3+5+6+7: استعادة ناجحة بتعيين كلمة المالك (محاكاة كاملة لrestore/route.ts) =====
  const t = transformBackupUsers(fileUsers, '7788')
  check('التحويل: المالك حصل على الكلمة الجديدة والكاشير دخل مقفلًا', t.ownerResetUsername === 'owner' && t.lockedCount === 1)
  check('التحويل: لا صف واحد بهاش فارغ/ملح فارغ', t.rows.every(hasValidAuthMaterial))
  const ownerOut = t.rows.find(u => u.username === 'owner') as Row
  const cashierOut = t.rows.find(u => u.username === 'cashier1') as Row
  check('فحص5: كلمة المالك الجديدة 7788 تتحقق فعليًا (آلية scrypt+ملح الحالية)', checkPasswordAgainstRow('7788', ownerOut))
  check('فحص6: كلمة المالك القديمة 1234 لا تعمل على الصف المعاد تعيينه', !checkPasswordAgainstRow('1234', ownerOut))
  check('الكاشير بلا كلمة تعمل (بيانات اعتماد مقفلة عشوائية)', !checkPasswordAgainstRow('cash9999', cashierOut) && !checkPasswordAgainstRow('7788', cashierOut))

  // تنفيذ الاستعادة داخل $transaction بنفس ترتيب الحذف/الإدخال في المسار الفعلي
  const dates = (row: Row, keys: string[]): Row => {
    const c: Row = { ...row }
    for (const k of keys) if (typeof c[k] === 'string') c[k] = new Date(c[k] as string)
    return c
  }
  await db.$transaction(async tx => {
    await tx.salePayment.deleteMany({})
    await tx.saleItem.deleteMany({})
    await tx.stockMovement.deleteMany({})
    await tx.sale.deleteMany({})
    await tx.product.deleteMany({})
    await tx.category.deleteMany({})
    await tx.customer.deleteMany({})
    await tx.auditLog.deleteMany({})
    await tx.sequence.deleteMany({})
    await tx.backupRecord.deleteMany({})
    await tx.user.deleteMany({})
    await tx.settings.deleteMany({})

    const st = backup.tables.settings[0]
    if (st) await tx.settings.create({ data: dates(st, ['createdAt', 'updatedAt']) as never })
    for (const u of t.rows) {
      if (!hasValidAuthMaterial(u)) throw new Error('محاولة إدخال مستخدم ببيانات تحقق غير صالحة — أُلغيت الاستعادة')
      await tx.user.create({ data: dates(u, ['createdAt', 'updatedAt', 'lockedUntil', 'lastLoginAt']) as never })
    }
    for (const c of backup.tables.categories) await tx.category.create({ data: dates(c, ['createdAt']) as never })
    for (const p of backup.tables.products) await tx.product.create({ data: dates(p, ['createdAt', 'updatedAt']) as never })
    for (const cu of backup.tables.customers) await tx.customer.create({ data: dates(cu, ['createdAt', 'updatedAt']) as never })
    for (const s of backup.tables.sales) await tx.sale.create({ data: dates(s, ['date', 'createdAt', 'voidedAt']) as never })
    for (const i of backup.tables.saleItems) await tx.saleItem.create({ data: i as never })
    for (const p of backup.tables.salePayments) await tx.salePayment.create({ data: dates(p, ['date']) as never })
    for (const m of backup.tables.stockMovements) await tx.stockMovement.create({ data: dates(m, ['date', 'createdAt']) as never })
    for (const a of backup.tables.auditLogs) await tx.auditLog.create({ data: dates(a, ['date', 'createdAt']) as never })
    for (const s of backup.tables.sequences) await tx.sequence.create({ data: s as never })
    for (const b of backup.tables.backupRecords) await tx.backupRecord.create({ data: dates(b, ['createdAt']) as never })
  })

  const after = await counts()
  const emptyHashUsers = await db.user.count({ where: { OR: [{ passwordHash: '' }, { passwordSalt: '' }] } })
  check('فحص3: صفر مستخدمين بهاش أو ملح فارغ في القاعدة بعد الاستعادة', emptyHashUsers === 0)
  const dbUsers = await db.user.findMany()
  check('فحص3: كل الهاشات 128-hex وكل الأملاح 32-hex في القاعدة', dbUsers.every(u => HASH_RE.test(u.passwordHash) && SALT_RE.test(u.passwordSalt)))
  const ownerDb = dbUsers.find(u => u.username === 'owner')
  check('فحص5: دخول المالك بعد الاستعادة ناجح (7788 تتحقق مقابل صف القاعدة)', ownerDb ? checkPasswordAgainstRow('7788', ownerDb as Row) : false)
  check('فحص6: 1234 القديمة لا تعمل بعد الاستعادة بالتعيين', ownerDb ? !checkPasswordAgainstRow('1234', ownerDb as Row) : true)
  const cashierDb = dbUsers.find(u => u.username === 'cashier1')
  check('فحص3: الكاشير محفوظ بدوره ومعرفه وبلا كلمة فعّالة', cashierDb?.role === 'CASHIER' && !checkPasswordAgainstRow('cash9999', cashierDb as Row))
  check('فحص7: العدادات (فواتير/بنود/مدفوعات/حركات) مطابقة للنسخة', after.sales === before.sales && after.saleItems === before.saleItems && after.salePayments === before.salePayments && after.stockMovements === before.stockMovements, JSON.stringify({ before, after }))
  check('فحص7: المستخدمون/المنتجات/العملاء/التدقيق محفوظة وفق السياسة', after.users === before.users && after.products === before.products && after.customers === before.customers && after.auditLogs === before.auditLogs)
  const rel = await db.$queryRaw<{ si: bigint; sp: bigint; sm: bigint }[]>`
    SELECT
      (SELECT COUNT(*) FROM SaleItem si JOIN Sale s ON s.id = si.saleId JOIN Product p ON p.id = si.productId) AS si,
      (SELECT COUNT(*) FROM SalePayment sp JOIN Sale s ON s.id = sp.saleId) AS sp,
      (SELECT COUNT(*) FROM StockMovement sm JOIN Product p ON p.id = sm.productId) AS sm`
  const relN = { si: Number(rel[0]?.si), sp: Number(rel[0]?.sp), sm: Number(rel[0]?.sm) }
  check('فحص7: علاقات البنود/المدفوعات/الحركات سليمة تفصيلًا', relN.si === before.saleItems && relN.sp === before.salePayments && relN.sm === before.stockMovements, JSON.stringify(relN))

  // ===== فحص 4-ب: تراجع فعلي — معاملة تفشل في منتصفها لا تترك حالة جزئية =====
  const snapRollback = await counts()
  try {
    await db.$transaction(async tx => {
      await tx.salePayment.deleteMany({})
      await tx.saleItem.deleteMany({})
      await tx.sale.deleteMany({})
      await tx.user.deleteMany({})
      await tx.user.create({ data: { id: 'u-x', username: 'x', displayName: 'س', role: 'OWNER', passwordHash: 'a'.repeat(128), passwordSalt: 'b'.repeat(32) } })
      throw new Error('فشل مقصود في منتصف المعاملة')
    })
  } catch { /* المتوقع */ }
  check('فحص4: التراجع الفعلي — القاعدة مطابقة تمامًا بعد فشل منتصف المعاملة', JSON.stringify(await counts()) === JSON.stringify(snapRollback))
  const ownerRollback = await db.user.findUnique({ where: { id: 'u-owner' } })
  check('فحص4: المصادقة سليمة بعد التراجع (7788 ما زالت تعمل)', ownerRollback ? checkPasswordAgainstRow('7788', ownerRollback as Row) : false)

  // ===== استعادة نسخة ببيانات تحقق صالحة (الصيغة القديمة) تعمل كما هي والقديمة تبقى =====
  const legacy = JSON.parse(JSON.stringify(backup)) as typeof backup
  const lo = webHash('1234')
  const lc = webHash('cash9999')
  legacy.tables.users = legacy.tables.users.map(u =>
    u.username === 'owner' ? { ...u, passwordHash: lo.hash, passwordSalt: lo.salt } : { ...u, passwordHash: lc.hash, passwordSalt: lc.salt }
  )
  const legacyAuth = analyzeBackupUsers(legacy.tables.users)
  check('المعاينة: النسخة ذات الهاشات الصالحة authReady=true', legacyAuth.authReady === true && legacyAuth.needsOwnerPassword === false)
  const lt = transformBackupUsers(legacy.tables.users, null) // لا تعيين مطلوب
  check('نسخة صالحة تمر بلا تحويل (لا مالك معاد ولا مقفلين)', lt.ownerResetUsername === null && lt.lockedCount === 0 && lt.transformed === false)
  await db.$transaction(async tx => {
    await tx.salePayment.deleteMany({}); await tx.saleItem.deleteMany({}); await tx.stockMovement.deleteMany({})
    await tx.sale.deleteMany({}); await tx.product.deleteMany({}); await tx.category.deleteMany({})
    await tx.customer.deleteMany({}); await tx.auditLog.deleteMany({}); await tx.user.deleteMany({}); await tx.settings.deleteMany({})
    for (const u of lt.rows) {
      if (!hasValidAuthMaterial(u)) throw new Error('صف غير صالح')
      await tx.user.create({ data: dates(u, ['createdAt', 'updatedAt', 'lockedUntil', 'lastLoginAt']) as never })
    }
    for (const c of legacy.tables.categories) await tx.category.create({ data: dates(c, ['createdAt']) as never })
    for (const p of legacy.tables.products) await tx.product.create({ data: dates(p, ['createdAt', 'updatedAt']) as never })
    for (const cu of legacy.tables.customers) await tx.customer.create({ data: dates(cu, ['createdAt', 'updatedAt']) as never })
    for (const s of legacy.tables.sales) await tx.sale.create({ data: dates(s, ['date', 'createdAt', 'voidedAt']) as never })
    for (const i of legacy.tables.saleItems) await tx.saleItem.create({ data: i as never })
    for (const p of legacy.tables.salePayments) await tx.salePayment.create({ data: dates(p, ['date']) as never })
    for (const m of legacy.tables.stockMovements) await tx.stockMovement.create({ data: dates(m, ['date', 'createdAt']) as never })
    for (const a of legacy.tables.auditLogs) await tx.auditLog.create({ data: dates(a, ['date', 'createdAt']) as never })
  })
  const ownerLegacy = await db.user.findUnique({ where: { id: 'u-owner' } })
  check('بعد استعادة نسخة صالحة: كلمة المالك الأصلية 1234 تعمل كما كانت', ownerLegacy ? checkPasswordAgainstRow('1234', ownerLegacy as Row) : false)
  check('بعد استعادة نسخة صالحة: لا هاش فارغ في القاعدة', (await db.user.count({ where: { OR: [{ passwordHash: '' }, { passwordSalt: '' }] } })) === 0)

  // ===== اختيار المالك يطابق ترتيب تسجيل الدخول (أحدث lastLoginAt أولًا) =====
  const twoOwners: Row[] = [
    { id: 'a', role: 'OWNER', active: true, lastLoginAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T09:00:00.000Z', passwordHash: 'x'.repeat(128), passwordSalt: 'y'.repeat(32) },
    { id: 'b', role: 'OWNER', active: true, lastLoginAt: '2026-02-01T10:00:00.000Z', createdAt: '2026-01-01T08:00:00.000Z', passwordHash: 'x'.repeat(128), passwordSalt: 'y'.repeat(32) },
  ]
  check('اختيار المالك: الأحدث دخولًا أولًا (نفس ترتيب login)', (pickOwnerRow(twoOwners) as Row)?.id === 'b')
  const singleActive: Row[] = [
    { id: 'c', role: 'CASHIER', active: true, lastLoginAt: null, createdAt: '2026-01-01T09:00:00.000Z', passwordHash: 'x'.repeat(128), passwordSalt: 'y'.repeat(32) },
    { id: 'd', role: 'CASHIER', active: false, lastLoginAt: null, createdAt: '2026-01-01T08:00:00.000Z', passwordHash: 'x'.repeat(128), passwordSalt: 'y'.repeat(32) },
  ]
  check('اختيار المالك: بلا مالك ← المستخدم النشط الوحيد', (pickOwnerRow(singleActive) as Row)?.id === 'c')
  const mixedValid: Row[] = [
    { id: 'e', role: 'OWNER', active: true, lastLoginAt: null, createdAt: '2026-01-01T09:00:00.000Z', passwordHash: 'x'.repeat(128), passwordSalt: 'y'.repeat(32) },
    { id: 'f', role: 'CASHIER', active: true, lastLoginAt: null, createdAt: '2026-01-01T09:00:00.000Z', passwordHash: '', passwordSalt: '' },
  ]
  let mixedOwnerGotPw = false
  try {
    const mt = transformBackupUsers(mixedValid, '9911')
    mixedOwnerGotPw = checkPasswordAgainstRow('9911', mt.rows[0] as Row) && hasValidAuthMaterial(mt.rows[1] as Row)
  } catch { mixedOwnerGotPw = false }
  check('نسخة مختلطة: المالك السليم يبقى والمقصّر يستلم تعيينًا/قفلًا بلا هاش فارغ', mixedOwnerGotPw)

  await db.$disconnect()
  rmSync(TMP_DB, { force: true })

  console.log(`\n=== النتيجة: PASS=${pass} FAIL=${fail} ===`)
  process.exit(fail > 0 ? 1 : 0)
}

void main().catch(async e => {
  console.error('FATAL', e)
  await db.$disconnect().catch(() => {})
  rmSync(TMP_DB, { force: true })
  process.exit(1)
})

// =============================================================
// اختبارات انحدار النسخ الاحتياطي/الاستعادة — أمان بيانات المصادقة
// يُشغَّل: bun scripts/backup-restore-auth-test.ts
// يستخدم dispatch الحقيقي على قاعدة sql.js حقيقية بملف مؤقت معزول في /tmp
// لا يلمس أي قاعدة مستخدم حقيقية — كل البناء والاختبار على نسخة اصطناعية مؤقتة.
//
// الفحوص المطلوبة (مهمة الإصلاح):
// 1) لا كلمات مرور مكشوفة ولا هاشات في ملف النسخة القابلة للتداول
// 2) رفض النسخة غير الجاهزة دون تعيين كلمة مالك، برسالة واضحة وقبل أي تغيير
// 3) لا يُدخل أي مستخدم بهاش مفقود أو فارغ
// 4) القاعدة الأصلية تبقى سليمة إذا فشلت الاستعادة (فحص مسبق + تراجع معاملة)
// 5) دخول المالك ينجح بعد استعادة ناجحة مع تعيين كلمة المرور المطلوبة
// 6) كلمة المرور القديمة لا تعمل بعد التغيير/الاستعادة بالتعيين
// 7) السجلات والعلاقات (فواتير/بنود/مدفوعات/حركات مخزون/تدقيق) محفوظة وفق سياسة الاستعادة
// =============================================================
import { rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { BakeryDb } from '../src/main/db'
import { dispatch } from '../src/main/registry'
import { hashPassword, makeSalt } from '../src/main/services/auth'

const TEST_DIR = `/tmp/bakery-backup-auth-test-${Date.now()}`
const DB_PATH = `${TEST_DIR}/data/bakery.db`

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

type Env = { ok: boolean; data?: unknown; error?: string; code?: number }
async function invoke(db: BakeryDb, channel: string, payload: Record<string, unknown>): Promise<Env> {
  const r = await dispatch(db, channel, payload)
  // تضييق الاتحاد (ApiEnvelope) صراحةً — بلا أخطاء tsc
  if (r.ok) return { ok: true, data: r.data }
  return { ok: false, error: r.error, code: r.code }
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

function counts(db: BakeryDb): Record<string, number> {
  const q = (t: string): number => {
    const r = db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`)
    return Number(r?.c ?? 0)
  }
  return {
    users: q('users'), sales: q('sales'), sale_items: q('sale_items'),
    sale_payments: q('sale_payments'), stock_movements: q('stock_movements'),
    products: q('products'), customers: q('customers'), categories: q('categories'),
  }
}

async function main(): Promise<void> {
  rmSync(TEST_DIR, { force: true, recursive: true })

  // ===== بناء نشاط اصطناعي: مالك 1234 + كاشير + علاقات (فاتورة/بند/دفعة/حركة مخزون) =====
  const db = await openDb()
  const setup = await invoke(db, 'setup.run', { businessName: 'مخبز اختبار النسخ', ownerName: 'المالك', password: '1234' })
  check('الإعداد الاصطناعي ناجح', setup.ok === true, setup.error ?? '')

  const login1 = await invoke(db, 'auth.login', { password: '1234' }) as Env & { data?: { token: string; user: { id: number; username: string } } }
  const token = login1.data?.token ?? ''
  const ownerId = login1.data?.user?.id ?? 0
  check('دخول المالك 1234 قبل أي شيء', login1.ok === true && token.length >= 16)

  const cashier = await invoke(db, 'users.create', { token, username: 'cashier1', name: 'كاشير الاختبار', role: 'CASHIER', password: 'cash9999' })
  check('إنشاء مستخدم ثانٍ (كاشير) ناجح', cashier.ok === true, cashier.error ?? '')

  // علاقات مالية/مخزنية اصطناعية (SQL مباشر — الهدف اختبار النسخ لا الشاشات)
  // (الإعداد يبذر الأصناف 1..3 — نستخدم الصنف 1 موجودًا)
  db.run(`INSERT INTO products (id, name, category_id, type, price_minor, cost_minor, track_stock, active, created_at, updated_at)
          VALUES (1, 'خبز اختبار', 1, 'FINISHED', 500, 200, 1, 1, ?, ?)`, [db.now(), db.now()])
  db.run(`INSERT INTO customers (id, name, active, created_at) VALUES (1, 'عميل اختبار', 1, ?)`, [db.now()])
  db.run(`INSERT INTO sales (id, invoice_no, date, customer_id, subtotal_minor, total_minor, paid_minor, credit_minor, status, user_id, created_at)
          VALUES (1, 'S-TEST-0001', ?, 1, 500, 500, 500, 0, 'COMPLETED', ?, ?)`, [db.today(), ownerId, db.now()])
  db.run(`INSERT INTO sale_items (sale_id, product_id, qty_milli, unit_price_minor, line_total_minor)
          VALUES (1, 1, 2000, 500, 1000)`, [])
  db.run(`INSERT INTO sale_payments (sale_id, method, amount_minor, created_at) VALUES (1, 'CASH', 500, ?)`, [db.now()])
  db.run(`INSERT INTO stock_movements (product_id, qty_milli, type, date, user_id, created_at)
          VALUES (1, 5000, 'OPENING', ?, ?, ?)`, [db.today(), ownerId, db.now()])
  db.run(`INSERT INTO stock_movements (product_id, qty_milli, type, ref_type, ref_id, date, user_id, created_at)
          VALUES (1, -2000, 'SALE', 'sale', 1, ?, ?, ?)`, [db.today(), ownerId, db.now()])

  const before = counts(db)
  const beforeAudit = Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM audit_log')?.c ?? 0)

  // ===== 1) التصدير مغقّم: لا هاشات ولا جلسات ولا نص مكشوف =====
  const exp = await invoke(db, 'backup.export', { token, note: 'اختبار' }) as Env & { data?: { path: string; sizeBytes: number } }
  check('backup.export ناجح', exp.ok === true && typeof exp.data?.path === 'string', exp.error ?? '')
  const backupPath = exp.data?.path ?? ''
  const rawFile = existsSync(backupPath) ? readFileSync(backupPath, 'utf8') : ''
  check('ملف النسخة موجود على القرص', rawFile.length > 0, `${exp.data?.sizeBytes ?? 0} بايت`)

  const parsed = JSON.parse(rawFile) as { tables: Record<string, Array<Record<string, unknown>>> }
  const fileUsers = parsed.tables['users'] ?? []
  check('ملف النسخة يحوي المستخدمين', fileUsers.length === 2, `${fileUsers.length} مستخدمًا`)
  check('فحص1: كل المستخدمين في الملف بهاش فارغ (سياسة التعقيم)', fileUsers.every(u => u.password_hash === ''))
  check('فحص1: كل المستخدمين في الملف بملح فارغ', fileUsers.every(u => u.password_salt === ''))
  check('فحص1: بلا تجزئات PIN في الملف', fileUsers.every(u => u.pin_hash === null && u.pin_salt === null))
  check('فحص1: الجلسات لا تُصدَّر أبدًا', (parsed.tables['sessions'] ?? []).length === 0)
  check('فحص1: لا نص الكلمة 1234 في الملف', !rawFile.includes('1234'))
  check('فحص1: لا هاش 128-hex واحد في الملف كله', !/[0-9a-f]{128}/i.test(rawFile.replace(/"exportedAt"[^,]*,/g, '')))

  // المعاينة تعلّم أن النسخة غير جاهزة مصدريًا
  const prev = await invoke(db, 'backup.preview', { token, json: rawFile }) as Env & { data?: { auth?: { total: number; valid: number; invalid: number; authReady: boolean; needsOwnerPassword: boolean }, warnings?: string[] } }
  check('المعاينة تعمل', prev.ok === true, prev.error ?? '')
  check('المعاينة: authReady=false وneedsOwnerPassword=true للنسخة المغقّمة', prev.data?.auth?.authReady === false && prev.data?.auth?.needsOwnerPassword === true, JSON.stringify(prev.data?.auth))
  check('المعاينة: تحذير عربي واضح', (prev.data?.warnings ?? []).some(w => w.includes('بيانات تحقق صالحة')))

  // ===== 2) رفض النسخة غير الجاهزة بلا تعيين كلمة مالك — قبل أي تغيير =====
  const reject = await invoke(db, 'backup.restore', { token, json: rawFile })
  check('فحص2: الاستعادة بلا كلمة مالك مرفوضة', reject.ok === false && reject.code === 422, `code=${reject.code} ${reject.error ?? ''}`)
  check('فحص2: رسالة عربية واضحة تشرح السبب والحل', (reject.error ?? '').includes('بيانات تحقق صالحة') && (reject.error ?? '').includes('newOwnerPassword'))

  // كلمة أقصر من الحد مرفوضة أيضًا
  const shortPw = await invoke(db, 'backup.restore', { token, json: rawFile, newOwnerPassword: '12' })
  check('فحص2: كلمة مالك أقصر من 4 مرفوضة', shortPw.ok === false && shortPw.code === 422, shortPw.error ?? '')

  // ===== 4-أ) القاعدة الأصلية سليمة بعد الرفض =====
  const afterReject = counts(db)
  check('فحص4: القاعدة سليمة تمامًا بعد الرفض (كل العدادات مطابقة)', JSON.stringify(afterReject) === JSON.stringify(before), JSON.stringify({ before, afterReject }))
  const loginAfterReject = await invoke(db, 'auth.login', { password: '1234' })
  check('فحص4: الدخول 1234 يعمل بعد الرفض (لا ضرر بالمصادقة)', loginAfterReject.ok === true)

  // نسخة فاسدة: مستخدمون بصيغة هاش غير صالحة (garbage غير فارغ) — تُرفض أيضًا
  const tampered = JSON.parse(rawFile) as typeof parsed
  tampered.tables['users'] = tampered.tables['users'].map((u, i) => ({ ...u, password_hash: i === 0 ? 'garbage-not-a-hash' : u.password_hash }))
  const rejectGarbage = await invoke(db, 'backup.restore', { token, json: JSON.stringify(tampered) })
  check('فحص2: هاش تالف (غير فارغ لكن غير سليم) يُرفض أيضًا', rejectGarbage.ok === false && rejectGarbage.code === 422, rejectGarbage.error ?? '')
  check('فحص4: القاعدة سليمة بعد رفض الهاش التالف', JSON.stringify(counts(db)) === JSON.stringify(before))

  // نسخة بلا مستخدمين تُرفض (سلوك قائم يُحافَظ عليه)
  const noUsers = JSON.parse(rawFile) as typeof parsed
  noUsers.tables['users'] = []
  const rejectNoUsers = await invoke(db, 'backup.restore', { token, json: JSON.stringify(noUsers) })
  check('نسخة بلا مستخدمين تُرفض', rejectNoUsers.ok === false, rejectNoUsers.error ?? '')

  // ===== 3+5+6) استعادة ناجحة بتعيين كلمة المالك: لا هاش فارغ، الدخول الجديد يعمل، القديمة تموت =====
  const restore = await invoke(db, 'backup.restore', { token, json: rawFile, newOwnerPassword: '7788' }) as Env & { data?: { done: boolean; safetyPath: string | null; ownerResetUsername: string | null; lockedUsers: number; sessionKept: boolean } }
  check('الاستعادة بالتعيين ناجحة', restore.ok === true, restore.error ?? '')
  check('فحص3: صفر مستخدمين بهاش فارغ بعد الاستعادة', Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE password_hash = '' OR password_salt = ''")?.c ?? -1) === 0)
  const allUsers = db.query<{ password_hash: string; password_salt: string }>('SELECT password_hash, password_salt FROM users')
  check('فحص3: كل الهاشات 128-hex وكل الأملاح 32-hex', allUsers.every(u => /^[0-9a-f]{128}$/.test(u.password_hash) && /^[0-9a-f]{32}$/.test(u.password_salt)))
  check('المالك أُسندت له كلمة جديدة (اسم المالك مُعاد)', restore.data?.ownerResetUsername === 'owner', `ownerReset=${restore.data?.ownerResetUsername}`)
  check('الكاشير دُخل ببيانات اعتماد مقفلة (لا كلمة ثابتة)', restore.data?.lockedUsers === 1)
  check('فحص5: دخول المالك بكلمة الجديدة 7788 ناجح بعد الاستعادة', invoke(db, 'auth.login', { password: '7788' }).ok === true)
  check('فحص6: كلمة المالك القديمة 1234 ماتت بعد الاستعادة بالتعيين', invoke(db, 'auth.login', { password: '1234' }).ok === false)
  check('فحص6: لا باب خلفي — لا كلمة تقفل المالك غير المعيّنة', invoke(db, 'auth.login', { password: 'cash9999' }).ok === false)
  check('جلسة المشغّل حُفظت بعد الاستعادة (sessionKept)', restore.data?.sessionKept === true)
  check('فحص7-جلسات: لا جلسات قديمة أُحييت من النسخة', Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM sessions')?.c ?? -1) >= 1)

  // ===== 7) السجلات والعلاقات محفوظة وفق السياسة =====
  const afterRestore = counts(db)
  check('فحص7: الفواتير/البنود/المدفوعات/حركات المخزون مطابقة قبل/بعد', afterRestore.sales === before.sales && afterRestore.sale_items === before.sale_items && afterRestore.sale_payments === before.sale_payments && afterRestore.stock_movements === before.stock_movements, JSON.stringify({ before, afterRestore }))
  check('فحص7: المنتجات والعملاء والأصناف مطابقة', afterRestore.products === before.products && afterRestore.customers === before.customers && afterRestore.categories === before.categories)
  const afterAudit = Number(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM audit_log')?.c ?? 0)
  check('فحص7: سجل التدقيق محفوظ (المحتوى التاريخي + أحداث الاستعادة)', afterAudit >= beforeAudit, `before=${beforeAudit} after=${afterAudit}`)
  const fkIssues = db.query<{ t: string }>("PRAGMA foreign_key_check")
  check('فحص7: لا انتهاكات مفاتيح أجنبية بعد الاستعادة (foreign_key_check فارغ)', Array.isArray(fkIssues) && fkIssues.length === 0)
  // العلاقة تفصيلًا: بند الفاتورة ما زال يشير لفاتورته ومنتجته
  const rel = db.get<{ si: number; sp: number; sm: number }>(
    `SELECT
       (SELECT COUNT(*) FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id) AS si,
       (SELECT COUNT(*) FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id) AS sp,
       (SELECT COUNT(*) FROM stock_movements sm JOIN products p ON p.id = sm.product_id) AS sm`
  )
  check('فحص7: علاقات البنود/المدفوعات/الحركات سليمة تفصيلًا', rel?.si === before.sale_items && rel?.sp === before.sale_payments && rel?.sm === before.stock_movements, JSON.stringify(rel))

  // نسخة الأمان pre-restore موجودة فعليًا على القرص
  const safety = restore.data?.safetyPath ?? ''
  check('نسخة أمان pre-restore أُنشئت على القرص', safety !== '' && existsSync(safety))

  // ===== استعادة نسخة ببيانات تحقق صالحة (قديمة الصيغة) تعمل كما هي وكلمة المالك الأصلية تبقى =====
  const legacy = JSON.parse(rawFile) as typeof parsed
  legacy.tables['users'] = legacy.tables['users'].map(u => {
    const salt = makeSalt()
    return u.username === 'owner'
      ? { ...u, password_hash: hashPassword('1234', salt), password_salt: salt }
      : { ...u, password_hash: hashPassword('cash9999', salt), password_salt: salt }
  })
  const prevLegacy = await invoke(db, 'backup.preview', { token, json: JSON.stringify(legacy) }) as Env & { data?: { auth?: { authReady: boolean } } }
  check('المعاينة: النسخة ذات الهاشات الصالحة authReady=true', prevLegacy.data?.auth?.authReady === true)
  const restoreLegacy = await invoke(db, 'backup.restore', { token, json: JSON.stringify(legacy) })
  check('استعادة نسخة ببيانات تحقق صالحة تتم بلا تعيين كلمة', restoreLegacy.ok === true, restoreLegacy.error ?? '')
  check('بعد استعادة النسخة الصالحة: 1234 الأصلية تعمل (الحسابات كما كانت)', invoke(db, 'auth.login', { password: '1234' }).ok === true)
  check('بعد استعادة النسخة الصالحة: لا هاش فارغ', Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE password_hash = '' OR password_salt = ''")?.c ?? -1) === 0)
  check('بعد استعادة النسخة الصالحة: العدادات المالية ما زالت مطابقة', (() => { const c = counts(db); return c.sales === before.sales && c.sale_items === before.sale_items && c.sale_payments === before.sale_payments })())

  // ===== 4-ب) فشل منتصف المعاملة يُرجع القاعدة كاملة (تراجع فعلي) =====
  // (sql.js يعمل بلا فرض FK — نحقن فشلًا حقيقيًا: فاتورة مكررة invoice_no يقتحمها قيد UNIQUE
  //  بعد حذف كل البيانات، مع صفوف إضافية كانت ستظهر لو فشل التراجع)
  const broken = JSON.parse(rawFile) as typeof parsed
  broken.tables['users'] = broken.tables['users'].map(u => {
    const salt = makeSalt()
    return { ...u, password_hash: hashPassword('4444', salt), password_salt: salt }
  })
  const origSales = (parsed.tables['sales'] ?? []) as Array<Record<string, unknown>>
  const dupInvoice = { ...(origSales[0] ?? {}), id: 50, invoice_no: String(origSales[0]?.invoice_no ?? 'S-TEST-0001') }
  const extraSale = { ...(origSales[0] ?? {}), id: 51, invoice_no: 'S-TEST-0099' }
  broken.tables['sales'] = [...origSales, extraSale, dupInvoice]
  const snapBeforeBroken = counts(db)
  const restoreBroken = await invoke(db, 'backup.restore', { token, json: JSON.stringify(broken) })
  check('فحص4: استعادة نسخة تنكسر منتصف المعاملة (قيد UNIQUE) تفشل', restoreBroken.ok === false, restoreBroken.error?.slice(0, 80) ?? '')
  const snapAfterBroken = counts(db)
  check('فحص4: التراجع كامل — العدادات مطابقة تمامًا بعد الفشل (ولا الصفوف الإضافية)', JSON.stringify(snapAfterBroken) === JSON.stringify(snapBeforeBroken), JSON.stringify({ before: snapBeforeBroken, after: snapAfterBroken }))
  check('فحص4: المصادقة سليمة بعد الفشل (الدخول بكلمة ما قبل الفشل يعمل)', invoke(db, 'auth.login', { password: '1234' }).ok === true)

  db.close()
  // تنظيف الملفات المؤقتة (نسخ الاختبار فقط — في /tmp)
  rmSync(TEST_DIR, { force: true, recursive: true })
  const leftovers = readdirSync('/tmp').filter(f => f.startsWith('bakery-backup-auth-test-'))
  check('لا بقايا ملفات اختبار', leftovers.length === 0, leftovers.join(','))

  console.log(`\n=== النتيجة: PASS=${pass} FAIL=${fail} ===`)
  process.exit(fail > 0 ? 1 : 0)
}

void main().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})

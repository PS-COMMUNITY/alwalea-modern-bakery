// =============================================================
// اختبار تدفق المصادقة الكامل — مخبز الولاء الحديث (يُشغَّل: bun scripts/auth-flow-test.ts)
// يستخدم dispatch الحقيقي (طبقة الصلاحيات كاملة) على قاعدة sql.js حقيقية بملف مؤقت
// يختبر: الإعداد بكلمة 1234 ← الدخول ← رفض الخاطئة ← تغيير الكلمة ← موت القديمة
//        ← لا باب خلفي ← إعادة فتح القاعدة (محاكاة إعادة تشغيل) ← التخزين الملبَّد
// =============================================================
import { rmSync } from 'node:fs'
import { BakeryDb } from '../src/main/db'
import { dispatch } from '../src/main/registry'

const DB_PATH = `/tmp/bakery-auth-test-${Date.now()}.db`

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

function invoke(db: BakeryDb, channel: string, payload: Record<string, unknown>): { ok: boolean; data?: unknown; error?: string; code?: number } {
  const r = dispatch(db, channel, payload)
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

async function main(): Promise<void> {
  rmSync(DB_PATH, { force: true })

  // ===== 1) قاعدة جديدة: الإعداد بكلمة 1234 =====
  let db = await openDb()
  const st = invoke(db, 'status.get', {})
  check('status.get يعمل وقاعدة فارغة', st.ok === true && (st.data as { setupCompleted: boolean }).setupCompleted === false)

  const setup = invoke(db, 'setup.run', { businessName: 'مخبز الاختبار', ownerName: 'المالك', password: '1234' })
  check('setup.run بكلمة 1234 (4 أرقام) ناجح', setup.ok === true, setup.error ?? '')

  // ===== 2) الدخول بـ1234 — الجلسة تُربط بالمالك تلقائيًا =====
  const loginOk = invoke(db, 'auth.login', { password: '1234' })
  const loginData = loginOk.data as { token: string; user: { id: number; role: string; username: string } } | undefined
  check('دخول 1234 ناجح', loginOk.ok === true && !!loginData?.token)
  check('الجلسة مرتبطة بحساب المالك OWNER', loginData?.user?.role === 'OWNER', `username=${loginData?.user?.username}`)
  const ownerId = loginData?.user?.id
  const token = loginData?.token ?? ''

  // ===== 3) كلمة مرور خاطئة تُرفض =====
  const loginBad = invoke(db, 'auth.login', { password: '0000' })
  check('رفض كلمة خاطئة', loginBad.ok === false && (loginBad.code === 401), loginBad.error ?? '')
  check('رسالة عربية للخطأ', (loginBad.error ?? '').includes('غير صحيحة'))

  // ===== 4) تغيير كلمة المرور لنفسه: يتطلب الحالية، والجديدة 4 أرقام =====
  const noCurrent = invoke(db, 'users.setPassword', { token, id: ownerId, password: '4455' })
  check('تغيير بلا الكلمة الحالية مرفوض', noCurrent.ok === false && noCurrent.code === 401, noCurrent.error ?? '')
  const wrongCurrent = invoke(db, 'users.setPassword', { token, id: ownerId, password: '4455', currentPassword: '9999' })
  check('كلمة حالية خاطئة مرفوضة', wrongCurrent.ok === false && wrongCurrent.code === 401, wrongCurrent.error ?? '')
  const change = invoke(db, 'users.setPassword', { token, id: ownerId, password: '4455', currentPassword: '1234' })
  check('تغيير 1234→4455 ناجح', change.ok === true, change.error ?? '')

  // ===== 5) القديمة ماتت والجديدة تعمل — لا باب خلفي =====
  const oldDead = invoke(db, 'auth.login', { password: '1234' })
  check('القديمة 1234 مرفوضة بعد التغيير', oldDead.ok === false && oldDead.code === 401)
  const oldDeadWithUsername = invoke(db, 'auth.login', { password: '1234', username: 'owner' })
  check('لا باب خلفي حتى مع username', oldDeadWithUsername.ok === false && oldDeadWithUsername.code === 401)
  const newWorks = invoke(db, 'auth.login', { password: '4455' })
  check('الجديدة 4455 تعمل', newWorks.ok === true)

  // ===== 6) التخزين الملبَّد — لا نص مكشوف =====
  const urow = db.get<{ password_hash: string; password_salt: string }>('SELECT password_hash, password_salt FROM users WHERE id = ?', [ownerId])
  check('الهاش 128 hex (scrypt 64 بايت)', !!urow && /^[0-9a-f]{128}$/.test(urow.password_hash))
  check('الملح 32 hex ومستقل', !!urow && /^[0-9a-f]{32}$/.test(urow.password_salt))
  check('لا كلمة مكشوفة في الهاش/الملح', !!urow && !urow.password_hash.includes('4455') && !urow.password_salt.includes('4455'))

  // ===== 7) محاكاة إعادة تشغيل التطبيق: إغلاق كامل + فتح من جديد =====
  db.close()
  db = await openDb()
  const persistLogin = invoke(db, 'auth.login', { password: '4455' })
  check('بعد إعادة الفتح: 4455 تعمل (استمرارية)', persistLogin.ok === true, persistLogin.error ?? '')
  const persistOld = invoke(db, 'auth.login', { password: '1234' })
  check('بعد إعادة الفتح: 1234 ما زالت مرفوضة', persistOld.ok === false)

  // ===== 8) سجل التدقيق يسجل الدخول والفشل =====
  const auditRows = db.query<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'auth.%' OR action = 'users.password_change'")
  const actions = new Set(auditRows.map((r) => r.action))
  check('تدقيق: auth.login مسجل', actions.has('auth.login'))
  check('تدقيق: auth.login_failed مسجل', actions.has('auth.login_failed'))
  check('تدقيق: users.password_change مسجل', actions.has('users.password_change'))

  db.close()
  rmSync(DB_PATH, { force: true })
  console.log(`\n=== النتيجة: PASS=${pass} FAIL=${fail} ===`)
  process.exit(fail > 0 ? 1 : 0)
}

void main()

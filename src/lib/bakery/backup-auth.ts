import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

/**
 * جاهزية بيانات المصادقة في النسخ الاحتياطية — منطق مشترك بين المعاينة والاستعادة.
 *
 * السياسة:
 * - النسخ الاحتياطية القابلة للتداول لا تحمل تجزئات كلمات المرور (تُصدَّر مغقّمة: hash/salt فارغان).
 * - لا يُدخل أي مستخدم إلى القاعدة بهاش أو ملح فارغ/غير صالح — أبدًا.
 * - نسخة بلا بيانات تحقق صالحة تُرفض، أو تُقبل فقط مع تعيين كلمة مرور جديدة للمالك
 *   عبر آلية المصادقة الحالية (scrypt N=16384,r=8,p=1 + ملح 16 بايت مستقل) قبل اعتماد أي تغيير.
 * - المستخدمون غير المالكين الذين تفتقر صفوفهم لبيانات تحقق صالحة يُدخلون ببيانات اعتماد
 *   عشوائية مقفلة (لا كلمة مرور تعمل عليها) — يحفظ الدور والمعرف والعلاقات، ويستطيع
 *   المدير ضبط كلمة مرورهم لاحقًا من شاشة المستخدمين.
 * - لا كلمة مرور افتراضية ثابتة ولا باب خلفي في أي حال.
 *
 * هذا الملف مقصودًا بلا أي استيراد من قاعدة البيانات أو Next — ليُختبر معزولًا.
 */

export type TableRow = Record<string, unknown>

/** scrypt 64 بايت hex ← 128 محرفًا، والملح 16 بايت hex ← 32 محرفًا (نفس معاملات آلية المصادقة الحالية) */
const HASH_HEX_LEN = 128
const SALT_HEX_LEN = 32
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 }

export const MIN_OWNER_PASSWORD_LENGTH = 4

const HEX_RE = /^[0-9a-fA-F]+$/

function hashPassword(password: string): { passwordHash: string; passwordSalt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64, SCRYPT_OPTS).toString('hex')
  return { passwordHash: hash, passwordSalt: salt }
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const test = scryptSync(password, salt, 64, SCRYPT_OPTS)
    const ref = Buffer.from(hash, 'hex')
    return test.length === ref.length && timingSafeEqual(test, ref)
  } catch {
    return false
  }
}

/** هل يحمل الصف بيانات تحقق صالحة البنية (هاش+ملح غير فارغين وبطول scrypt الصحيح)؟ */
export function hasValidAuthMaterial(u: TableRow): boolean {
  const hash = u.passwordHash
  const salt = u.passwordSalt
  return (
    typeof hash === 'string' && hash.length === HASH_HEX_LEN && HEX_RE.test(hash) &&
    typeof salt === 'string' && salt.length === SALT_HEX_LEN && HEX_RE.test(salt)
  )
}

function asDate(v: unknown): number {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (Number.isFinite(t)) return t
  }
  return 0
}

function isActive(u: TableRow): boolean {
  return u.active === true
}

/**
 * تحديد حساب المالك داخل صفوف النسخة — نفس ترتيب منطق تسجيل الدخول الحالي:
 * المالك النشط الأحدث دخولًا (ثم الأقدم إنشاءً)، وإلا المستخدم النشط الوحيد.
 */
export function pickOwnerRow(users: TableRow[]): TableRow | null {
  const owners = users.filter(u => u.role === 'OWNER' && isActive(u))
  if (owners.length > 0) {
    owners.sort((a, b) => {
      const d = asDate(b.lastLoginAt) - asDate(a.lastLoginAt)
      if (d !== 0) return d
      return asDate(a.createdAt) - asDate(b.createdAt)
    })
    return owners[0] ?? null
  }
  const actives = users.filter(isActive)
  return actives.length === 1 ? actives[0] ?? null : null
}

export type AuthReadiness = {
  total: number
  valid: number
  invalid: number
  /** هل كل المستخدمين يحملون بيانات تحقق صالحة (يمكن الاستعادة كما هي)؟ */
  authReady: boolean
  /** هل توجد أي صفوف بلا بيانات تحقق (تستلزم تعيين كلمة مالك أو رفضًا)؟ */
  needsOwnerPassword: boolean
}

export function analyzeBackupUsers(users: TableRow[]): AuthReadiness {
  const total = users.length
  const valid = users.filter(hasValidAuthMaterial).length
  return {
    total,
    valid,
    invalid: total - valid,
    authReady: total > 0 && valid === total,
    needsOwnerPassword: total > 0 && valid < total,
  }
}

/** توليد بيانات اعتماد عشوائية مقفلة: هاش scrypt لسرّ يُرمى فورًا — لا كلمة مرور تعمل عليه */
function lockedCredential(): { passwordHash: string; passwordSalt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(randomBytes(32).toString('hex'), salt, 64, SCRYPT_OPTS).toString('hex')
  return { passwordHash: hash, passwordSalt: salt }
}

export type UserTransformResult = {
  /** صفوف المستخدمين جاهزة الإدخال — كلها ببيانات تحقق صالحة */
  rows: TableRow[]
  /** اسم المستخدم المالك الذي أُسندت له كلمة المرور الجديدة (إن حصل) */
  ownerResetUsername: string | null
  /** عدد المستخدمين الذين أُدخلوا ببيانات اعتماد مقفلة (بلا كلمة تعمل) */
  lockedCount: number
  /** هل حُوِّلت أي صفوف أصلًا؟ */
  transformed: boolean
}

/**
 * تحويل صفوف المستخدمين إلى صفوف صالحة للإدخال:
 * - الصفوف الصالحة تمر كما هي (كلمات المرور القديمة تعمل لأصحابها).
 * - صف المالك غير الصالح يستلم كلمة المرور الجديدة بالتجزئة والملح الصحيحين.
 * - بقية الصفوف غير الصالحة تُدخل ببيانات اعتماد مقفلة عشوائية (لا كلمة ثابتة).
 * - فشل التحويل يرمي استثناء قبل أي كتابة.
 */
export function transformBackupUsers(users: TableRow[], newOwnerPassword: string | null): UserTransformResult {
  if (users.length === 0) throw new Error('النسخة لا تحتوي مستخدمين')

  const readiness = analyzeBackupUsers(users)
  if (!readiness.authReady) {
    if (typeof newOwnerPassword !== 'string' || newOwnerPassword.length < MIN_OWNER_PASSWORD_LENGTH) {
      throw new Error('بيانات المصادقة غير جاهزة في النسخة — يلزم تعيين كلمة مرور جديدة للمالك')
    }
  }

  const owner = readiness.authReady ? null : pickOwnerRow(users)
  if (!readiness.authReady && !owner) {
    throw new Error('تعذر تحديد حساب مالك في النسخة لتعيين كلمة المرور — أُلغيت الاستعادة')
  }

  let ownerResetUsername: string | null = null
  let lockedCount = 0

  const rows = users.map(u => {
    if (hasValidAuthMaterial(u)) return u

    const cred: { passwordHash: string; passwordSalt: string } = u === owner
      ? hashPassword(newOwnerPassword as string)
      : lockedCredential()
    if (u === owner) ownerResetUsername = typeof u.username === 'string' ? u.username : null
    else lockedCount++

    return {
      ...u,
      passwordHash: cred.passwordHash,
      passwordSalt: cred.passwordSalt,
      pinHash: null,
      pinSalt: null,
      failedAttempts: 0,
      lockedUntil: null,
    }
  })

  // دفاع أخير: لن يُعاد أي صف بهاش أو ملح فارغ
  for (const r of rows) {
    if (!hasValidAuthMaterial(r)) throw new Error('صف مستخدم ببيانات تحقق غير صالحة — أُلغيت الاستعادة دون أي تغيير')
  }

  return { rows, ownerResetUsername, lockedCount, transformed: ownerResetUsername !== null || lockedCount > 0 }
}

/** تحقق فعلي من كلمة مرور مقابل صف مستخدم (للاختبارات والتحقق اللاحق) */
export function checkPasswordAgainstRow(password: string, u: TableRow): boolean {
  const hash = u.passwordHash
  const salt = u.passwordSalt
  if (typeof hash !== 'string' || typeof salt !== 'string') return false
  return verifyPassword(password, hash, salt)
}

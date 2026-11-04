// =============================================================
// مخبز الولاء الحديث — النسخ الاحتياطي: تصدير JSON كامل بإصدار مخطط
// + فحص قبل الاستعادة + نسخة أمان قبل التطبيق
// + سياسة المصادقة: النسخ القابلة للتداول بلا تجزئات كلمات مرور،
//   والاستعادة لا تُدخل مستخدمًا ببيانات تحقق فارغة أبدًا (منع القفل التام)
// =============================================================
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { ApiError, reqStr } from '../validate'
import { SvcCtx } from './helpers'
import { hashPassword, makeSalt } from './auth'

const BACKUP_SCHEMA_VERSION = 1

// الجداول المصدَّرة بالترتيب (الآباء قبل الأبناء للاستعادة)
const TABLES: string[] = [
  'settings',
  'users',
  'sessions',
  'schema_migrations',
  'sequences',
  'categories',
  'products',
  'customers',
  'customer_ledger',
  'suppliers',
  'supplier_ledger',
  'sales',
  'sale_items',
  'sale_payments',
  'purchases',
  'purchase_items',
  'purchase_payments',
  'stock_movements',
  'recipes',
  'recipe_items',
  'production_batches',
  'expense_categories',
  'expenses',
  'shifts',
  'cash_movements',
  'distribution_reps',
  'distribution_routes',
  'distribution_trips',
  'trip_loads',
  'trip_sales',
  'trip_returns',
  'audit_log',
  'backup_records'
]

interface BackupFile {
  app: string
  schemaVersion: number
  exportedAt: string
  tables: Record<string, unknown[]>
}

type Row = Record<string, unknown>

// scrypt 64 بايت hex ← 128 محرفًا، والملح 16 بايت hex ← 32 محرفًا (نفس معاملات auth.ts)
const HASH_HEX_RE = /^[0-9a-fA-F]{128}$/
const SALT_HEX_RE = /^[0-9a-fA-F]{32}$/
const MIN_OWNER_PASSWORD_LENGTH = 4
const SESSION_HOURS = 24

/** تعقيم صف مستخدم للتصدير: بلا تجزئات كلمات مرور أو PIN — النسخ القابلة للتداول لا تحمل أسرارًا */
function sanitizeUserForExport(u: Row): Row {
  return {
    ...u,
    password_hash: '',
    password_salt: '',
    pin_hash: null,
    pin_salt: null,
    failed_attempts: 0,
    locked_until: null
  }
}

function backupsDir(ctx: SvcCtx): string {
  // مجلد النسخ بجانب قاعدة البيانات: userData/backups
  return path.join(path.dirname(ctx.db.filePath), '..', 'backups')
}

export function exportBackup(ctx: SvcCtx, payload: Record<string, unknown>, opts?: { auto?: boolean }): { path: string; sizeBytes: number; schemaVersion: number; exportedAt: string } {
  const note = optNote(payload)
  const data: BackupFile = {
    app: 'alwalea-modern-bakery',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: ctx.db.now(),
    tables: {}
  }
  for (const t of TABLES) {
    let rows: Row[] = ctx.db.query<Row>(`SELECT * FROM ${t}`)
    if (t === 'users') rows = rows.map(sanitizeUserForExport)
    if (t === 'sessions') rows = [] // الجلسات لا تُصدَّر أبدًا — رموز حية لا مكان لها في ملف قابل للتداول
    data.tables[t] = rows
  }
  const dir = backupsDir(ctx)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  // rc.8 (P0-2): النسخ التلقائية تحمل بادئة مميزة ليقصر عليها الدوران فقط — اليدوية بلا حد
  const prefix = opts?.auto ? AUTO_BACKUP_PREFIX : 'bakery-backup-'
  const file = path.join(dir, `${prefix}${stamp}.json`)
  fs.writeFileSync(file, JSON.stringify(data), 'utf8')
  const size = fs.statSync(file).size
  ctx.db.tx(() => {
    ctx.db.run('INSERT INTO backup_records (created_at, path, size_bytes, schema_version, note) VALUES (?, ?, ?, ?, ?)', [
      ctx.db.now(),
      file,
      size,
      BACKUP_SCHEMA_VERSION,
      note
    ])
    ctx.audit('backup.export', 'backup', null, { file, size })
  })
  return { path: file, sizeBytes: size, schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: data.exportedAt }
}

function optNote(payload: Record<string, unknown>): string | null {
  const v = payload.note
  if (typeof v !== 'string' || v.trim() === '') return null
  return v.trim().slice(0, 300)
}

export function listBackups(ctx: SvcCtx): unknown[] {
  return ctx.db.query('SELECT id, created_at, path, size_bytes, schema_version, note FROM backup_records ORDER BY id DESC LIMIT 100')
}

// =============================================================
// rc.10: النسخ التلقائي الدوري كل ساعتين (بجانب النسخ عند الإغلاق)
// - نفس آلية exportBackup المجرّبة — بلا منطق نسخ جديد
// - الدوران نفسه: آخر 14 نسخة تلقائية
// - autoBackupDue(): هل مرّت المدة منذ آخر نسخة تلقائية؟ (يبقى صحيحًا حتى بعد إعادة تشغيل)
// =============================================================
export const AUTO_BACKUP_INTERVAL_MINUTES = 120

function pruneAutoBackups(dir: string): void {
  try {
    const autos = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(AUTO_BACKUP_PREFIX) && f.endsWith('.json'))
      .sort()
    while (autos.length > AUTO_BACKUP_KEEP) {
      const oldest = autos.shift()
      if (oldest) {
        try {
          fs.unlinkSync(path.join(dir, oldest))
        } catch {
          // ملف محذوف/مقفل خارجيًا — لا يفشل الدورة
        }
      }
    }
  } catch {
    // فشل الدوران لا يفشل النسخ
  }
}

/** آلية النسخ التلقائي المشتركة (عند الإغلاق + الدورية) — لا ترمي أبدًا */
function runAutoBackup(ctx: SvcCtx, note: string): { ok: boolean; path?: string; error?: string } {
  const dir = backupsDir(ctx)
  try {
    const res = exportBackup(ctx, { note }, { auto: true })
    pruneAutoBackups(dir)
    appendAutoBackupLog(dir, `OK ${new Date().toISOString()} ${res.path} ${res.sizeBytes}B`)
    return { ok: true, path: res.path }
  } catch (e) {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
    appendAutoBackupLog(dir, `FAIL ${new Date().toISOString()} ${msg.replace(/\s+/g, ' ').slice(0, 500)}`)
    return { ok: false, error: msg }
  }
}

export function autoBackupOnQuit(ctx: SvcCtx): { ok: boolean; path?: string; error?: string } {
  return runAutoBackup(ctx, 'تلقائية عند الإغلاق')
}

/** النسخة الدورية (كل ساعتين — يحددها المجدول في main) */
export function autoBackupScheduled(ctx: SvcCtx): { ok: boolean; path?: string; error?: string } {
  return runAutoBackup(ctx, 'تلقائية دورية كل ساعتين')
}

/** هل حان وقت نسخة تلقائية؟ (لا نسخ موجودة أو مرّت المدة على الأخيرة) */
export function autoBackupDue(ctx: SvcCtx): boolean {
  const row = ctx.db.get<{ created_at: string }>(
    "SELECT created_at FROM backup_records WHERE note LIKE 'تلقائية%' ORDER BY id DESC LIMIT 1"
  )
  if (!row) return true
  const last = Date.parse(row.created_at)
  if (!Number.isFinite(last)) return true
  return Date.now() - last >= AUTO_BACKUP_INTERVAL_MINUTES * 60 * 1000
}

/** حالة النسخ التلقائي — تُعرض في اللوحة والإعدادات */
export function autoBackupStatus(ctx: SvcCtx): {
  intervalMinutes: number
  lastAutoAt: string | null
  lastAutoNote: string | null
  autoCount: number
  dirPath: string
  logTail: string[]
} {
  const dir = backupsDir(ctx)
  const last = ctx.db.get<{ created_at: string; note: string }>(
    "SELECT created_at, note FROM backup_records WHERE note LIKE 'تلقائية%' ORDER BY id DESC LIMIT 1"
  )
  const cnt = ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM backup_records WHERE note LIKE 'تلقائية%'")
  let logTail: string[] = []
  try {
    const raw = fs.readFileSync(path.join(dir, AUTO_BACKUP_LOG), 'utf8')
    logTail = raw.trim().split('\n').slice(-5)
  } catch {
    logTail = []
  }
  return {
    intervalMinutes: AUTO_BACKUP_INTERVAL_MINUTES,
    lastAutoAt: last?.created_at ?? null,
    lastAutoNote: last?.note ?? null,
    autoCount: Number(cnt?.c ?? 0),
    dirPath: dir,
    logTail
  }
}

// =============================================================
// rc.8 (P0-2): النسخ التلقائي عند إغلاق التطبيق
// يعيد استخدام exportBackup نفسها (الدالة المجرّبة 48 فحصًا) — لا منطق نسخ جديد.
// - دوران: تُحفظ آخر 14 نسخة تلقائية فقط (بادئة bakery-backup-auto-) — اليدوية لا تُمسّ.
// - لا ترمي أبدًا: الإغلاق يجب أن ينجح دائمًا — النسخ محاولة، وليست شرطًا.
// - كل نجاح/فشل يُسجل في ملف داخلي autobackup.log بجانب النسخ.
// =============================================================
const AUTO_BACKUP_PREFIX = 'bakery-backup-auto-'
const AUTO_BACKUP_KEEP = 14
const AUTO_BACKUP_LOG = 'autobackup.log'

function appendAutoBackupLog(dir: string, line: string): void {
  try {
    fs.appendFileSync(path.join(dir, AUTO_BACKUP_LOG), `${line}\n`, 'utf8')
  } catch {
    // حتى سجل الفشل نفسه لا يمنع الإغلاق أبدًا
  }
}

function parseBackup(json: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new ApiError('ملف النسخة ليس JSON صالحًا')
  }
  const b = parsed as Partial<BackupFile>
  if (!b || typeof b !== 'object' || b.app !== 'alwalea-modern-bakery' || typeof b.tables !== 'object' || b.tables === null) {
    throw new ApiError('الملف ليس نسخة احتياطية صالحة لهذا التطبيق')
  }
  if (b.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new ApiError(`إصدار مخطط النسخة (${String(b.schemaVersion)}) غير متوافق مع إصدار التطبيق (${BACKUP_SCHEMA_VERSION})`)
  }
  return b as BackupFile
}

// =============================================================
// جاهزية بيانات المصادقة في صفوف المستخدمين (snake_case — مخطط Electron)
// =============================================================

/** هل يحمل الصف بيانات تحقق صالحة البنية (هاش+ملح scrypt سليمانان)؟ */
function hasValidAuthMaterial(u: Row): boolean {
  const h = u.password_hash
  const s = u.password_salt
  return typeof h === 'string' && HASH_HEX_RE.test(h) && typeof s === 'string' && SALT_HEX_RE.test(s)
}

export type AuthReadiness = {
  total: number
  valid: number
  invalid: number
  authReady: boolean
  needsOwnerPassword: boolean
}

function analyzeUsers(users: Row[]): AuthReadiness {
  const total = users.length
  const valid = users.filter(hasValidAuthMaterial).length
  return {
    total,
    valid,
    invalid: total - valid,
    authReady: total > 0 && valid === total,
    needsOwnerPassword: total > 0 && valid < total
  }
}

/**
 * تحديد حساب المالك داخل صفوف النسخة — نفس ترتيب منطق تسجيل الدخول الحالي:
 * owner_user_id من إعدادات النسخة ← أقدم مالك نشط ← المستخدم النشط الوحيد.
 */
function pickOwnerRow(users: Row[], settingsRows: Row[]): Row | null {
  const ownerSettingRow = settingsRows.find(s => s.key === 'owner_user_id')
  const ownerSettingId = ownerSettingRow ? Number(ownerSettingRow.value) : NaN
  if (Number.isInteger(ownerSettingId)) {
    const bySetting = users.find(u => u.id === ownerSettingId && u.role === 'OWNER' && u.active === 1)
    if (bySetting) return bySetting
  }
  const owners = users.filter(u => u.role === 'OWNER' && u.active === 1).sort((a, b) => Number(a.id) - Number(b.id))
  if (owners.length > 0) return owners[0] ?? null
  const actives = users.filter(u => u.active === 1)
  return actives.length === 1 ? actives[0] ?? null : null
}

/** بيانات اعتماد عشوائية مقفلة: هاش scrypt لسرّ يُرمى فورًا — لا كلمة مرور تعمل عليه */
function lockedCredential(): { password_hash: string; password_salt: string } {
  const salt = makeSalt()
  return { password_hash: hashPassword(randomBytes(32).toString('hex'), salt), password_salt: salt }
}

type UserTransform = {
  rows: Row[]
  ownerResetUsername: string | null
  lockedCount: number
  authReady: boolean
}

/**
 * تحويل صفوف المستخدمين إلى صفوف صالحة للإدخال قبل أي كتابة:
 * - الصفوف الصالحة تمر كما هي (كلمات المرور القديمة تعمل لأصحابها).
 * - صف المالك غير الصالح يستلم كلمة المرور الجديدة بالتجزئة والملح الصحيحين (آلية المصادقة الحالية).
 * - بقية الصفوف غير الصالحة تُدخل ببيانات اعتماد مقفلة عشوائية — لا كلمة افتراضية ثابتة ولا باب خلفي.
 */
function transformUsers(users: Row[], settingsRows: Row[], newOwnerPassword: string | null): UserTransform {
  if (users.length === 0) throw new ApiError('النسخة لا تحتوي مستخدمين — رفض الاستعادة')
  const readiness = analyzeUsers(users)
  if (!readiness.authReady) {
    if (typeof newOwnerPassword !== 'string' || newOwnerPassword.length < MIN_OWNER_PASSWORD_LENGTH) {
      throw new ApiError(
        `النسخة لا تتضمن بيانات تحقق صالحة (${readiness.invalid} من ${readiness.total} مستخدمًا بلا هاش كلمة مرور) — ` +
        'لا يمكن استعادتها كما هي منعًا لقفل الحسابات. عيّن كلمة مرور جديدة للمالك (newOwnerPassword: 4 أحرف/أرقام على الأقل) ثم أعد المحاولة',
        422
      )
    }
    const owner = pickOwnerRow(users, settingsRows)
    if (!owner) {
      throw new ApiError('تعذر تحديد حساب مالك في النسخة لتعيين كلمة المرور — رُفضت الاستعادة دون أي تغيير', 422)
    }
    let ownerResetUsername: string | null = null
    let lockedCount = 0
    const rows = users.map(u => {
      if (hasValidAuthMaterial(u)) return u
      const cred = u === owner
        ? (() => { const salt = makeSalt(); return { password_hash: hashPassword(newOwnerPassword as string, salt), password_salt: salt } })()
        : lockedCredential()
      if (u === owner) ownerResetUsername = typeof u.username === 'string' ? u.username : null
      else lockedCount++
      return {
        ...u,
        password_hash: cred.password_hash,
        password_salt: cred.password_salt,
        pin_hash: null,
        pin_salt: null,
        failed_attempts: 0,
        locked_until: null
      }
    })
    // دفاع أخير: لن يُعاد أي صف بهاش أو ملح فارغ
    for (const r of rows) {
      if (!hasValidAuthMaterial(r)) throw new ApiError('صف مستخدم ببيانات تحقق غير صالحة — أُلغيت الاستعادة دون أي تغيير', 422)
    }
    return { rows, ownerResetUsername, lockedCount, authReady: false }
  }
  return { rows: users, ownerResetUsername: null, lockedCount: 0, authReady: true }
}

/** فحص ملف نسخة (نص JSON) قبل الاستعادة — لا يعدل شيئًا */
export function previewBackup(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const json = reqStr(payload.json, 'محتوى النسخة', 100_000_000)
  const b = parseBackup(json)
  const counts: Record<string, number> = {}
  for (const t of TABLES) {
    const rows = b.tables[t]
    counts[t] = Array.isArray(rows) ? rows.length : 0
  }
  const usersRows = Array.isArray(b.tables['users']) ? (b.tables['users'] as Row[]).filter(r => r && typeof r === 'object' && !Array.isArray(r)) : []
  const auth = analyzeUsers(usersRows)
  const warnings: string[] = []
  if (!auth.authReady) {
    warnings.push(
      `النسخة لا تتضمن بيانات تحقق صالحة (${auth.invalid} من ${auth.total} مستخدمًا بلا هاش) — ` +
      'الاستعادة تتطلب تعيين كلمة مرور جديدة للمالك (newOwnerPassword) قبل الاعتماد'
    )
  }
  return {
    schemaVersion: b.schemaVersion,
    exportedAt: b.exportedAt,
    counts,
    auth,
    warnings,
    currentSchemaVersion: currentSchemaVersion(ctx)
  }
}

function currentSchemaVersion(ctx: SvcCtx): number {
  const r = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations')
  return Number(r?.c ?? 0)
}

/**
 * استعادة: فحص كامل (بما فيه جاهزية بيانات المصادقة) → نسخة أمان من الملف الحالي
 * → استبدال الجداول داخل معاملة → حفظ ذري.
 * ملاحظات:
 * - الجلسات لا تُستعاد أبدًا من النسخة (رموز قديمة لا تُحيى) — وتُحفظ جلسة المشغّل الحالي إن بقي حسابه.
 * - نسخة بلا بيانات تحقق صالحة تُرفض أو تُقبل فقط مع newOwnerPassword للمالك — قبل أي تغيير.
 */
export function restoreBackup(ctx: SvcCtx, payload: Record<string, unknown>): {
  done: boolean
  safetyPath: string | null
  authReady: boolean
  ownerResetUsername: string | null
  lockedUsers: number
  sessionKept: boolean
} {
  const json = reqStr(payload.json, 'محتوى النسخة', 100_000_000)
  const newOwnerPassword = typeof payload.newOwnerPassword === 'string' && payload.newOwnerPassword.length > 0 ? payload.newOwnerPassword : null
  if (newOwnerPassword !== null && newOwnerPassword.length < MIN_OWNER_PASSWORD_LENGTH) {
    throw new ApiError(`كلمة مرور المالك الجديدة يجب ألا تقل عن ${MIN_OWNER_PASSWORD_LENGTH} أحرف/أرقام`, 422)
  }
  const b = parseBackup(json)

  // فحص قبل التطبيق: كل جدول موجود ومصفوفة
  for (const t of TABLES) {
    const rows = b.tables[t]
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new ApiError(`بيانات الجدول «${t}» غير صالحة في النسخة`)
    }
  }
  // يجب أن تبقى نسخة من المستخدمين — رفض استعادة بلا مستخدمين
  const usersRaw = (b.tables['users'] ?? []) as Row[]
  if (usersRaw.length === 0) {
    throw new ApiError('النسخة لا تحتوي مستخدمين — رفض الاستعادة', 422)
  }
  // فحص جاهزية المصادقة + التحويل قبل أي تغيير — الرفض هنا لا يلمس القاعدة إطلاقًا
  const settingsRows = (b.tables['settings'] ?? []) as Row[]
  const t = transformUsers(usersRaw, settingsRows, newOwnerPassword)
  const restoredUserIds = new Set(t.rows.map(u => Number(u.id)).filter(Number.isInteger))

  // نسخة أمان من ملف القاعدة الحالي
  let safetyPath: string | null = null
  if (fs.existsSync(ctx.db.filePath)) {
    const dir = backupsDir(ctx)
    fs.mkdirSync(dir, { recursive: true })
    safetyPath = path.join(dir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
    fs.copyFileSync(ctx.db.filePath, safetyPath)
  }

  const me = ctx.user
  const token = typeof payload.token === 'string' ? payload.token : null
  let sessionKept = false

  ctx.db.tx(() => {
    // تعطيل فحص المفاتيح الأجنبية مؤقتًا داخل المعاملة (sqlite لا يطبق pragma داخل tx،
    // لذا نحذف بالترتيب العكسي وندخل بالترتيب الأمامي)
    for (const tb of [...TABLES].reverse()) {
      ctx.db.run(`DELETE FROM ${tb}`)
    }
    for (const tb of TABLES) {
      if (tb === 'sessions') continue // الجلسات لا تُستعاد من النسخة أبدًا — رموز قديمة لا تُحيى
      if (tb === 'users') continue // المستخدمون يُدخلون من الصفوف المحوَّلة أدناه (ببيانات تحقق مضمونة)
      const rows = b.tables[tb] ?? []
      for (const row of rows as Row[]) {
        const cols = Object.keys(row)
        if (cols.length === 0) continue
        const placeholders = cols.map(() => '?').join(', ')
        ctx.db.run(`INSERT INTO ${tb} (${cols.join(', ')}) VALUES (${placeholders})`, cols.map((c) => row[c]))
      }
    }
    // إدخال المستخدمين من الصفوف المحوَّلة (كلها ببيانات تحقق صالحة) — أي إخلال يُرجع المعاملة كاملة
    for (const row of t.rows) {
      if (!hasValidAuthMaterial(row)) throw new ApiError('محاولة إدخال مستخدم ببيانات تحقق غير صالحة — أُلغيت الاستعادة', 422)
      const cols = Object.keys(row)
      const placeholders = cols.map(() => '?').join(', ')
      ctx.db.run(`INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders})`, cols.map((c) => row[c]))
    }
    // الحفاظ على جلسة المشغّل الحالي إن بقي حسابه في البيانات المستعادة
    if (me && token && restoredUserIds.has(me.id)) {
      ctx.db.run(
        'INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        [token, me.id, ctx.db.now(), new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString()]
      )
      sessionKept = true
    }
    ctx.audit('backup.restore', 'backup', null, {
      exportedAt: b.exportedAt,
      safetyPath,
      authReady: t.authReady,
      ownerReset: t.ownerResetUsername !== null,
      lockedUsers: t.lockedCount,
      sessionKept
    })
  })
  return {
    done: true,
    safetyPath,
    authReady: t.authReady,
    ownerResetUsername: t.ownerResetUsername,
    lockedUsers: t.lockedCount,
    sessionKept
  }
}

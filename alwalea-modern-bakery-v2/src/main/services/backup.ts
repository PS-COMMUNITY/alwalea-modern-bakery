// =============================================================
// مخبز الولاء الحديث — النسخ الاحتياطي: تصدير JSON كامل بإصدار مخطط
// + فحص قبل الاستعادة + نسخة أمان قبل التطبيق
// =============================================================
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ApiError, reqStr } from '../validate'
import { SvcCtx } from './helpers'

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

function backupsDir(ctx: SvcCtx): string {
  // مجلد النسخ بجانب قاعدة البيانات: userData/backups
  return path.join(path.dirname(ctx.db.filePath), '..', 'backups')
}

export function exportBackup(ctx: SvcCtx, payload: Record<string, unknown>): { path: string; sizeBytes: number; schemaVersion: number; exportedAt: string } {
  const note = optNote(payload)
  const data: BackupFile = {
    app: 'alwalea-modern-bakery',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: ctx.db.now(),
    tables: {}
  }
  for (const t of TABLES) {
    data.tables[t] = ctx.db.query(`SELECT * FROM ${t}`)
  }
  const dir = backupsDir(ctx)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, `bakery-backup-${stamp}.json`)
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

/** فحص ملف نسخة (نص JSON) قبل الاستعادة — لا يعدل شيئًا */
export function previewBackup(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const json = reqStr(payload.json, 'محتوى النسخة', 100_000_000)
  const b = parseBackup(json)
  const counts: Record<string, number> = {}
  for (const t of TABLES) {
    const rows = b.tables[t]
    counts[t] = Array.isArray(rows) ? rows.length : 0
  }
  return {
    schemaVersion: b.schemaVersion,
    exportedAt: b.exportedAt,
    counts,
    currentSchemaVersion: currentSchemaVersion(ctx)
  }
}

function currentSchemaVersion(ctx: SvcCtx): number {
  const r = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations')
  return Number(r?.c ?? 0)
}

/**
 * استعادة: فحص كامل → نسخة أمان من الملف الحالي → استبدال الجداول داخل معاملة → حفظ ذري
 * ملاحظة: تُستبدل البيانات كاملة بمحتوى النسخة (استعادة شاملة).
 */
export function restoreBackup(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean; safetyPath: string | null } {
  const json = reqStr(payload.json, 'محتوى النسخة', 100_000_000)
  const b = parseBackup(json)

  // فحص قبل التطبيق: كل جدول موجود ومصفوفة
  for (const t of TABLES) {
    const rows = b.tables[t]
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new ApiError(`بيانات الجدول «${t}» غير صالحة في النسخة`)
    }
  }
  // يجب أن تبقى نسخة من المستخدمين والجلسات إن لم تتضمن النسخة مستخدمين؟ نرفض استعادة بلا مستخدمين
  const users = b.tables['users']
  if (!Array.isArray(users) || users.length === 0) {
    throw new ApiError('النسخة لا تحتوي مستخدمين — رفض الاستعادة')
  }

  // نسخة أمان من ملف القاعدة الحالي
  let safetyPath: string | null = null
  if (fs.existsSync(ctx.db.filePath)) {
    const dir = backupsDir(ctx)
    fs.mkdirSync(dir, { recursive: true })
    safetyPath = path.join(dir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
    fs.copyFileSync(ctx.db.filePath, safetyPath)
  }

  ctx.db.tx(() => {
    // تعطيل فحص المفاتيح الأجنبية مؤقتًا داخل المعاملة (sqlite لا يطبق pragma داخل tx،
    // لذا نحذف بالترتيب العكسي وندخل بالترتيب الأمامي)
    for (const t of [...TABLES].reverse()) {
      ctx.db.run(`DELETE FROM ${t}`)
    }
    for (const t of TABLES) {
      const rows = b.tables[t] ?? []
      for (const row of rows as Array<Record<string, unknown>>) {
        const cols = Object.keys(row)
        if (cols.length === 0) continue
        const placeholders = cols.map(() => '?').join(', ')
        ctx.db.run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`, cols.map((c) => row[c]))
      }
    }
    ctx.audit('backup.restore', 'backup', null, { exportedAt: b.exportedAt, safetyPath })
  })
  return { done: true, safetyPath }
}

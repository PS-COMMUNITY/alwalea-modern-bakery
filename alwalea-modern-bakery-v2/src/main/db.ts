// =============================================================
// مخبز الولاء الحديث — طبقة قاعدة البيانات (sql.js WASM)
// - بدون native modules إطلاقًا (قرار معماري: توافق تغليف عبر المنصات)
// - القاعدة في الذاكرة، والحفظ ذري على القرص (tmp + rename) بعد كل معاملة كتابية
// - migrations مرقمة idempotent مع جدول schema_migrations
// - مكان الملف: app.getPath('userData')/data/bakery.db
// =============================================================
import initSqlJs from 'sql.js'
import type { BindParams, Database, QueryExecResult } from 'sql.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ملاحظة: يُبنى هذا الملف إلى CJS عبر esbuild — __dirname = dist-electron/ (متاح من @types/node)

export interface DbConfig {
  /** المسار الكامل لملف bakery.db */
  filePath: string
  /** مسارات احتياطية للبحث عن sql-wasm.wasm */
  wasmCandidates: string[]
}

export class BakeryDb {
  private db: Database | null = null
  private inTx = false
  private dirty = false
  private persistFn: () => void = () => {}

  constructor(private readonly cfg: DbConfig) {}

  get filePath(): string {
    return this.cfg.filePath
  }

  /** تهيئة sql.js + تحميل الملف إن وُجد + تشغيل الـ migrations */
  async init(): Promise<void> {
    const wasmBinary = this.loadWasmBinary()
    const SQL = await initSqlJs({ wasmBinary })

    fs.mkdirSync(path.dirname(this.cfg.filePath), { recursive: true })
    if (fs.existsSync(this.cfg.filePath)) {
      const buf = fs.readFileSync(this.cfg.filePath)
      this.db = new SQL.Database(buf)
    } else {
      this.db = new SQL.Database()
    }
    this.db.run('PRAGMA foreign_keys = ON;')
    this.runMigrations()
    // الـ migrations تُنفَّذ داخل tx فترفع dirty=true بينما persistFn لا يزال no-op أثناء التهيئة —
    // نصفّرها هنا حتى لا يكتب هذا المثيل حالته القديمة فوق الملف عند الإغلاق ويُفقِد كتابات مثيلات أخرى.
    this.dirty = false
  }

  private loadWasmBinary(): ArrayBuffer {
    for (const p of this.cfg.wasmCandidates) {
      if (p && fs.existsSync(p)) {
        const buf = fs.readFileSync(p)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      }
    }
    throw new Error(
      `تعذر العثور على sql-wasm.wasm — المسارات المفحوصة: ${this.cfg.wasmCandidates.filter(Boolean).join(' , ')}`
    )
  }

  // ---------- migrations ----------
  private runMigrations(): void {
    const db = this.requireDb()
    db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );`)
    const migrationsDir = path.join(__dirname, 'migrations')
    let files: string[] = []
    if (fs.existsSync(migrationsDir)) {
      files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    }
    for (const file of files) {
      const applied = this.query<{ name: string }>('SELECT name FROM schema_migrations WHERE name = ?', [file])
      if (applied.length > 0) continue
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      this.tx(() => {
        db.run(sql)
        db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, new Date().toISOString()])
      })
    }
  }

  requireDb(): Database {
    if (!this.db) throw new Error('قاعدة البيانات غير مهيأة')
    return this.db
  }

  // ---------- استعلامات ----------
  query<T>(sql: string, params: unknown[] = []): T[] {
    const db = this.requireDb()
    const res: QueryExecResult[] = db.exec(sql, params as BindParams)
    const first = res[0]
    if (!first) return []
    const { columns, values } = first
    return values.map((row) => {
      const obj = {} as Record<string, unknown>
      columns.forEach((c: string, i: number) => {
        obj[c] = row[i]
      })
      return obj as T
    })
  }

  get<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.query<T>(sql, params)[0]
  }

  run(sql: string, params: unknown[] = []): void {
    this.requireDb().run(sql, params as BindParams)
  }

  /** آخر id مُدرج */
  lastId(): number {
    const r = this.get<{ id: number }>('SELECT last_insert_rowid() AS id')
    return r ? Number(r.id) : 0
  }

  // ---------- معاملات ----------
  /** تنفيذ ذري: BEGIN → fn → COMMIT (+ حفظ فوري) أو ROLLBACK */
  tx<T>(fn: () => T): T {
    if (this.inTx) {
      // معاملة متداخلة (نفس الاستدعاء) — نقطة حفظ داخلية
      this.run('SAVEPOINT nested')
      try {
        const r = fn()
        this.run('RELEASE nested')
        return r
      } catch (e) {
        this.run('ROLLBACK TO nested')
        this.run('RELEASE nested')
        throw e
      }
    }
    const db = this.requireDb()
    this.inTx = true
    db.run('BEGIN')
    try {
      const r = fn()
      db.run('COMMIT')
      this.inTx = false
      this.dirty = true
      this.persistFn() // حفظ ذري فوري بعد كل معاملة كتابية
      return r
    } catch (e) {
      try {
        db.run('ROLLBACK')
      } catch {
        /* تجاهل */
      }
      this.inTx = false
      throw e
    }
  }

  /** ضبط دالة الحفظ (تُستدعى تلقائيًا بعد كل tx) */
  setPersistFn(fn: () => void): void {
    this.persistFn = fn
  }

  /** حفظ ذري: كتابة إلى ملف مؤقت ثم rename (اتمي على نفس نظام الملفات) */
  persist(): void {
    const db = this.requireDb()
    const data = Buffer.from(db.export())
    const tmp = `${this.cfg.filePath}.tmp`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, this.cfg.filePath)
    this.dirty = false
  }

  isDirty(): boolean {
    return this.dirty
  }

  close(): void {
    if (this.db) {
      if (this.dirty) {
        try {
          this.persist()
        } catch {
          /* لا نرمي عند الإغلاق */
        }
      }
      this.db.close()
      this.db = null
    }
  }

  // ---------- أدوات مساعدة ----------
  nextSeq(name: string): number {
    const row = this.get<{ value: number }>('SELECT value FROM sequences WHERE name = ?', [name])
    const next = (row ? Number(row.value) : 0) + 1
    this.run(
      'INSERT INTO sequences (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
      [name, next]
    )
    return next
  }

  today(): string {
    // تاريخ محلي YYYY-MM-DD (المنطقة Asia/Jerusalem افتراضيًا على الجهاز)
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  now(): string {
    return new Date().toISOString()
  }
}

/** بناء مسارات البحث عن wasm وفق بيئة التشغيل (dev / معبأ asar) */
export function wasmCandidatesFor(appPath: string, resourcesPath: string | undefined): string[] {
  const rel = path.join('node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  const list = [
    resourcesPath ? path.join(resourcesPath, 'app.asar', rel) : '',
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', rel) : '',
    resourcesPath ? path.join(resourcesPath, 'app', rel) : '',
    path.join(appPath, rel),
    path.join(__dirname, '..', rel),
    path.join(__dirname, '..', '..', rel)
  ]
  return list.filter((p) => p !== '')
}

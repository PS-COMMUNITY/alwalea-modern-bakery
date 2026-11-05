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
import { ApiError } from './validate'

// ملاحظة: يُبنى هذا الملف إلى CJS عبر esbuild — __dirname = dist-electron/ (متاح من @types/node)

export interface DbConfig {
  /** المسار الكامل لملف bakery.db */
  filePath: string
  /** مسارات احتياطية للبحث عن sql-wasm.wasm */
  wasmCandidates: string[]
}

export const PERSIST_FAILED_MESSAGE =
  'فشل حفظ البيانات على القرص — التغييرات الحديثة موجودة في الذاكرة فقط ولم تُثبّت في الملف. ' +
  'أصلح السبب (مساحة القرص/الصلاحيات) ثم اضغط «إعادة المحاولة للحفظ» في شاشة الإعدادات — وحتى ذلك الحين ستُرفض أي عملية كتابة جديدة حمايةً لبياناتك (كود 507)'

export class BakeryDb {
  private db: Database | null = null
  private inTx = false
  private dirty = false
  private persistFn: () => void = () => {}
  // rc.12 (P0-5): حالة فشل الحفظ على القرص — كتابة مُتعهدة في الذاكرة بلا تثبيت ملفي
  private persistFailed = false
  private lastPersistError: string | null = null

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
      try {
        this.db = new SQL.Database(buf)
        // حرس التلف (rc.10): ملف غير مقروء = نرمي خطأ واضح فورًا — أبدًا لا نمضي بقاعدة فارغة
        // فوق ملف تالف (فقدان بيانات صامت). الملف الأصلي يبقى كما هو للمسح اليدوي/الاستعادة.
        this.db.exec('SELECT count(*) FROM sqlite_master')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(
          `ملف قاعدة البيانات تالف أو غير قابل للقراءة (${this.cfg.filePath}) — ` +
          `لن يُكتب فوقه شيئًا. استعد من نسخة احتياطية أو أصلح الملف. التفاصيل: ${msg}`
        )
      }
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
    const pending = files.filter((f) => this.query<{ name: string }>('SELECT name FROM schema_migrations WHERE name = ?', [f]).length === 0)
    // rc.10: نسخة أمان من الملف قبل تطبيق أي ترقية مخطط — أي فشل ترقية لا يعني فقدان ما قبلها
    if (pending.length > 0 && fs.existsSync(this.cfg.filePath)) {
      try {
        const dir = path.join(path.dirname(this.cfg.filePath), '..', 'backups')
        fs.mkdirSync(dir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        fs.copyFileSync(this.cfg.filePath, path.join(dir, `pre-migration-${stamp}.db`))
        // دوران: آخر 5 نسخ ترقية فقط
        const olds = fs.readdirSync(dir).filter((f) => f.startsWith('pre-migration-') && f.endsWith('.db')).sort()
        while (olds.length > 5) {
          const oldest = olds.shift()
          if (oldest) try { fs.unlinkSync(path.join(dir, oldest)) } catch { /* مقفل خارجيًا */ }
        }
      } catch {
        // فشل النسخة الأمانة لا يمنع الترقية (المعاملات نفسها ذرية على أي حال)
      }
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
    // rc.12 (P0-5): حاجز الكتابة أثناء حالة فشل الحفظ — منع تراكم تغييرات غير مثبتة
    this.assertPersistOk()
    db.run('BEGIN')
    try {
      const r = fn()
      db.run('COMMIT')
      this.inTx = false
      this.dirty = true
      // rc.12 (P0-5): فشل الحفظ بعد COMMIT لا يُرمي (المعاملة انتهت فعلًا)
      // بل يسجّل حالة فشل تمنع الكتابات الجديدة حتى إعادة المحاولة الناجحة.
      try {
        this.persistFn() // حفظ ذري فوري بعد كل معاملة كتابية
      } catch (e) {
        this.markPersistFailed(e)
      }
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

  // ---------- حالة فشل الحفظ (rc.12 — P0-5) ----------

  /** حاجز الكتابات: إذا فشل تثبيت بيانات سابقة على القرص فلا كتابات جديدة أبدًا */
  assertPersistOk(): void {
    if (this.persistFailed) {
      throw new ApiError(PERSIST_FAILED_MESSAGE, 507)
    }
  }

  private markPersistFailed(e: unknown): void {
    this.persistFailed = true
    this.lastPersistError = e instanceof Error ? e.message : String(e)
  }

  /** حالة الحفظ للعرض في الواجهة */
  persistStatus(): { persistFailed: boolean; lastPersistError: string | null; dirty: boolean; filePath: string } {
    return { persistFailed: this.persistFailed, lastPersistError: this.lastPersistError, dirty: this.dirty, filePath: this.cfg.filePath }
  }

  /** إعادة محاولة الحفظ بعد إصلاح السبب — يزيل القفل عند النجاح */
  retryPersist(): { ok: boolean; error: string | null } {
    if (!this.persistFailed && !this.dirty) return { ok: true, error: null }
    try {
      this.persist()
      this.persistFailed = false
      this.lastPersistError = null
      return { ok: true, error: null }
    } catch (e) {
      this.markPersistFailed(e)
      return { ok: false, error: this.lastPersistError }
    }
  }

  /** ضبط دالة الحفظ (تُستدعى تلقائيًا بعد كل tx) */
  setPersistFn(fn: () => void): void {
    this.persistFn = fn
  }

  /** حفظ ذري مع تثبيت على القرص: كتابة → fsync للملف → rename → fsync للمجلد (rc.10) */
  persist(): void {
    const db = this.requireDb()
    const data = Buffer.from(db.export())
    const tmp = `${this.cfg.filePath}.tmp`
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, data)
      try {
        fs.fsyncSync(fd) // إجبار الوصول للقرص قبل الـrename — بقاء البيانات حتى مع انقطاع كهرباء
      } catch {
        /* بعض أنظمة الملفات/الشبكات ترفض fsync — الـrename الذري يبقى مفعّلًا */
      }
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, this.cfg.filePath)
    try {
      // تثبيت إدخال المجلد نفسه حتى يبقى الـrename بعد انقطاع مفاجئ (لا ينطبق على ويندوز)
      const dirFd = fs.openSync(path.dirname(this.cfg.filePath), 'r')
      try {
        fs.fsyncSync(dirFd)
      } finally {
        fs.closeSync(dirFd)
      }
    } catch {
      /* ويندوز/ملفات شبكة: تجاهل بهدوء */
    }
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

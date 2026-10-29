// =============================================================
// مخبز الولاء الحديث — العملية الرئيسية
// نافذة آمنة، single instance lock، دورة حياة، دعم --smoke
// =============================================================
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { BakeryDb, wasmCandidatesFor } from './db'
import { dispatch } from './registry'
import { autoBackupOnQuit } from './services/backup'
import { isIpcChannel } from '../shared/types'
import type { ApiEnvelope } from '../shared/types'

const isSmoke = process.argv.includes('--smoke')

// توحيد اسم التطبيق ومسار userData قبل أي استدعاء للقفل أو قراءة المسار
// (بدون هذا، يختلف مسار القاعدة بين وضع الفحص والوضع العادي لأن قفل النسخة الواحدة
//  يحسم userData قبل setName اعتمادًا على productName من package.json)
app.setName('alwalea-modern-bakery')
app.setPath('userData', path.join(app.getPath('appData'), 'alwalea-modern-bakery'))

// تعطيل تسريع العتاد: أجهزة كاشير ضعيفة وبيئات بلا GPU (مثل الاختبار تحت Xvfb)
// — دون ذلك قد ينهار Chromium عند فشل تهيئة مسار GPU ("GPU process isn't usable")
app.disableHardwareAcceleration()
// استخدام ملفات في /tmp بدل /dev/shm للذاكرة المشتركة (في الحاويات قد تكون /dev/shm بحجم 64MB
// فقط فينهار خدمة الشبكة/GPU بعد ثوانٍ — إصلاح معروف لبيئات الحاويات)
app.commandLine.appendSwitch('disable-dev-shm-usage')

// قفل نسخة واحدة (يُتجاهل في وضع الفحص)
if (!isSmoke && !app.requestSingleInstanceLock()) {
  app.quit()
}

let db: BakeryDb | null = null

function dbFilePath(): string {
  return path.join(app.getPath('userData'), 'data', 'bakery.db')
}

async function openDatabase(): Promise<BakeryDb> {
  const bakeryDb = new BakeryDb({
    filePath: dbFilePath(),
    wasmCandidates: wasmCandidatesFor(app.getAppPath(), process.resourcesPath)
  })
  await bakeryDb.init()
  bakeryDb.setPersistFn(() => bakeryDb.persist())
  return bakeryDb
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1366,
    minHeight: 768,
    show: false,
    backgroundColor: '#FFF8F0',
    title: 'مخبز الولاء الحديث',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  // منع فتح نوافذ/تنقل خارجي
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => {
    e.preventDefault()
  })

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.once('ready-to-show', () => win.show())
}

// ---------- IPC: قناة واحدة مع فحص الاسم في الطرفين ----------
function registerIpc(): void {
  ipcMain.handle('bakery:invoke', async (_event, channel: unknown, payload: unknown): Promise<ApiEnvelope> => {
    if (!isIpcChannel(channel)) {
      return { ok: false, error: 'قناة IPC غير معروفة', code: 404 }
    }
    if (!db) {
      return { ok: false, error: 'قاعدة البيانات غير مهيأة', code: 500 }
    }
    return dispatch(db, channel, payload)
  })
}

// ---------- فحص دخان: إنشاء سجل → إغلاق → إعادة فتح → التحقق ----------
async function runSmoke(): Promise<void> {
  const resultPath = '/tmp/bakery-smoke-result.json'
  const steps: Record<string, unknown> = {}
  try {
    // 1) فتح القاعدة وإنشاء سجل تجريبي
    const first = await openDatabase()
    const stamp = Date.now()
    const key = `smoke_${stamp}`
    first.tx(() => {
      first.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, 'alive', first.now()])
    })
    const saved = first.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    steps.createdKey = key
    steps.readBackAfterWrite = saved?.value ?? null

    // 2) إغلاق الاتصال (persist يحدث تلقائيًا بعد tx)
    const filePath = first.filePath
    first.close()
    steps.fileExists = fs.existsSync(filePath)

    // 3) إعادة فتح والتحقق من بقاء السجل
    const second = await openDatabase()
    const persisted = second.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    steps.foundAfterReopen = persisted?.value ?? null
    const smokeCount = second.get<{ c: number }>("SELECT COUNT(*) AS c FROM settings WHERE key LIKE 'smoke_%'")
    steps.smokeKeysTotal = Number(smokeCount?.c ?? 0)
    second.close()

    const ok = steps.readBackAfterWrite === 'alive' && steps.foundAfterReopen === 'alive' && steps.fileExists === true
    fs.writeFileSync(resultPath, JSON.stringify({ ok, steps }, null, 2), 'utf8')
    console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'} — ${resultPath}`)
  } catch (e) {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
    fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error: msg, steps }, null, 2), 'utf8')
    console.error('[smoke] FAIL', msg)
  }
  app.quit()
}

app.whenReady().then(async () => {
  try {
    db = await openDatabase()
    // أثر تشخيصي في السجل: إثبات فتح القاعدة عبر sql.js وتطبيق migrations
    const applied = db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')
    console.log(
      `[main] sql.js: قاعدة البيانات مفتوحة — ${dbFilePath()} | migrations: ${applied.length} [${applied
        .map((m) => m.name)
        .join(', ')}]`
    )
  } catch (e) {
    console.error('[main] فشل تهيئة قاعدة البيانات:', e)
    app.quit()
    return
  }

  if (isSmoke) {
    void runSmoke()
    return
  }

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // rc.8 (P0-2): نسخة تلقائية قبل الإغلاق — تعيد استخدام exportBackup المجرّبة (48 فحصًا).
  // النسخ محاولة لا شرط: أي فشل يُسجل داخليًا (autobackup.log) ولا يمنع الإغلاق أبدًا.
  if (db && !isSmoke) {
    const currentDb = db // تثبيت للأنواع داخل callback — لا إعادة تعيين أثناء النسخ
    try {
      autoBackupOnQuit({
        db: currentDb,
        user: null,
        audit: (action, entity, entityId, details) => {
          currentDb.run(
            `INSERT INTO audit_log (date, user_id, username, action, entity, entity_id, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              currentDb.today(),
              null,
              'system',
              action,
              entity ?? null,
              entityId ?? null,
              details === undefined || details === null ? null : JSON.stringify(details),
              currentDb.now()
            ]
          )
        }
      })
    } catch {
      // الإغلاق يجب أن ينجح دائمًا — لا شيء هنا يرمي أو يمنع
    }
  }
  db?.close()
  db = null
})

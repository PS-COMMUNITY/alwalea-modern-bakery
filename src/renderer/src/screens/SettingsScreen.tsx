// =============================================================
// مخبز الولاء الحديث — شاشة الإعدادات:
// كلمة المرور (وضع الحساب الواحد) + النسخ الاحتياطي والاستعادة (backup.manage)
// rc.12-merge: + بطاقة تحرير العملة/الضريبة/المخزون السالب (settings.update) منقولة من local —
//              بجانب بطاقات target (بيانات النشاط/تيليجرام/النسخ التلقائي) دون تغييرها
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppSettings, SessionUser, UserRow, StatusInfo } from '../../../shared/types'
import { ROLE_LABELS, ROLES, type Role } from '../../../shared/permissions'
import { call, fmtDateTime, ageText, BACKUP_STALE_MS } from '../api'
import { Field, Banner, Modal, Badge, ConfirmModal } from '../components/ui'
import { BusinessInfoCard, TelegramCard, AutoBackupCard } from '../components/SettingsCards'

export default function SettingsScreen(props: { user: SessionUser }): ReactNode {
  const canBackup = props.user.perms.includes('backup.manage')
  const canSettings = props.user.perms.includes('settings.manage')
  const canUsers = props.user.perms.includes('users.manage')
  return (
    <div>
      <h1>الإعدادات</h1>
      {canSettings ? <BusinessInfoCard /> : null}
      {/* rc.12-merge: محرر الإعدادات المالية العامة — الحقول الغائبة عن بطاقات target (العملة/الضريبة/المخزون السالب) */}
      {canSettings ? <FinancialSettingsCard /> : null}
      {canSettings ? <TelegramCard /> : null}
      {canBackup ? <AutoBackupCard /> : null}
      {/* rc.12-merge: إدارة المستخدمين — إنشاء/تعطيل/حذف آمن بفحص مراجع (طلب المالك) */}
      {canUsers ? <UsersCard /> : null}
      <PasswordCard userId={props.user.id} />
      {canBackup ? <BackupSection /> : null}
      {/* rc.13: تذييل يعرض إصدار التطبيق من status.get — يعرف المالك أنه يشغّل نسخة قديمة أو حديثة */}
      <VersionFooter />
    </div>
  )
}

// rc.13: سطر تذييل خافت صغير «الإصدار X» — يُخفى إن تعذر جلب الحالة
function VersionFooter(): ReactNode {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void (async () => {
      try {
        setVersion((await call<StatusInfo>('status.get', {})).version)
      } catch {
        // التذييل تجميلي — لا رسائل خطأ له
      }
    })()
  }, [])
  if (!version) return null
  return (
    <p style={{ marginTop: 18, fontSize: 12, opacity: 0.55, textAlign: 'center' }} dir="ltr">
      الإصدار {version}
    </p>
  )
}

// =============================================================
// rc.12-merge — محرر «العملة والضريبة والمخزون» (settings.update) منقول من local
// (بطاقة BusinessSettingsCard هناك). بطاقة «بيانات النشاط» في target تغطي
// اسم النشاط/الهاتف/العنوان/التذييل، لذا هذا القسم يكملها بالحقول الغائبة فقط
// لتجنّب حقول مكرّرة بحفظين متوازيين:
//   العملة (رمز العرض + كود ISO) / الضريبة (تفعيل + نسبة نقاط أساس) / المخزون السالب
// القناة settings.update مسجلة في registry بصلاحية settings.manage وتقبل هذه المفاتيح
// جزئيًا (SETTABLE_KEYS في services/settings-users.ts) — نمط target نفسه.
// =============================================================
function FinancialSettingsCard(): ReactNode {
  const [s, setS] = useState<AppSettings | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const fieldStyle = { width: '100%', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 10 }

  useEffect(() => {
    void (async () => {
      try {
        setS(await call<AppSettings>('settings.get', {}))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const save = async (): Promise<void> => {
    if (!s) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await call<AppSettings>('settings.update', {
        settings: {
          currency_code: s.currencyCode,
          currency_symbol: s.currencySymbol,
          tax_enabled: s.taxEnabled,
          tax_bp: s.taxBp,
          allow_negative_stock: s.allowNegativeStock
        }
      })
      setS(updated)
      setNotice('تم حفظ الإعدادات — تظهر فورًا في كل الشاشات')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!s) {
    return error ? <div className="card" style={{ maxWidth: 980, padding: 18, marginBottom: 16 }}><Banner kind="error" text={error} /></div> : null
  }

  return (
    <div className="card" style={{ maxWidth: 980, padding: 18, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>💱 العملة والضريبة والمخزون</h2>
      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}
      <div className="form-row">
        <Field label="رمز العملة للعرض" hint="مثال: ₪ أو ج.م — يظهر بجانب كل المبالغ">
          <input value={s.currencySymbol} onChange={(e) => setS({ ...s, currencySymbol: e.target.value })} style={fieldStyle} />
        </Field>
        <Field label="كود العملة" hint="ISO: ILS / EGP / JOD">
          <input value={s.currencyCode} onChange={(e) => setS({ ...s, currencyCode: e.target.value })} style={fieldStyle} dir="ltr" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="الضريبة">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 0' }}>
            <input
              type="checkbox"
              checked={s.taxEnabled}
              onChange={(e) => setS({ ...s, taxEnabled: e.target.checked })}
            />
            تفعيل الضريبة على المبيعات
          </label>
        </Field>
        <Field label="نسبة الضريبة (نقاط أساس)" hint="1700 = 17٪ — تُطبق فقط عند التفعيل">
          <input
            type="number"
            min={0}
            max={10000}
            value={s.taxBp}
            disabled={!s.taxEnabled}
            onChange={(e) => setS({ ...s, taxBp: parseInt(e.target.value, 10) || 0 })}
            style={fieldStyle}
            dir="ltr"
          />
        </Field>
      </div>
      <Field label="المخزون السالب">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 0' }}>
          <input
            type="checkbox"
            checked={s.allowNegativeStock}
            onChange={(e) => setS({ ...s, allowNegativeStock: e.target.checked })}
          />
          السماح بالبيع عند نزول الرصيد تحت الصفر
        </label>
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn primary" disabled={busy || !s.currencySymbol.trim() || !s.currencyCode.trim()} onClick={() => void save()}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
        </button>
      </div>
    </div>
  )
}

// =============================================================
// كلمة المرور
// =============================================================
function PasswordCard(props: { userId: number }): ReactNode {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const toggleBtn = (
    <button
      type="button"
      onClick={() => setShowPw((v) => !v)}
      aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
      aria-pressed={showPw}
      title={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
      style={{
        position: 'absolute',
        left: 6,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: 15,
        padding: 4,
        lineHeight: 1,
        color: 'var(--muted)'
      }}
    >
      {showPw ? '🙈' : '👁'}
    </button>
  )

  const inputStyle = { paddingLeft: 38, width: '100%' }

  const submit = async (): Promise<void> => {
    setError('')
    setDone('')
    if (!next || next.length < 4) {
      setError('كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف/أرقام')
      return
    }
    if (next !== confirm) {
      setError('تأكيد كلمة المرور غير مطابق')
      return
    }
    setBusy(true)
    try {
      await call('users.setPassword', { id: props.userId, password: next, currentPassword: current })
      setDone('تم تغيير كلمة المرور بنجاح — استخدمها في الدخول القادم.')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 480, padding: 18 }}>
      <h2>كلمة مرور المالك</h2>
      <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 13 }}>
        تُخزَّن مُلبَّدة (scrypt) ولا يمكن استرجاعها.
      </p>
      {error ? <Banner kind="error" text={error} /> : null}
      {done ? <Banner kind="ok" text={done} /> : null}
      <Field label="كلمة المرور الحالية">
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input type={showPw ? 'text' : 'password'} value={current} onChange={(e) => setCurrent(e.target.value)} style={inputStyle} />
          {toggleBtn}
        </div>
      </Field>
      <Field label="كلمة المرور الجديدة (4 أحرف/أرقام على الأقل)">
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input type={showPw ? 'text' : 'password'} value={next} onChange={(e) => setNext(e.target.value)} style={inputStyle} />
          {toggleBtn}
        </div>
      </Field>
      <Field label="تأكيد كلمة المرور الجديدة">
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input type={showPw ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} />
          {toggleBtn}
        </div>
      </Field>
      <button className="btn primary" disabled={busy} onClick={() => void submit()} style={{ width: '100%' }}>
        {busy ? 'جارٍ التغيير…' : 'تغيير كلمة المرور'}
      </button>
      <p className="hint" style={{ color: 'var(--muted)', marginTop: 8 }}>
        بعد التغيير، كلمة المرور القديمة تتوقف عن العمل فورًا ولا يوجد بديل احتياطي.
      </p>
    </div>
  )
}

// =============================================================
// النسخ الاحتياطي والاستعادة (صلاحية backup.manage)
// الشكل المطابق لخدمة backup.ts: export/list/preview/restore
// =============================================================
interface BackupRecordRow {
  id: number
  created_at: string
  path: string
  size_bytes: number
  schema_version: number
  note: string | null
}

interface BackupAuthReadiness {
  total: number
  valid: number
  invalid: number
  authReady: boolean
  needsOwnerPassword: boolean
}

interface BackupPreviewData {
  schemaVersion: number
  exportedAt: string
  counts: Record<string, number>
  auth: BackupAuthReadiness
  warnings: string[]
  currentSchemaVersion: number
}

interface RestoreResult {
  done: boolean
  safetyPath: string | null
  authReady: boolean
  ownerResetUsername: string | null
  lockedUsers: number
  sessionKept: boolean
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} م.ب`
  return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`
}

const PREVIEW_KEY_TABLES: Array<{ key: string; label: string }> = [
  { key: 'users', label: 'المستخدمون' },
  { key: 'products', label: 'المنتجات' },
  { key: 'customers', label: 'العملاء' },
  { key: 'suppliers', label: 'الموردون' },
  { key: 'sales', label: 'فواتير البيع' },
  { key: 'purchases', label: 'فواتير الشراء' },
  { key: 'production_batches', label: 'دفعات الإنتاج' },
  { key: 'stock_movements', label: 'حركات المخزون' },
  { key: 'expenses', label: 'المصروفات' },
  { key: 'shifts', label: 'الورديات' },
  { key: 'cash_movements', label: 'حركات الصندوق' },
  { key: 'audit_log', label: 'قيود التدقيق' }
]

interface FolderInfo {
  dir: string
  exists: boolean
  dbPath: string
  files: Array<{ name: string; sizeBytes: number; modifiedAt: string }>
}

/**
 * rc.12 — ملاحظة المالك: «لما بدي أرجع لنسخة ما بجدها داخل الجهاز».
 * بطاقة تكشف مجلد النسخ بالكامل: المسار النصي للنسخ + زر فتح المجلد في مدير ملفات
 * ويندوز + قائمة ملفات النسخ الفعلية على القرص.
 */
function BackupFolderCard(): ReactNode {
  const [info, setInfo] = useState<FolderInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      setInfo(await call<FolderInfo>('backup.folderInfo', {}))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const open = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await call<{ ok: boolean; dir: string }>('backup.openFolder', {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const formatBytes = (n: number): string => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14, background: 'rgba(199,123,63,0.06)' }}>
      <h3 style={{ margin: '0 0 8px' }}>📁 مكان النسخ الاحتياطية على هذا الجهاز</h3>
      {error ? <Banner kind="error" text={error} /> : null}
      {info ? (
        <>
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            <div>
              مجلد النسخ: <code dir="ltr" style={{ background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: 6 }}>{info.dir}</code>
            </div>
            <div style={{ marginTop: 4, color: 'var(--muted)' }}>
              ملف قاعدة البيانات: <code dir="ltr" style={{ fontSize: 12 }}>{info.dbPath}</code>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void open()}>
              📂 فتح مجلد النسخ في ويندوز
            </button>
            <button className="btn ghost" onClick={() => void load()}>
              تحديث
            </button>
            <span style={{ color: 'var(--muted)', fontSize: 12, alignSelf: 'center' }}>
              {info.files.length} ملفًا على القرص — النسخ التلقائية عند الإغلاق تحمل بادئة auto وتُحفظ آخر 14 نسخة منها
            </span>
          </div>
          {info.files.length > 0 ? (
            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table className="data" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>الملف</th>
                    <th className="num">الحجم</th>
                    <th>آخر تعديل</th>
                  </tr>
                </thead>
                <tbody>
                  {info.files.slice(0, 50).map((f) => (
                    <tr key={f.name}>
                      <td dir="ltr" style={{ fontSize: 12 }}>{f.name}</td>
                      <td className="num">{formatBytes(f.sizeBytes)}</td>
                      <td dir="ltr" style={{ fontSize: 12 }}>{fmtDateTime(f.modifiedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>لا ملفات نسخ بعد — أنشئ نسخة أولًا بالزر أدناه، أو انتظر النسخة التلقائية عند الإغلاق.</p>
          )}
        </>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>جارٍ قراءة مجلد النسخ…</p>
      )}
    </div>
  )
}

function BackupSection(): ReactNode {
  const [list, setList] = useState<BackupRecordRow[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // تصدير
  const [exportNote, setExportNote] = useState('')
  const [lastExport, setLastExport] = useState<{ path: string; sizeBytes: number } | null>(null)

  // معاينة/استعادة عبر محتوى JSON
  const [jsonText, setJsonText] = useState('')
  const [preview, setPreview] = useState<BackupPreviewData | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [ownerPw, setOwnerPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setList(await call<BackupRecordRow[]>('backup.list', {}))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const doExport = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await call<{ path: string; sizeBytes: number; schemaVersion: number; exportedAt: string }>('backup.export', {
        note: exportNote.trim() || null
      })
      setLastExport({ path: res.path, sizeBytes: res.sizeBytes })
      setExportNote('')
      setNotice(`أُنشئت نسخة احتياطية (${formatBytes(res.sizeBytes)}) — انسخ الملف إلى مكان آمن خارج الجهاز`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doPreview = async (): Promise<void> => {
    setError('')
    setNotice('')
    setPreview(null)
    setRestoreResult(null)
    if (jsonText.trim().length < 20) {
      setError('الصق محتوى ملف النسخة الاحتياطية (JSON) أولًا')
      return
    }
    setBusy(true)
    try {
      const res = await call<BackupPreviewData>('backup.preview', { json: jsonText })
      setPreview(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const canRestore = confirmChecked && (preview?.auth.needsOwnerPassword !== true || ownerPw.length >= 4)

  const doRestore = async (): Promise<void> => {
    if (!preview || !canRestore) return
    setError('')
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { json: jsonText }
      if (preview.auth.needsOwnerPassword) payload.newOwnerPassword = ownerPw
      const res = await call<RestoreResult>('backup.restore', payload)
      setRestoreOpen(false)
      setPreview(null)
      setJsonText('')
      setOwnerPw('')
      setConfirmChecked(false)
      setRestoreResult(res)
      setNotice('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 980, padding: 18, marginTop: 18 }}>
      <h2>🗄️ النسخ الاحتياطي والاستعادة</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 14px' }}>
        النسخة ملف JSON كامل قابل للنقل بين الأجهزة — بلا كلمات مرور أو جلسات. قبل أي استعادة يُنشئ النظام تلقائيًا نسخة أمان من القاعدة الحالية.
      </p>

      <BackupFolderCard />

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}
      {restoreResult ? (
        <Banner
          kind="ok"
          text={
            'تمت الاستعادة بنجاح. ' +
            (restoreResult.safetyPath ? `نسخة الأمان: ${restoreResult.safetyPath}. ` : '') +
            (restoreResult.ownerResetUsername
              ? `عُيّنت كلمة مرور جديدة للمالك «${restoreResult.ownerResetUsername}» — استخدمها في الدخول القادم. `
              : '') +
            (restoreResult.lockedUsers > 0 ? `${restoreResult.lockedUsers} مستخدمًا بقوا مقفلين لحماية الحساب. ` : '') +
            (restoreResult.sessionKept ? 'جلستك الحالية باقية.' : 'قد تحتاج لتسجيل الدخول من جديد.')
          }
        />
      ) : null}

      {/* ---------- تصدير ---------- */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 0, flex: '1 1 260px' }}>
          <label>ملاحظة على النسخة (اختياري)</label>
          <input value={exportNote} onChange={(e) => setExportNote(e.target.value)} placeholder="مثال: قبل ترحيل شهر يناير" />
        </div>
        <button className="btn primary" disabled={busy} onClick={() => void doExport()}>
          {busy ? 'جارٍ التصدير…' : '⬇ إنشاء نسخة احتياطية'}
        </button>
      </div>
      {lastExport ? (
        <p style={{ fontSize: 13, margin: '0 0 16px' }}>
          آخر نسخة: <code dir="ltr" style={{ overflowWrap: 'anywhere', color: 'var(--brown-700)' }}>{lastExport.path}</code>{' '}
          ({formatBytes(lastExport.sizeBytes)})
        </p>
      ) : null}

      {/* ---------- مؤشر عمر آخر نسخة (rc.8 P0-2) ---------- */}
      {list !== null ? (
        (() => {
          const newest = list[0]
          const stale = !newest || Date.now() - new Date(newest.created_at).getTime() > BACKUP_STALE_MS
          return (
            <p
              style={{ fontSize: 13, fontWeight: 700, margin: '0 0 14px', color: stale ? 'var(--err)' : 'var(--ok)' }}
              role="status"
            >
              {stale ? '⚠ ' : '✓ '}
              {newest
                ? `آخر نسخة احتياطية: ${ageText(newest.created_at)} — نسخة تلقائية تُنشأ عند كل إغلاق للتطبيق`
                : 'لا نسخة احتياطية بعد — نسخة تلقائية تُنشأ عند كل إغلاق للتطبيق، أو أنشئ نسخة الآن'}
            </p>
          )
        })()
      ) : null}

      {/* ---------- جدول النسخ ---------- */}
      {list === null ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>جارٍ تحميل سجل النسخ…</p>
      ) : list.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>لا نسخ مسجلة بعد — أنشئ أول نسخة احتياطية الآن.</p>
      ) : (
        <table className="data" style={{ marginBottom: 18 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>التاريخ</th>
              <th className="num">الحجم</th>
              <th className="num">إصدار المخطط</th>
              <th>ملاحظة</th>
              <th>مسار الملف</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td>{b.id}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(b.created_at)}</td>
                <td className="num">{formatBytes(b.size_bytes)}</td>
                <td className="num">{b.schema_version}</td>
                <td>{b.note ?? '—'}</td>
                <td>
                  <span dir="ltr" style={{ fontSize: 11.5, overflowWrap: 'anywhere', color: 'var(--brown-700)' }}>{b.path}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ---------- معاينة نسخة (لصق محتوى JSON) ---------- */}
      <h3 style={{ marginBottom: 6 }}>فحص نسخة قبل الاستعادة</h3>
      <p className="hint" style={{ margin: '0 0 8px' }}>
        الواجهة لا تقرأ ملفات القرص مباشرة (عزل أمني) — افتح ملف النسخة من مجلد النسخ وانسخ محتواه كاملًا والصقه هنا لفحصه ومعاينته قبل الاستعادة.
      </p>
      <textarea
        dir="ltr"
        rows={5}
        value={jsonText}
        onChange={(e) => {
          setJsonText(e.target.value)
          setPreview(null)
          setRestoreResult(null)
        }}
        placeholder='{"app":"alwalea-modern-bakery","schemaVersion":1,...}'
        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px', fontFamily: 'monospace', fontSize: 12, marginBottom: 10 }}
        aria-label="محتوى ملف النسخة الاحتياطية JSON"
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="btn" disabled={busy} onClick={() => void doPreview()}>
          {busy ? 'جارٍ الفحص…' : '🔍 فحص ومعاينة'}
        </button>
        {preview ? (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => {
              setConfirmChecked(false)
              setOwnerPw('')
              setRestoreOpen(true)
            }}
          >
            ↩ الاستعادة من هذه النسخة
          </button>
        ) : null}
      </div>

      {preview ? (
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, background: 'var(--cream)' }}>
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">تاريخ النسخة</div>
              <div className="value" style={{ fontSize: 15 }}>{fmtDateTime(preview.exportedAt)}</div>
            </div>
            <div className="stat">
              <div className="label">إصدار مخطط النسخة</div>
              <div className="value" style={{ fontSize: 15 }}>{preview.schemaVersion} (الحالي {preview.currentSchemaVersion})</div>
            </div>
            <div className="stat">
              <div className="label">بيانات تسجيل الدخول</div>
              <div className={`value ${preview.auth.authReady ? 'ok' : 'err'}`} style={{ fontSize: 15 }}>
                {preview.auth.authReady ? 'سليمة' : `غير جاهزة (${preview.auth.invalid} من ${preview.auth.total})`}
              </div>
            </div>
          </div>
          <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {PREVIEW_KEY_TABLES.map((t) => (
              <div className="stat" key={t.key}>
                <div className="label">{t.label}</div>
                <div className="value" style={{ fontSize: 17 }}>{preview.counts[t.key] ?? 0}</div>
              </div>
            ))}
          </div>
          {preview.warnings.map((w, i) => (
            <Banner kind="error" text={w} key={i} />
          ))}
        </div>
      ) : null}

      {/* ---------- نافذة تأكيد الاستعادة ---------- */}
      {restoreOpen && preview ? (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setRestoreOpen(false) }}>
          <div className="modal" style={{ width: 'min(560px, 100%)' }}>
            <div className="modal-head">
              <h2>تأكيد الاستعادة</h2>
              <button className="btn ghost small" onClick={() => setRestoreOpen(false)}>
                إغلاق ✕
              </button>
            </div>
            <Banner
              kind="error"
              text="الاستعادة تستبدل جميع البيانات الحالية ببيانات النسخة (الجداول كلها) — لا تراجع بعدها. سينشئ النظام نسخة أمان تلقائية قبل التطبيق."
            />
            <Field label="التأكيد *" hint="يجب وضع علامة صح للمتابعة">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 0' }}>
                <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                أفهم أن الاستعادة ستستبدل كل بيانات النظام الحالية ببيانات النسخة المعروضة أعلاه
              </label>
            </Field>
            {preview.auth.needsOwnerPassword ? (
              <Field
                label="كلمة مرور المالك الجديدة *"
                hint="النسخة بلا بيانات تحقق صالحة — عيّن كلمة مرور (4 أحرف/أرقام على الأقل) لحساب المالك في النسخة، وبقية المستخدمين المتضررين يبقون مقفلين"
              >
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={ownerPw}
                    onChange={(e) => setOwnerPw(e.target.value)}
                    style={{ paddingLeft: 38, width: '100%' }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    style={{
                      position: 'absolute',
                      left: 6,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 15,
                      padding: 4,
                      lineHeight: 1,
                      color: 'var(--muted)'
                    }}
                  >
                    {showPw ? '🙈' : '👁'}
                  </button>
                </div>
              </Field>
            ) : null}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn danger" disabled={busy || !canRestore} onClick={() => void doRestore()}>
                {busy ? 'جارٍ الاستعادة…' : preview.auth.needsOwnerPassword ? 'استعادة مع تعيين كلمة المالك' : 'استعادة الآن'}
              </button>
              <button className="btn ghost" onClick={() => setRestoreOpen(false)}>
                تراجع
              </button>
            </div>
            {!canRestore ? (
              <p className="hint" style={{ color: 'var(--muted)', marginTop: 8 }}>
                ضع علامة التأكيد
                {preview.auth.needsOwnerPassword ? ' وأدخل كلمة مرور المالك (4 أحرف/أرقام على الأقل)' : ''} لتفعيل زر الاستعادة.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// =============================================================
// rc.12-merge — إدارة المستخدمين (منقولة من local): إنشاء حسابات الموظفين وأدوارهم،
// تعطيل/تفعيل، وحذف نهائي آمن عبر users.delete (الخلفية تفحص 10 جداول مرجعية
// وترفض حذف من له سجلات نشاط + تحمي المالك المعيّن وآخر مالك نشط).
// القنوات users.list/create/update/delete مسجلة بصلاحية users.manage.
// =============================================================
function UsersCard(): ReactNode {
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<{ username: string; name: string; role: Role; password: string } | null>(null)
  const [deleteFor, setDeleteFor] = useState<UserRow | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await call<UserRow[]>('users.list', {}))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createUser = async (): Promise<void> => {
    if (!form) return
    if (!form.username.trim() || !form.name.trim() || form.password.length < 4) {
      setError('اسم المستخدم والاسم مطلوبان، وكلمة المرور 4 أحرف/أرقام على الأقل')
      return
    }
    setBusy(true)
    setError('')
    try {
      await call('users.create', { ...form, username: form.username.trim().toLowerCase() })
      setNotice(`أُنشئ المستخدم «${form.name}» بدور ${ROLE_LABELS[form.role]}`)
      setForm(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async (): Promise<void> => {
    if (!deleteFor) return
    setBusy(true)
    setError('')
    try {
      await call('users.delete', { id: deleteFor.id })
      setNotice(`حُذف المستخدم «${deleteFor.name}» نهائيًا`)
      setDeleteFor(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDeleteFor(null)
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (u: UserRow): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await call('users.update', { id: u.id, active: u.active !== 1 })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 980, padding: 18, marginTop: 18 }}>
      <h2>👤 إدارة المستخدمين</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 14px' }}>
        إنشاء حسابات الموظفين وأدوارهم. الحذف نهائي ومسموح فقط لمن بلا أي سجلات نشاط — لمن له سجلات استخدم «تعطيل» (يبقى التاريخ سليمًا).
      </p>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      <div style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setForm({ username: '', name: '', role: 'CASHIER', password: '' })}>
          ＋ مستخدم جديد
        </button>
      </div>

      {rows === null ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>جارٍ التحميل…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>المستخدم</th>
              <th>اسم الدخول</th>
              <th>الدور</th>
              <th>الحالة</th>
              <th>PIN</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                </td>
                <td dir="ltr">{u.username}</td>
                <td>{ROLE_LABELS[u.role as Role] ?? u.role}</td>
                <td>{u.active === 1 ? <Badge kind="ok" text="نشط" /> : <Badge kind="muted" text="معطّل" />}</td>
                <td>{u.hasPin === 1 ? '✓' : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost small" disabled={busy} onClick={() => void toggleActive(u)}>
                    {u.active === 1 ? 'تعطيل' : 'تفعيل'}
                  </button>{' '}
                  <button className="btn ghost small" style={{ color: 'var(--err)' }} disabled={busy} onClick={() => setDeleteFor(u)}>
                    حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form ? (
        <Modal title="مستخدم جديد" onClose={() => setForm(null)}>
          <div className="form-row">
            <Field label="اسم الدخول *">
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} dir="ltr" autoFocus />
            </Field>
            <Field label="الاسم الكامل *">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="الدور *">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="كلمة المرور *" hint="4 أحرف/أرقام على الأقل — تُخزَّن مُلبَّدة">
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" />
            </Field>
          </div>
          <button className="btn primary" disabled={busy} onClick={() => void createUser()}>
            {busy ? 'جارٍ الإنشاء…' : 'إنشاء المستخدم'}
          </button>
        </Modal>
      ) : null}

      {deleteFor ? (
        <ConfirmModal
          title={`حذف المستخدم: ${deleteFor.name}`}
          message="سيُحذف الحساب وجلساته نهائيًا. إن كان للمستخدم أي سجلات نشاط (فواتير/حركات/ورديات) سيرفض النظام الحذف ويقترح التعطيل — التاريخ لا يُحذف أبدًا."
          confirmLabel="حذف نهائي"
          busy={busy}
          onConfirm={() => void doDelete()}
          onClose={() => setDeleteFor(null)}
        />
      ) : null}
    </div>
  )
}

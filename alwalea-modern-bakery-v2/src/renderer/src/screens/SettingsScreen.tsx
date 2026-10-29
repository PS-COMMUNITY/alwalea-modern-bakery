// =============================================================
// مخبز الولاء الحديث — شاشة الإعدادات:
// كلمة المرور (وضع الحساب الواحد) + النسخ الاحتياطي والاستعادة (backup.manage)
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionUser } from '../../../shared/types'
import { call, fmtDateTime, ageText, BACKUP_STALE_MS } from '../api'
import { Field, Banner } from '../components/ui'

export default function SettingsScreen(props: { user: SessionUser }): ReactNode {
  const canBackup = props.user.perms.includes('backup.manage')
  return (
    <div>
      <h1>الإعدادات</h1>
      <PasswordCard userId={props.user.id} />
      {canBackup ? <BackupSection /> : null}
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

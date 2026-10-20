// =============================================================
// مخبز الولاء الحديث — شاشة الإعدادات: تغيير كلمة المرور (وضع الحساب الواحد)
// =============================================================
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionUser } from '../../../shared/types'
import { call } from '../api'
import { Field, Banner } from '../components/ui'

export default function SettingsScreen(props: { user: SessionUser }): ReactNode {
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
      await call('users.setPassword', { id: props.user.id, password: next, currentPassword: current })
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
    <div>
      <h1>الإعدادات</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 13 }}>
        تغيير كلمة مرور المالك — تُخزَّن مُلبَّدة (scrypt) ولا يمكن استرجاعها.
      </p>
      <div className="card" style={{ maxWidth: 480, padding: 18 }}>
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
    </div>
  )
}

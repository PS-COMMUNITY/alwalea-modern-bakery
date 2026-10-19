// =============================================================
// مخبز الولاء الحديث — معالج التهيئة لأول تشغيل (مرة واحدة)
// =============================================================
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LoginResult } from '../../../shared/types'
import { call } from '../api'
import { Field, Banner } from '../components/ui'

export default function SetupScreen(props: { onDone: (res: LoginResult) => void }): ReactNode {
  const [businessName, setBusinessName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError('')
    if (!businessName.trim() || !ownerName.trim() || !username.trim()) {
      setError('يرجى تعبئة جميع الحقول')
      return
    }
    if (password.length < 6) {
      setError('كلمة المرور يجب ألا تقل عن 6 أحرف')
      return
    }
    if (password !== password2) {
      setError('كلمتا المرور غير متطابقتين')
      return
    }
    setBusy(true)
    try {
      await call('setup.run', { businessName: businessName.trim(), ownerName: ownerName.trim(), username: username.trim(), password })
      // دخول تلقائي بعد الإعداد
      const res = await call<LoginResult>('auth.login', { username: username.trim(), password })
      props.onDone(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <div className="logo-big" aria-hidden>🥖</div>
        <div className="biz-name">مرحبًا بك في مخبز الولاء الحديث</div>
        <div className="sub">إعداد لمرة واحدة — اسم النشاط وحساب المالك</div>
        {error ? <Banner kind="error" text={error} /> : null}
        <Field label="اسم النشاط">
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="مثال: مخبز الولاء الحديث" autoFocus />
        </Field>
        <Field label="اسم المالك">
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="الاسم الكامل" />
        </Field>
        <Field label="اسم المستخدم">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="owner" dir="ltr" />
        </Field>
        <div className="form-row">
          <Field label="كلمة المرور">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="تأكيد كلمة المرور">
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </Field>
        </div>
        <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={() => void submit()}>
          {busy ? 'جارٍ الإعداد…' : 'إنشاء النشاط وبدء العمل'}
        </button>
        <p className="hint" style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 10 }}>
          تُنشأ قاعدة بيانات محلية آمنة على هذا الجهاز فقط.
        </p>
      </div>
    </div>
  )
}

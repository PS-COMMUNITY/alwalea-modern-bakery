// =============================================================
// مخبز الولاء الحديث — معالج التهيئة لأول تشغيل (مرة واحدة فقط)
// وضع الحساب الواحد: اسم المستخدم owner يُنشأ تلقائيًا في الخادم
// =============================================================
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LoginResult } from '../../../shared/types'
import { call } from '../api'
import { Field, Banner } from '../components/ui'

/** كلمة المرور الأولية الافتراضية — تُخزَّن مُلبَّدة فورًا ويمكن تغييرها من الإعدادات لاحقًا */
const DEFAULT_INITIAL_PASSWORD = '1234'

export default function SetupScreen(props: { onDone: (res: LoginResult) => void }): ReactNode {
  const [businessName, setBusinessName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [password, setPassword] = useState(DEFAULT_INITIAL_PASSWORD)
  const [password2, setPassword2] = useState(DEFAULT_INITIAL_PASSWORD)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError('')
    if (!businessName.trim() || !ownerName.trim()) {
      setError('يرجى تعبئة جميع الحقول')
      return
    }
    if (password.length < 4) {
      setError('كلمة المرور يجب ألا تقل عن 4 أحرف/أرقام')
      return
    }
    if (password !== password2) {
      setError('كلمتا المرور غير متطابقتين')
      return
    }
    setBusy(true)
    try {
      await call('setup.run', { businessName: businessName.trim(), ownerName: ownerName.trim(), password })
      // دخول تلقائي بعد الإعداد
      const res = await call<LoginResult>('auth.login', { password })
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
        <div className="form-row">
          <Field label="كلمة المرور">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="تأكيد كلمة المرور">
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </Field>
        </div>
        <p className="hint" style={{ color: 'var(--muted)', marginBottom: 10 }}>
          4 أحرف/أرقام على الأقل (الافتراضية 1234) — تُخزَّن مُلبَّدة ويمكن تغييرها من الإعدادات.
        </p>
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

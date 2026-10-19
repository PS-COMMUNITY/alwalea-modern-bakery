// =============================================================
// مخبز الولاء الحديث — شاشة تسجيل الدخول
// =============================================================
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LoginResult, StatusInfo } from '../../../shared/types'
import { call } from '../api'
import { Field, Banner } from '../components/ui'

export default function LoginScreen(props: { onLoggedIn: (res: LoginResult) => void }): ReactNode {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [bizName, setBizName] = useState('مخبز الولاء الحديث')

  useEffect(() => {
    void (async () => {
      try {
        const st = await call<StatusInfo>('status.get')
        if (st.businessName) setBizName(st.businessName)
      } catch {
        /* تجاهل */
      }
    })()
  }, [])

  const submit = async (): Promise<void> => {
    setError('')
    if (!username.trim() || !password) {
      setError('أدخل اسم المستخدم وكلمة المرور')
      return
    }
    setBusy(true)
    try {
      const res = await call<LoginResult>('auth.login', { username: username.trim(), password })
      props.onLoggedIn(res)
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
        <div className="biz-name">{bizName}</div>
        <div className="sub">سجّل الدخول للمتابعة</div>
        {error ? <Banner kind="error" text={error} /> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label="اسم المستخدم">
            <input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoFocus />
          </Field>
          <Field label="كلمة المرور">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>
        </form>
        <p className="hint" style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 10 }}>
          يُقفل الحساب مؤقتًا 5 دقائق بعد 5 محاولات فاشلة.
        </p>
      </div>
    </div>
  )
}

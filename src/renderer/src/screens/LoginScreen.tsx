// =============================================================
// مخبز الولاء الحديث — شاشة تسجيل الدخول (كلمة مرور واحدة — وضع الحساب الواحد)
// =============================================================
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LoginResult, StatusInfo } from '../../../shared/types'
import { call } from '../api'
import { Field, Banner } from '../components/ui'
import { IconEye, IconEyeOff } from '../components/icons'

export default function LoginScreen(props: { onLoggedIn: (res: LoginResult) => void }): ReactNode {
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
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
    if (!password) {
      setError('أدخل كلمة المرور')
      return
    }
    setBusy(true)
    try {
      // الجلسة تُربط تلقائيًا بحساب المالك في الخادم — لا اسم مستخدم ولا اختيار أدوار
      const res = await call<LoginResult>('auth.login', { password })
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
        <div className="sub">أدخل كلمة المرور للدخول إلى النظام</div>
        {error ? <Banner kind="error" text={error} /> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label="كلمة المرور">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingLeft: 40, width: '100%' }}
                autoFocus
              />
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
                  padding: 5,
                  lineHeight: 1,
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                {showPw ? <IconEyeOff size={17} /> : <IconEye size={17} />}
              </button>
            </div>
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

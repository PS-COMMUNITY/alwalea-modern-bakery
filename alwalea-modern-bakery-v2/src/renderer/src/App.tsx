// =============================================================
// مخبز الولاء الحديث — جذر التطبيق: تهيئة → دخول → الهيكل
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { SessionUser, StatusInfo, LoginResult, AppSettings } from '../../shared/types'
import { call, setToken } from './api'
import SetupScreen from './screens/SetupScreen'
import LoginScreen from './screens/LoginScreen'
import AppShell from './screens/AppShell'

type Phase = 'boot' | 'setup' | 'login' | 'shell'

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot')
  const [bootError, setBootError] = useState('')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [business, setBusiness] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const refreshSettings = useCallback(async (): Promise<void> => {
    try {
      const s = await call<AppSettings>('settings.get')
      setSettings(s)
      setBusiness(s.businessName)
    } catch {
      /* تجاهل — تُعرض القيمة السابقة */
    }
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const st = await call<StatusInfo>('status.get')
        if (!alive) return
        if (st.setupCompleted) setPhase('login')
        else setPhase('setup')
      } catch (e) {
        if (alive) setBootError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const handleLoggedIn = useCallback((res: LoginResult) => {
    setToken(res.token)
    setUser(res.user)
    setBusiness(res.businessName)
    setPhase('shell')
    void (async () => {
      try {
        setSettings(await call<AppSettings>('settings.get'))
      } catch {
        /* تجاهل */
      }
    })()
  }, [])

  const handleLogout = useCallback((): void => {
    void (async () => {
      try {
        await call('auth.logout')
      } catch {
        /* تجاهل */
      }
      setToken(null)
      setUser(null)
      setPhase('login')
    })()
  }, [])

  if (phase === 'boot') {
    return (
      <div className="center-screen">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="logo-big" aria-hidden>🥖</div>
          <div className="biz-name">جارٍ التحميل…</div>
          {bootError ? <p style={{ color: 'var(--err)' }}>{bootError}</p> : null}
        </div>
      </div>
    )
  }

  if (phase === 'setup') {
    return <SetupScreen onDone={handleLoggedIn} />
  }

  if (phase === 'login' || user === null) {
    return (
      <LoginScreen
        onLoggedIn={handleLoggedIn}
      />
    )
  }

  return (
    <AppShell
      user={user}
      business={business}
      settings={settings}
      onLogout={handleLogout}
      onSettingsChanged={refreshSettings}
    />
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { AuthUser, Settings, StatusInfo } from '@/lib/bakery/types'
import { Shell, type PageId } from '@/components/bakery/shell'
import { SetupWizard } from '@/components/bakery/screens/setup-wizard'
import { LoginScreen } from '@/components/bakery/screens/login-screen'
import { Dashboard } from '@/components/bakery/screens/dashboard'
import { PosScreen } from '@/components/bakery/screens/pos'
import { SalesScreen } from '@/components/bakery/screens/sales'
import { ProductsScreen } from '@/components/bakery/screens/products'
import { InventoryScreen } from '@/components/bakery/screens/inventory'
import { CustomersScreen } from '@/components/bakery/screens/customers'
import { SuppliersScreen } from '@/components/bakery/screens/suppliers'
import { PurchasesScreen } from '@/components/bakery/screens/purchases'
import { ProductionScreen } from '@/components/bakery/screens/production'
import { DistributionScreen } from '@/components/bakery/screens/distribution'
import { ExpensesScreen } from '@/components/bakery/screens/expenses'
import { ShiftsScreen } from '@/components/bakery/screens/shifts'
import { ReportsScreen } from '@/components/bakery/screens/reports'
import { AuditScreen } from '@/components/bakery/screens/audit'
import { SettingsScreen } from '@/components/bakery/screens/settings-screen'
import { LoadingRows } from '@/components/bakery/kit'

type AppState = 'loading' | 'setup' | 'login' | 'locked' | 'ready'

export default function BakeryApp() {
  const [state, setState] = useState<AppState>('loading')
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [page, setPage] = useState<PageId>('dashboard')
  const [bootError, setBootError] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.get<StatusInfo>('/api/status')
      setStatus(s)
      if (!s.setupCompleted) {
        setState('setup')
        return
      }
      // من لديه جلسة قائمة؟
      try {
        const me = await api.get<{ user: AuthUser | null }>('/api/auth/me')
        if (me.user) {
          setUser(me.user)
          const st = await api.get<Settings>('/api/settings')
          setSettings(st)
          setState('ready')
        } else {
          setState('login')
        }
      } catch {
        setState('login')
      }
    } catch (e) {
      setBootError(e instanceof Error ? e.message : 'تعذر الاتصال بالخدمة المحلية')
      setState('login')
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      void loadStatus()
    }, 0)
    return () => clearTimeout(t)
  }, [loadStatus])

  const handleSetupDone = useCallback(async () => {
    await loadStatus()
  }, [loadStatus])

  const handleLogin = useCallback(async (u: AuthUser) => {
    const st = await api.get<Settings>('/api/settings')
    setSettings(st)
    setUser(u)
    setState('ready')
    setPage('dashboard')
  }, [])

  const handleLock = useCallback(() => {
    setUser(null)
    setState('locked')
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } catch { /* تجاهل */ }
    setUser(null)
    setState('login')
  }, [])

  const refreshSettings = useCallback(async () => {
    try {
      const st = await api.get<Settings>('/api/settings')
      setSettings(st)
      setStatus(prev => (prev ? { ...prev, businessName: st.businessName } : prev))
    } catch { /* تجاهل */ }
  }, [])

  const content = useMemo(() => {
    if (state === 'loading') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-cream-100">
          <div className="w-full max-w-md space-y-3 p-6">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-cocoa-900 text-3xl font-black text-copper-400">و</div>
              <div className="text-lg font-bold">مخبز الولاء الحديث</div>
              <div className="text-sm text-muted-foreground">جارٍ تحميل النظام…</div>
            </div>
            <LoadingRows rows={3} />
          </div>
        </div>
      )
    }
    if (state === 'setup') {
      return <SetupWizard onDone={handleSetupDone} />
    }
    if (state === 'login' || state === 'locked') {
      return (
        <LoginScreen
          businessName={status?.businessName ?? 'مخبز الولاء الحديث'}
          locked={state === 'locked'}
          bootError={bootError}
          onLogin={handleLogin}
        />
      )
    }
    if (state === 'ready' && user && settings) {
      const screens: Record<PageId, React.ReactNode> = {
        dashboard: <Dashboard />,
        pos: <PosScreen />,
        sales: <SalesScreen />,
        products: <ProductsScreen />,
        inventory: <InventoryScreen />,
        customers: <CustomersScreen />,
        suppliers: <SuppliersScreen />,
        purchases: <PurchasesScreen />,
        production: <ProductionScreen />,
        distribution: <DistributionScreen />,
        expenses: <ExpensesScreen />,
        shifts: <ShiftsScreen />,
        reports: <ReportsScreen />,
        audit: <AuditScreen />,
        settings: <SettingsScreen onSettingsChanged={refreshSettings} />,
      }
      return (
        <Shell user={user} settings={settings} onLock={handleLock} onLogout={handleLogout} page={page} setPage={setPage}>
          {screens[page]}
        </Shell>
      )
    }
    return null
  }, [state, status, user, settings, page, bootError, handleSetupDone, handleLogin, handleLock, handleLogout, refreshSettings])

  return content
}

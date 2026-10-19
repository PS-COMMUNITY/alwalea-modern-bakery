'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/bakery/client'
import type { AuthUser, Settings, StatusInfo } from '@/lib/bakery/types'
import { ROLE_PERMS, type Perm } from '@/lib/bakery/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  BarChart3, Boxes, ChefHat, ClipboardList, Contact, Landmark, LayoutDashboard,
  LogOut, Menu, Package, Receipt, Route, ScrollText, Settings as SettingsIcon, Store, Truck, Wallet, X,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// =============================================================
// سياق الجلسة — متاح لكل الشاشات
// =============================================================

export type SessionCtx = {
  user: AuthUser
  settings: Settings
  refreshSettings: () => Promise<void>
  lock: () => void
  logout: () => Promise<void>
  can: (perm: Perm) => boolean
  money: (minor: number | null | undefined) => string
}

const Ctx = createContext<SessionCtx | null>(null)

export function useSession(): SessionCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession خارج الجلسة')
  return v
}

export function hasPerm(role: string, perm: Perm): boolean {
  const perms = ROLE_PERMS[role as keyof typeof ROLE_PERMS]
  return !!perms && perms.includes(perm)
}

// =============================================================
// القائمة الجانبية
// =============================================================

export type PageId =
  | 'dashboard' | 'pos' | 'sales' | 'products' | 'inventory' | 'customers' | 'suppliers'
  | 'purchases' | 'production' | 'distribution' | 'expenses' | 'shifts' | 'reports' | 'audit' | 'settings'

const NAV: { id: PageId; label: string; icon: typeof LayoutDashboard; perm?: Perm }[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'pos', label: 'نقطة البيع', icon: Store, perm: 'pos.use' },
  { id: 'sales', label: 'المبيعات والفواتير', icon: Receipt, perm: 'sales.view' },
  { id: 'products', label: 'المنتجات', icon: Package, perm: 'products.view' },
  { id: 'inventory', label: 'المخزون', icon: Boxes, perm: 'inventory.view' },
  { id: 'customers', label: 'العملاء والديون', icon: Contact, perm: 'customers.view' },
  { id: 'suppliers', label: 'الموردون', icon: Truck, perm: 'suppliers.view' },
  { id: 'purchases', label: 'المشتريات', icon: ClipboardList, perm: 'purchases.view' },
  { id: 'production', label: 'الإنتاج والوصفات', icon: ChefHat, perm: 'production.view' },
  { id: 'distribution', label: 'التوزيع والمندوبون', icon: Route, perm: 'distribution.view' },
  { id: 'expenses', label: 'المصروفات', icon: Wallet, perm: 'expenses.view' },
  { id: 'shifts', label: 'الخزينة والورديات', icon: Landmark, perm: 'shifts.view' },
  { id: 'reports', label: 'التقارير', icon: BarChart3, perm: 'reports.operations' },
  { id: 'audit', label: 'سجل التدقيق', icon: ScrollText, perm: 'audit.view' },
  { id: 'settings', label: 'الإعدادات', icon: SettingsIcon, perm: 'settings.manage' },
]

// =============================================================
// الهيكل الرئيسي
// =============================================================

export function Shell({
  user, settings, onLock, onLogout, page, setPage, children,
}: {
  user: AuthUser
  settings: Settings
  onLock: () => void
  onLogout: () => Promise<void>
  page: PageId
  setPage: (p: PageId) => void
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { toast } = useToast()

  // قفل الخمول وفق الإعدادات
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleMinutes = settings.idleLockMinutes ?? 15

  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      onLock()
    }, idleMinutes * 60_000)
  }, [idleMinutes, onLock])

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    for (const e of events) window.addEventListener(e, resetIdle, { passive: true })
    resetIdle()
    return () => {
      for (const e of events) window.removeEventListener(e, resetIdle)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [resetIdle])

  const refreshSettings = useCallback(async () => {
    // تُحدَّث عبر الطبقة الخارجية عند الحاجة
  }, [])

  const can = useCallback((perm: Perm) => hasPerm(user.role, perm), [user.role])

  const money = useCallback(
    (minor: number | null | undefined) => {
      const v = ((minor ?? 0) / Math.pow(10, settings.currencyDecimals ?? 2)).toLocaleString('en-US', {
        minimumFractionDigits: settings.currencyDecimals ?? 2,
        maximumFractionDigits: settings.currencyDecimals ?? 2,
      })
      return `${v} ${settings.currencySymbol ?? '₪'}`
    },
    [settings.currencySymbol, settings.currencyDecimals],
  )

  const ctx: SessionCtx = { user, settings, refreshSettings, lock: onLock, logout: onLogout, can, money }

  const items = NAV.filter(n => !n.perm || can(n.perm))

  return (
    <Ctx.Provider value={ctx}>
      <div className="min-h-screen flex flex-col bg-background" dir="rtl">
        {/* الترويسة */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-cocoa-900 px-4 text-cream-100 shadow-sm">
          <button
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-cocoa-700"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label={sidebarOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-copper-500 text-lg font-black text-cocoa-950" aria-hidden>
              و
            </span>
            <div className="min-w-0">
              <div className="truncate font-bold leading-tight">{settings.businessName}</div>
              <div className="text-[11px] text-copper-300 leading-tight">نظام الإدارة المحلي</div>
            </div>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <div className="hidden sm:block text-end">
              <div className="text-sm font-semibold leading-tight">{user.displayName}</div>
              <div className="text-[11px] text-copper-300 leading-tight">{user.username}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-cream-100 hover:bg-cocoa-700 hover:text-cream-100"
              onClick={() => {
                void onLogout()
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">خروج</span>
            </Button>
          </div>
        </header>

        <div className="flex flex-1">
          {/* القائمة الجانبية — ثابتة على الشاشات الكبيرة */}
          <aside
            className={cn(
              'fixed inset-y-14 start-0 z-30 w-64 border-e border-cocoa-700 bg-cocoa-900 text-cream-100 transition-transform md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:translate-x-0',
              sidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0',
            )}
          >
            <nav className="nice-scroll flex h-full flex-col gap-0.5 overflow-y-auto p-3" aria-label="القائمة الرئيسية">
              {items.map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    setPage(item.id)
                    setSidebarOpen(false)
                  }}
                  aria-current={page === item.id ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    page === item.id
                      ? 'bg-copper-500 text-cocoa-950 shadow-sm'
                      : 'text-cream-100/85 hover:bg-cocoa-700 hover:text-cream-100',
                  )}
                >
                  <item.icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
              <div className="mt-auto pt-3">
                <div className="rounded-lg bg-cocoa-800 p-3 text-[11px] leading-relaxed text-cocoa-200">
                  <div className="font-bold text-copper-300">مخبز الولاء الحديث</div>
                  <div>قاعدة بيانات محلية — تعمل دون إنترنت</div>
                </div>
              </div>
            </nav>
          </aside>

          {sidebarOpen ? (
            <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />
          ) : null}

          {/* المحتوى */}
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>

        {/* تذييل مثبت أسفل الشاشة */}
        <footer className="mt-auto border-t bg-card px-4 py-2 text-center text-[11px] text-muted-foreground">
          <span className="font-semibold text-cocoa-700 dark:text-cream-200">{settings.businessName}</span>
          <span className="mx-2">•</span>
          نظام الإدارة المحلي v1.0.0
          <span className="mx-2">•</span>
          البيانات محفوظة على هذا الجهاز
        </footer>
      </div>
    </Ctx.Provider>
  )
}

/** غلاف الشاشة الجاهزة — يمرر السياق */
export function WithSession({
  user, settings, onLock, onLogout, page, setPage, children,
}: Omit<Parameters<typeof Shell>[0], 'children'> & { children: React.ReactNode }) {
  return (
    <Shell user={user} settings={settings} onLock={onLock} onLogout={onLogout} page={page} setPage={setPage}>
      {children}
    </Shell>
  )
}

export async function fetchStatus(): Promise<StatusInfo> {
  return api.get<StatusInfo>('/api/status')
}

export function useLockToast() {
  const { toast } = useToast()
  return useCallback(
    (title: string, description?: string) => toast({ title, description }),
    [toast],
  )
}

// =============================================================
// مخبز الولاء الحديث — هيكل التطبيق: قائمة جانبية RTL + ترويسة
// اسم النشاط ديناميكي من الإعدادات، والقائمة تُفلتر بالصلاحيات.
// =============================================================
import { useState } from 'react'
import type { SessionUser, AppSettings } from '../../../shared/types'
import { ROLE_LABELS, type Role } from '../../../shared/permissions'
import type { ReactNode } from 'react'
import DashboardScreen from './DashboardScreen'
import ProductsScreen from './ProductsScreen'
import PosScreen from './PosScreen'
import CustomersScreen from './CustomersScreen'
import InventoryScreen from './InventoryScreen'
import ReportsScreen from './ReportsScreen'

interface NavDef {
  key: string
  label: string
  icon: string
  perm: string
}

const NAV: NavDef[] = [
  { key: 'dashboard', label: 'لوحة التحكم', icon: '🏠', perm: 'reports.operations' },
  { key: 'pos', label: 'نقطة البيع', icon: '🧾', perm: 'pos.use' },
  { key: 'products', label: 'المنتجات', icon: '🥐', perm: 'products.view' },
  { key: 'inventory', label: 'المخزون', icon: '📦', perm: 'inventory.view' },
  { key: 'customers', label: 'العملاء', icon: '👥', perm: 'customers.view' },
  { key: 'reports', label: 'التقارير', icon: '📊', perm: 'reports.financial' }
]

export default function AppShell(props: {
  user: SessionUser
  business: string
  settings: AppSettings | null
  onLogout: () => void
  onSettingsChanged: () => Promise<void>
}): ReactNode {
  const [tab, setTab] = useState<string>(() => {
    const first = NAV.find((n) => props.user.perms.includes(n.perm))
    return first ? first.key : 'dashboard'
  })

  const perms = props.user.perms
  const items = NAV.filter((n) => perms.includes(n.perm))
  const activeNav = NAV.find((n) => n.key === tab)

  const renderScreen = (): ReactNode => {
    switch (tab) {
      case 'dashboard':
        return <DashboardScreen user={props.user} />
      case 'pos':
        return <PosScreen user={props.user} settings={props.settings} />
      case 'products':
        return <ProductsScreen />
      case 'customers':
        return <CustomersScreen />
      case 'inventory':
        return <InventoryScreen user={props.user} />
      case 'reports':
        return <ReportsScreen />
      default:
        return <DashboardScreen user={props.user} />
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo" aria-hidden>🥖</div>
          <div>
            <div className="name">{props.business || 'مخبز الولاء'}</div>
            <div className="sub">نظام إدارة المخبز</div>
          </div>
        </div>
        {items.map((n) => (
          <button
            key={n.key}
            className={`nav-item${tab === n.key ? ' active' : ''}`}
            onClick={() => setTab(n.key)}
          >
            <span className="ico" aria-hidden>{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        <div className="user-box">
          <div>👤 {props.user.name}</div>
          <div className="role">{ROLE_LABELS[props.user.role as Role] ?? props.user.role}</div>
          <button className="btn ghost small" style={{ marginTop: 8, width: '100%', color: 'var(--ivory)', borderColor: 'rgba(255,248,240,0.3)' }} onClick={props.onLogout}>
            تسجيل الخروج ⏻
          </button>
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="biz">{props.business || 'مخبز الولاء'}</div>
          <div className="crumb">{activeNav ? `${activeNav.icon} ${activeNav.label}` : ''}</div>
        </header>
        <main className="content">{renderScreen()}</main>
      </div>
    </div>
  )
}

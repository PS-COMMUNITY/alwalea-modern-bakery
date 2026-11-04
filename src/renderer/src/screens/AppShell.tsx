// =============================================================
// مخبز الولاء الحديث — هيكل التطبيق: قائمة جانبية RTL + ترويسة
// أيقونات SVG محلية (بلا إيموجي) — مظهر مؤسسي هادئ
// اسم النشاط ديناميكي من الإعدادات، والقائمة تُفلتر بالصلاحيات.
// =============================================================
import { useState } from 'react'
import type { SessionUser, AppSettings } from '../../../shared/types'
import { ROLE_LABELS, type Role } from '../../../shared/permissions'
import type { ReactNode } from 'react'
import type { ComponentType } from 'react'
import {
  IconDashboard, IconPos, IconProducts, IconInventory, IconCustomers,
  IconSuppliers, IconCart, IconReceipt, IconBread, IconBike, IconCash,
  IconCount, IconCalc, IconAudit, IconReports, IconSettings,
  IconUser, IconPower
} from '../components/icons'
import DashboardScreen from './DashboardScreen'
import ProductsScreen from './ProductsScreen'
import PosScreen from './PosScreen'
import CustomersScreen from './CustomersScreen'
import SuppliersScreen from './SuppliersScreen'
import PurchasesScreen from './PurchasesScreen'
import SalesScreen from './SalesScreen'
import ProductionScreen from './ProductionScreen'
import DistributionScreen from './DistributionScreen'
import ShiftsScreen from './ShiftsScreen'
import StockCountScreen from './StockCountScreen'
import ExpensesScreen from './ExpensesScreen'
import AuditScreen from './AuditScreen'
import InventoryScreen from './InventoryScreen'
import ReportsScreen from './ReportsScreen'
import SettingsScreen from './SettingsScreen'

interface NavDef {
  key: string
  label: string
  Icon: ComponentType<{ size?: number; className?: string }>
  perm: string
  always?: boolean
}

const NAV: NavDef[] = [
  { key: 'dashboard', label: 'لوحة التحكم', Icon: IconDashboard, perm: 'reports.operations' },
  { key: 'pos', label: 'نقطة البيع', Icon: IconPos, perm: 'pos.use' },
  { key: 'products', label: 'المنتجات', Icon: IconProducts, perm: 'products.view' },
  { key: 'inventory', label: 'المخزون', Icon: IconInventory, perm: 'inventory.view' },
  { key: 'customers', label: 'العملاء', Icon: IconCustomers, perm: 'customers.view' },
  { key: 'suppliers', label: 'الموردون', Icon: IconSuppliers, perm: 'suppliers.view' },
  { key: 'purchases', label: 'المشتريات', Icon: IconCart, perm: 'purchases.view' },
  { key: 'sales', label: 'المبيعات', Icon: IconReceipt, perm: 'sales.view' },
  { key: 'production', label: 'الإنتاج', Icon: IconBread, perm: 'production.view' },
  { key: 'distribution', label: 'التوزيع', Icon: IconBike, perm: 'distribution.view' },
  { key: 'shifts', label: 'الورديات والصندوق', Icon: IconCash, perm: 'shifts.view' },
  { key: 'period', label: 'الجرد والإقفال', Icon: IconCount, perm: 'inventory.view' },
  { key: 'expenses', label: 'المصروفات', Icon: IconCalc, perm: 'expenses.view' },
  { key: 'audit', label: 'سجل التدقيق', Icon: IconAudit, perm: 'audit.view' },
  { key: 'reports', label: 'التقارير', Icon: IconReports, perm: 'reports.financial' },
  { key: 'settings', label: 'الإعدادات', Icon: IconSettings, perm: '', always: true }
]

const todayLabel = (): string => {
  try {
    return new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  } catch {
    return ''
  }
}

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
  const [dateLabel] = useState<string>(todayLabel)

  const perms = props.user.perms
  const items = NAV.filter((n) => n.always || perms.includes(n.perm))
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
      case 'suppliers':
        return <SuppliersScreen user={props.user} />
      case 'purchases':
        return <PurchasesScreen user={props.user} />
      case 'sales':
        return <SalesScreen user={props.user} />
      case 'production':
        return <ProductionScreen user={props.user} />
      case 'distribution':
        return <DistributionScreen user={props.user} />
      case 'shifts':
        return <ShiftsScreen user={props.user} />
      case 'period':
        return <StockCountScreen user={props.user} settings={props.settings} />
      case 'expenses':
        return <ExpensesScreen user={props.user} />
      case 'audit':
        return <AuditScreen />
      case 'inventory':
        return <InventoryScreen user={props.user} />
      case 'reports':
        return <ReportsScreen />
      case 'settings':
        return <SettingsScreen user={props.user} />
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
        <nav className="nav-scroll" aria-label="التنقل الرئيسي">
          {items.map((n) => (
            <button
              key={n.key}
              className={`nav-item${tab === n.key ? ' active' : ''}`}
              onClick={() => setTab(n.key)}
              aria-current={tab === n.key ? 'page' : undefined}
            >
              <span className="ico" aria-hidden><n.Icon size={18} /></span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="user-box">
          <div className="who">
            <span className="ico" aria-hidden><IconUser size={16} /></span>
            <span>{props.user.name}</span>
          </div>
          <div className="role">{ROLE_LABELS[props.user.role as Role] ?? props.user.role}</div>
          <button className="btn ghost small" style={{ marginTop: 8, width: '100%', color: 'var(--ivory)', borderColor: 'rgba(255,248,240,0.3)' }} onClick={props.onLogout}>
            <IconPower size={14} /> تسجيل الخروج
          </button>
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="biz">{props.business || 'مخبز الولاء'}</div>
          <div className="crumb">
            {activeNav ? (<><span className="ico" aria-hidden><activeNav.Icon size={15} /></span>{activeNav.label}</>) : ''}
            <span className="divider" aria-hidden>•</span>
            <span className="today">{dateLabel}</span>
          </div>
        </header>
        <main className="content">{renderScreen()}</main>
      </div>
    </div>
  )
}

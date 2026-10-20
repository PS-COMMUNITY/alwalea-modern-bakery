'use client'

// =============================================================
// التقارير — 12 تقريرًا مشتقًا من الحركات الفعلية فقط
// شريط فلاتر موحد (من/إلى) + بطاقات وجداول + تصدير CSV للأصول
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import { PAYMENT_METHOD_LABELS } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  EmptyState, ErrorBanner, LoadingRows, PageHeader, StatCard, TableShell,
  qty as fmtQty,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { AlertTriangle, Download } from 'lucide-react'

// ===== أنواع الاستجابات (كما تعيد مسارات /api/reports) =====

type SalesReport = {
  totals: { invoicesCount: number; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; creditMinor: number }
  daily: { date: string; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; creditMinor: number; invoicesCount: number }[]
  byProduct: { productId: string; productName: string; qtyMilli: number; totalMinor: number }[]
  byCustomer: { customerId: string | null; customerName: string; invoicesCount: number; totalMinor: number; creditMinor: number }[]
}

type CollectionsReport = {
  totalMinor: number
  paymentsCount: number
  daily: { date: string; totalMinor: number; byMethod: Record<string, number> }[]
  byMethod: { method: string; amountMinor: number }[]
}

type DebtsReport = {
  totalDebtMinor: number
  debtorsCount: number
  items: { customerId: string; customerName: string; phone: string | null; debtMinor: number }[]
}

type SuppliersReport = {
  totalDueMinor: number
  suppliersCount: number
  items: { supplierId: string; supplierName: string; phone: string | null; dueMinor: number }[]
}

type PurchasesReport = {
  totals: { invoicesCount: number; subtotalMinor: number; discountMinor: number; totalMinor: number; paidMinor: number }
  daily: { date: string; subtotalMinor: number; discountMinor: number; totalMinor: number; invoicesCount: number }[]
  bySupplier: { supplierId: string; supplierName: string; invoicesCount: number; totalMinor: number; paidMinor: number }[]
}

type InventoryValuationReport = {
  totalValueMinor: number
  itemsCount: number
  items: { productId: string; name: string; type: string; baseUnit: string; costMinor: number; active: boolean; trackStock: boolean; balanceMilli: number; valueMinor: number }[]
}

type ProductionReport = {
  totals: { batchesCount: number; plannedQtyMilli: number; actualQtyMilli: number; wasteQtyMilli: number; materialsCostMinor: number; avgEfficiencyPercent: number }
  items: { id: string; batchNo: string; date: string; status: string; recipeName: string; outputProductName: string; plannedQtyMilli: number; actualQtyMilli: number; wasteQtyMilli: number; materialsCostMinor: number; unitCostMinor: number; efficiencyPercent: number; wastePercent: number }[]
}

type ExpensesReport = {
  totalMinor: number
  count: number
  daily: { date: string; totalMinor: number; count: number }[]
  byCategory: { categoryId: string; categoryName: string; totalMinor: number; count: number }[]
}

type CashReport = {
  netMinor: number
  inflowMinor: number
  outflowMinor: number
  movementsCount: number
  byType: { type: string; totalMinor: number; count: number }[]
}

type DistributionReport = {
  totals: { tripsCount: number; settledCount: number; openCount: number; loadedMilli: number; soldMilli: number; returnedGoodMilli: number; returnedDamagedMilli: number; cashMinor: number; creditMinor: number }
  byRep: { repId: string; repName: string; tripsCount: number; loadedMilli: number; soldMilli: number; returnedGoodMilli: number; returnedDamagedMilli: number; cashMinor: number; creditMinor: number }[]
  trips: { id: string; tripNo: string; date: string; status: string; repName: string }[]
}

type ProfitReport = {
  definition: string
  sales: { invoicesCount: number; totalMinor: number; discountMinor: number; creditMinor: number }
  cogsMinor: number
  grossProfitMinor: number
  cashExpensesMinor: number
  cashExpensesCount: number
  estimatedSurplusMinor: number
  marginPercent: number
}

type DashboardReport = {
  today: { salesTotalMinor: number; invoicesCount: number; creditMinor: number; collectedMinor: number; expensesMinor: number }
  yesterday: { salesTotalMinor: number; invoicesCount: number; creditMinor: number; collectedMinor: number; expensesMinor: number }
  stockAlerts: { count: number; items: { productId: string; name: string; baseUnit: string; balanceMilli: number; minStockMilli: number }[] }
  latestSales: { id: string; invoiceNo: string; customerName: string; totalMinor: number; creditMinor: number }[]
  customerDebts: { totalMinor: number; debtorsCount: number }
  openOperations: { openTripsCount: number; openShift: { id: string; openedAt: string; openingCashMinor: number } | null }
}

type ReportState =
  | { key: string; kind: 'idle' }
  | { key: string; kind: 'error'; error: string }
  | { key: string; kind: 'data'; data: unknown }

const CASH_TYPE_LABELS: Record<string, string> = {
  OPENING_CASH: 'افتتاحي',
  SALE_CASH: 'مبيعات نقدية',
  CUSTOMER_PAYMENT: 'تحصيل عميل',
  PURCHASE_PAYMENT: 'دفعة مورد',
  EXPENSE: 'مصروف',
  TRIP_CASH_IN: 'نقد جولة',
  ADJUSTMENT: 'تسوية',
  DRAWER_OUT: 'سحب من الدرج',
  DEPOSIT: 'إيداع',
}

function fmtISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function signedMoney(minor: number, fmt: (m: number) => string): string {
  if (minor > 0) return `+${fmt(minor)}`
  if (minor < 0) return `−${fmt(Math.abs(minor))}`
  return fmt(0)
}

export function ReportsScreen() {
  const { money, can } = useSession()
  const { toast } = useToast()
  const canFinancial = can('reports.financial')

  // ===== الفلاتر الموحدة =====
  const monthStart = fmtISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [fromDraft, setFromDraft] = useState(monthStart)
  const [toDraft, setToDraft] = useState(fmtISO(new Date()))
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(fmtISO(new Date()))

  const [tab, setTab] = useState('dashboard')
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState<ReportState>({ key: '', kind: 'idle' })

  const applyFilters = useCallback(() => {
    setFrom(fromDraft)
    setTo(toDraft)
  }, [fromDraft, toDraft])

  // مفتاح الطلب — تغيّره يعني أن الطلب الحالي قديم (قيد التحميل)
  const reqKey = `${tab}|${from}|${to}|${retryNonce}`
  const loading = state.key !== reqKey

  // تحميل التقرير — setState فقط بعد await (لا setState متزامن داخل Effect)
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    void (async () => {
      try {
        let data: unknown = null
        switch (tab) {
          case 'dashboard':
            data = await api.get<DashboardReport>('/api/reports/dashboard')
            break
          case 'sales':
            data = await api.get<SalesReport>(`/api/reports/sales?${params.toString()}`)
            break
          case 'collections':
            data = await api.get<CollectionsReport>(`/api/reports/collections?${params.toString()}`)
            break
          case 'debts':
            data = await api.get<DebtsReport>('/api/reports/debts')
            break
          case 'suppliers':
            data = await api.get<SuppliersReport>('/api/reports/suppliers')
            break
          case 'purchases':
            data = await api.get<PurchasesReport>(`/api/reports/purchases?${params.toString()}`)
            break
          case 'inventory':
            data = await api.get<InventoryValuationReport>('/api/reports/inventory-valuation')
            break
          case 'production':
            data = await api.get<ProductionReport>(`/api/reports/production?${params.toString()}`)
            break
          case 'expenses':
            data = await api.get<ExpensesReport>(`/api/reports/expenses?${params.toString()}`)
            break
          case 'cash':
            data = await api.get<CashReport>(`/api/reports/cash?${params.toString()}`)
            break
          case 'distribution':
            data = await api.get<DistributionReport>(`/api/reports/distribution?${params.toString()}`)
            break
          case 'profit':
            data = await api.get<ProfitReport>(`/api/reports/profit?${params.toString()}`)
            break
          default:
            data = null
        }
        if (!cancelled) setState({ key: reqKey, kind: 'data', data })
      } catch (e) {
        if (!cancelled) {
          setState({
            key: reqKey,
            kind: 'error',
            error: e instanceof ApiError ? e.message : 'تعذر تحميل التقرير',
          })
        }
      }
    })()
    return () => { cancelled = true }
  }, [from, reqKey, tab, to])

  // التبويبات حسب الصلاحية
  const tabs: { id: string; label: string }[] = [
    { id: 'dashboard', label: 'لوحة' },
    ...(canFinancial ? [
      { id: 'sales', label: 'المبيعات' },
      { id: 'collections', label: 'التحصيلات' },
      { id: 'debts', label: 'ديون العملاء' },
      { id: 'suppliers', label: 'أرصدة الموردين' },
      { id: 'purchases', label: 'المشتريات' },
      { id: 'expenses', label: 'المصروفات' },
      { id: 'cash', label: 'الصندوق' },
      { id: 'profit', label: 'الربح التقديري' },
    ] : []),
    { id: 'inventory', label: 'المخزون' },
    { id: 'production', label: 'الإنتاج' },
    { id: 'distribution', label: 'التوزيع' },
  ]

  const exportCsv = useCallback(async (entity: string) => {
    try {
      await api.download(`/api/export/${entity}`, `${entity}.csv`)
      toast({ title: 'بدأ تنزيل الملف', description: `تصدير ${entity} بصيغة CSV.` })
    } catch (e) {
      toast({
        title: 'تعذر التصدير',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    }
  }, [toast])

  return (
    <div>
      <PageHeader
        title="التقارير"
        subtitle="كل الأرقام مشتقة من الحركات الفعلية المسجلة — لا تقديرات إلا حيث يُصرّح بذلك"
      />

      {/* شريط الفلاتر الموحد */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3" role="search" aria-label="فلاتر التقارير">
        <div className="space-y-1">
          <Label htmlFor="rep-from" className="text-xs">من</Label>
          <Input id="rep-from" type="date" value={fromDraft} onChange={e => setFromDraft(e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rep-to" className="text-xs">إلى</Label>
          <Input id="rep-to" type="date" value={toDraft} onChange={e => setToDraft(e.target.value)} className="h-10" />
        </div>
        <Button type="button" className="h-10" onClick={applyFilters}>تطبيق</Button>
        <span className="text-xs text-muted-foreground">افتراضيًا: الشهر الحالي</span>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto flex-wrap">
          {tabs.map(t => (
            <TabsTrigger key={t.id} value={t.id} className="px-3.5">{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* حالة التحميل/الخطأ */}
      {loading ? <LoadingRows rows={6} /> : null}
      {!loading && state.kind === 'error' ? <ErrorBanner message={state.error} onRetry={() => setRetryNonce(n => n + 1)} /> : null}

      {/* ==================== المحتوى ==================== */}
      {!loading && state.kind === 'data' && tab === 'dashboard' ? <DashboardView data={state.data as DashboardReport} money={money} /> : null}
      {!loading && state.kind === 'data' && tab === 'sales' ? <SalesView data={state.data as SalesReport} money={money} /> : null}
      {!loading && state.kind === 'data' && tab === 'collections' ? <CollectionsView data={state.data as CollectionsReport} money={money} /> : null}
      {!loading && state.kind === 'data' && tab === 'debts' ? <DebtsView data={state.data as DebtsReport} money={money} onExport={() => void exportCsv('customers')} /> : null}
      {!loading && state.kind === 'data' && tab === 'suppliers' ? <SuppliersView data={state.data as SuppliersReport} money={money} onExport={() => void exportCsv('suppliers')} /> : null}
      {!loading && state.kind === 'data' && tab === 'purchases' ? <PurchasesView data={state.data as PurchasesReport} money={money} onExport={() => void exportCsv('purchases')} /> : null}
      {!loading && state.kind === 'data' && tab === 'inventory' ? <InventoryView data={state.data as InventoryValuationReport} money={money} onExport={() => void exportCsv('products')} /> : null}
      {!loading && state.kind === 'data' && tab === 'production' ? <ProductionView data={state.data as ProductionReport} money={money} /> : null}
      {!loading && state.kind === 'data' && tab === 'expenses' ? <ExpensesView data={state.data as ExpensesReport} money={money} onExport={() => void exportCsv('expenses')} /> : null}
      {!loading && state.kind === 'data' && tab === 'cash' ? <CashView data={state.data as CashReport} money={money} /> : null}
      {!loading && state.kind === 'data' && tab === 'distribution' ? <DistributionView data={state.data as DistributionReport} money={money} /> : null}
      {!loading && state.kind === 'data' && tab === 'profit' ? <ProfitView data={state.data as ProfitReport} money={money} /> : null}
    </div>
  )
}

// =============================================================
// مشاهد التقارير
// =============================================================

function ExportBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="outline" className="h-9" onClick={onClick}>
      <Download className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  )
}

function DashboardView({ data, money }: { data: DashboardReport; money: (m: number) => string }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="مبيعات اليوم" value={money(data.today.salesTotalMinor)} hint={`${data.today.invoicesCount} فاتورة — آجل ${money(data.today.creditMinor)}`} tone="accent" />
        <StatCard title="تحصيلات اليوم" value={money(data.today.collectedMinor)} />
        <StatCard title="مصروفات اليوم" value={money(data.today.expensesMinor)} />
        <StatCard title="ديون العملاء" value={money(data.customerDebts.totalMinor)} hint={`${data.customerDebts.debtorsCount} عميل مدين`} tone="bad" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="مبيعات أمس" value={money(data.yesterday.salesTotalMinor)} hint={`${data.yesterday.invoicesCount} فاتورة`} />
        <StatCard title="تحصيلات أمس" value={money(data.yesterday.collectedMinor)} />
        <StatCard title="تنبيهات المخزون" value={String(data.stockAlerts.count)} hint="منتجات ≤ الحد الأدنى" tone={data.stockAlerts.count > 0 ? 'bad' : 'good'} />
        <StatCard title="عمليات مفتوحة" value={`${data.openOperations.openTripsCount} جولة`} hint={data.openOperations.openShift ? 'وردية مفتوحة حاليًا' : 'لا وردية مفتوحة'} />
      </div>

      <div>
        <h3 className="mb-2 font-bold">أحدث الفواتير</h3>
        {data.latestSales?.length ? (
          <TableShell>
            <table className="w-full text-sm">
              <thead className="bg-cream-200">
                <tr>
                  <th className="p-2.5 text-start font-semibold">الفاتورة</th>
                  <th className="p-2.5 text-start font-semibold">العميل</th>
                  <th className="p-2.5 text-start font-semibold">الإجمالي</th>
                  <th className="p-2.5 text-start font-semibold">الآجل</th>
                </tr>
              </thead>
              <tbody>
                {data.latestSales.map(s => (
                  <tr key={s.id} className="border-t">
                    <td className="p-2.5 font-mono text-xs" dir="ltr">{s.invoiceNo}</td>
                    <td className="p-2.5">{s.customerName}</td>
                    <td className="p-2.5 tabular-nums">{money(s.totalMinor)}</td>
                    <td className="p-2.5 tabular-nums">{money(s.creditMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState title="لا فواتير حديثة" />
        )}
      </div>
    </div>
  )
}

function SalesView({ data, money }: { data: SalesReport; money: (m: number) => string }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard title="عدد الفواتير" value={String(data.totals.invoicesCount)} />
        <StatCard title="المجموع" value={money(data.totals.subtotalMinor)} />
        <StatCard title="الخصم" value={money(data.totals.discountMinor)} />
        <StatCard title="الضريبة" value={money(data.totals.taxMinor)} />
        <StatCard title="الإجمالي" value={money(data.totals.totalMinor)} tone="accent" />
        <StatCard title="الآجل" value={money(data.totals.creditMinor)} tone={data.totals.creditMinor > 0 ? 'bad' : 'default'} />
      </div>

      <div>
        <h3 className="mb-2 font-bold">يوميًا</h3>
        {data.daily.length === 0 ? (
          <EmptyState title="لا مبيعات في الفترة" hint="عدّل الفلاتر أعلى الشاشة." />
        ) : (
          <TableShell>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-cream-200">
                <tr>
                  <th className="p-3 text-start font-semibold">اليوم</th>
                  <th className="p-3 text-start font-semibold">فواتير</th>
                  <th className="p-3 text-start font-semibold">المجموع</th>
                  <th className="p-3 text-start font-semibold">خصم</th>
                  <th className="p-3 text-start font-semibold">ضريبة</th>
                  <th className="p-3 text-start font-semibold">الإجمالي</th>
                  <th className="p-3 text-start font-semibold">آجل</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map(d => (
                  <tr key={d.date} className="border-t">
                    <td className="p-3">{d.date}</td>
                    <td className="p-3 tabular-nums">{d.invoicesCount}</td>
                    <td className="p-3 tabular-nums">{money(d.subtotalMinor)}</td>
                    <td className="p-3 tabular-nums">{money(d.discountMinor)}</td>
                    <td className="p-3 tabular-nums">{money(d.taxMinor)}</td>
                    <td className="p-3 font-semibold tabular-nums">{money(d.totalMinor)}</td>
                    <td className="p-3 tabular-nums">{money(d.creditMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-bold">حسب المنتج</h3>
          {data.byProduct.length === 0 ? <EmptyState title="لا بنود مبيعة" /> : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">المنتج</th>
                    <th className="p-3 text-start font-semibold">الكمية</th>
                    <th className="p-3 text-start font-semibold">المبيعات</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProduct.map(p => (
                    <tr key={p.productId} className="border-t">
                      <td className="p-3 font-semibold">{p.productName}</td>
                      <td className="p-3 tabular-nums">{fmtQty(p.qtyMilli)}</td>
                      <td className="p-3 font-semibold tabular-nums">{money(p.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
        <div>
          <h3 className="mb-2 font-bold">حسب العميل</h3>
          {data.byCustomer.length === 0 ? <EmptyState title="لا فواتير" /> : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">العميل</th>
                    <th className="p-3 text-start font-semibold">فواتير</th>
                    <th className="p-3 text-start font-semibold">الإجمالي</th>
                    <th className="p-3 text-start font-semibold">آجل</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCustomer.map(c => (
                    <tr key={c.customerId ?? 'cash'} className="border-t">
                      <td className="p-3 font-semibold">{c.customerName}</td>
                      <td className="p-3 tabular-nums">{c.invoicesCount}</td>
                      <td className="p-3 font-semibold tabular-nums">{money(c.totalMinor)}</td>
                      <td className="p-3 tabular-nums">{money(c.creditMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
      </div>
    </div>
  )
}

function CollectionsView({ data, money }: { data: CollectionsReport; money: (m: number) => string }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="إجمالي التحصيلات" value={money(data.totalMinor)} tone="accent" />
        <StatCard title="عدد الدفعات" value={String(data.paymentsCount)} />
        <StatCard title="طرق الدفع المستخدمة" value={String(data.byMethod.length)} />
      </div>

      <div>
        <h3 className="mb-2 font-bold">حسب طريقة الدفع</h3>
        {data.byMethod.length === 0 ? <EmptyState title="لا تحصيلات في الفترة" /> : (
          <div className="mb-4 flex flex-wrap gap-2">
            {data.byMethod.map(m => (
              <Badge key={m.method} variant="outline" className="gap-1.5 py-1.5">
                {PAYMENT_METHOD_LABELS[m.method] ?? m.method}
                <b className="tabular-nums">{money(m.amountMinor)}</b>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 font-bold">يوميًا</h3>
        {data.daily.length === 0 ? <EmptyState title="لا تحصيلات يومية" /> : (
          <TableShell>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-cream-200">
                <tr>
                  <th className="p-3 text-start font-semibold">اليوم</th>
                  <th className="p-3 text-start font-semibold">الإجمالي</th>
                  <th className="p-3 text-start font-semibold">تفصيل الطرق</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map(d => (
                  <tr key={d.date} className="border-t">
                    <td className="p-3">{d.date}</td>
                    <td className="p-3 font-semibold tabular-nums">{money(d.totalMinor)}</td>
                    <td className="p-3 text-xs">
                      {Object.entries(d.byMethod).map(([m, v]) => `${PAYMENT_METHOD_LABELS[m] ?? m}: ${money(v)}`).join(' • ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </div>
    </div>
  )
}

function DebtsView({ data, money, onExport }: { data: DebtsReport; money: (m: number) => string; onExport: () => void }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard title="إجمالي الديون" value={money(data.totalDebtMinor)} tone={data.totalDebtMinor > 0 ? 'bad' : 'good'} />
        <StatCard title="عدد المدينين" value={String(data.debtorsCount)} />
      </div>
      <div className="flex justify-end">
        <ExportBtn onClick={onExport} label="تصدير العملاء CSV" />
      </div>
      {data.items.length === 0 ? (
        <EmptyState title="لا ديون" hint="لا عملاء عليهم أرصدة حاليًا." />
      ) : (
        <TableShell>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-cream-200">
              <tr>
                <th className="p-3 text-start font-semibold">العميل</th>
                <th className="p-3 text-start font-semibold">الهاتف</th>
                <th className="p-3 text-start font-semibold">الدين</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(x => (
                <tr key={x.customerId} className="border-t">
                  <td className="p-3 font-semibold">{x.customerName}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{x.phone ?? '—'}</td>
                  <td className="p-3 font-bold tabular-nums text-destructive">{money(x.debtMinor)}</td>
                </tr>
              ))}
              <tr className="border-t-2 bg-cream-200">
                <td className="p-3 font-bold" colSpan={2}>الإجمالي</td>
                <td className="p-3 font-black tabular-nums">{money(data.totalDebtMinor)}</td>
              </tr>
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  )
}

function SuppliersView({ data, money, onExport }: { data: SuppliersReport; money: (m: number) => string; onExport: () => void }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard title="إجمالي المستحق للموردين" value={money(data.totalDueMinor)} tone={data.totalDueMinor > 0 ? 'bad' : 'good'} />
        <StatCard title="عدد الموردين بقيود" value={String(data.suppliersCount)} />
      </div>
      <div className="flex justify-end">
        <ExportBtn onClick={onExport} label="تصدير الموردين CSV" />
      </div>
      {data.items.length === 0 ? (
        <EmptyState title="لا قيود موردون" hint="لا أرصدة مسجلة للموردين." />
      ) : (
        <TableShell>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-cream-200">
              <tr>
                <th className="p-3 text-start font-semibold">المورد</th>
                <th className="p-3 text-start font-semibold">الهاتف</th>
                <th className="p-3 text-start font-semibold">المستحق (علينا)</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(x => (
                <tr key={x.supplierId} className="border-t">
                  <td className="p-3 font-semibold">{x.supplierName}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{x.phone ?? '—'}</td>
                  <td className={cn('p-3 font-bold tabular-nums', x.dueMinor > 0 ? 'text-destructive' : 'text-ok-600')}>
                    {money(x.dueMinor)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 bg-cream-200">
                <td className="p-3 font-bold" colSpan={2}>الإجمالي المستحق (الموجب فقط)</td>
                <td className="p-3 font-black tabular-nums">{money(data.totalDueMinor)}</td>
              </tr>
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  )
}

function PurchasesView({ data, money, onExport }: { data: PurchasesReport; money: (m: number) => string; onExport: () => void }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="عدد الفواتير" value={String(data.totals.invoicesCount)} />
        <StatCard title="المجموع" value={money(data.totals.subtotalMinor)} />
        <StatCard title="الخصم" value={money(data.totals.discountMinor)} />
        <StatCard title="الإجمالي" value={money(data.totals.totalMinor)} tone="accent" />
        <StatCard title="المدفوع" value={money(data.totals.paidMinor)} />
      </div>
      <div className="flex justify-end">
        <ExportBtn onClick={onExport} label="تصدير فواتير الشراء CSV" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-bold">يوميًا</h3>
          {data.daily.length === 0 ? <EmptyState title="لا مشتريات في الفترة" /> : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">اليوم</th>
                    <th className="p-3 text-start font-semibold">فواتير</th>
                    <th className="p-3 text-start font-semibold">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map(d => (
                    <tr key={d.date} className="border-t">
                      <td className="p-3">{d.date}</td>
                      <td className="p-3 tabular-nums">{d.invoicesCount}</td>
                      <td className="p-3 font-semibold tabular-nums">{money(d.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
        <div>
          <h3 className="mb-2 font-bold">حسب المورد</h3>
          {data.bySupplier.length === 0 ? <EmptyState title="لا مشتريات" /> : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">المورد</th>
                    <th className="p-3 text-start font-semibold">فواتير</th>
                    <th className="p-3 text-start font-semibold">الإجمالي</th>
                    <th className="p-3 text-start font-semibold">المدفوع</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySupplier.map(s => (
                    <tr key={s.supplierId} className="border-t">
                      <td className="p-3 font-semibold">{s.supplierName}</td>
                      <td className="p-3 tabular-nums">{s.invoicesCount}</td>
                      <td className="p-3 font-semibold tabular-nums">{money(s.totalMinor)}</td>
                      <td className="p-3 tabular-nums">{money(s.paidMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
      </div>
    </div>
  )
}

function InventoryView({ data, money, onExport }: { data: InventoryValuationReport; money: (m: number) => string; onExport: () => void }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard title="إجمالي قيمة المخزون" value={money(data.totalValueMinor)} tone="accent" />
        <StatCard title="عدد المنتجات" value={String(data.itemsCount)} />
      </div>
      <div className="flex justify-end">
        <ExportBtn onClick={onExport} label="تصدير المنتجات CSV" />
      </div>
      {data.items.length === 0 ? (
        <EmptyState title="لا منتجات" hint="أضف منتجات لاحتساب قيمة المخزون." />
      ) : (
        <TableShell>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-cream-200">
              <tr>
                <th className="p-3 text-start font-semibold">المنتج</th>
                <th className="p-3 text-start font-semibold">الرصيد</th>
                <th className="p-3 text-start font-semibold">التكلفة</th>
                <th className="p-3 text-start font-semibold">القيمة</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(p => (
                <tr key={p.productId} className="border-t">
                  <td className="p-3 font-semibold">
                    {p.name}
                    {!p.active ? <Badge variant="outline" className="ms-2 gap-1"><span aria-hidden>⏸</span> معطّل</Badge> : null}
                  </td>
                  <td className="p-3 tabular-nums">{p.trackStock ? `${fmtQty(p.balanceMilli)} ${p.baseUnit}` : '—'}</td>
                  <td className="p-3 tabular-nums text-muted-foreground">{money(p.costMinor)}</td>
                  <td className="p-3 font-semibold tabular-nums">{money(p.valueMinor)}</td>
                </tr>
              ))}
              <tr className="border-t-2 bg-cream-200">
                <td className="p-3 font-bold" colSpan={3}>إجمالي قيمة المخزون</td>
                <td className="p-3 font-black tabular-nums">{money(data.totalValueMinor)}</td>
              </tr>
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  )
}

function ProductionView({ data, money }: { data: ProductionReport; money: (m: number) => string }) {
  if (!data) return <EmptyState title="لا بيانات" />
  const t = data.totals
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="عدد الدفعات" value={String(t.batchesCount)} />
        <StatCard title="المخطط / الفعلي" value={`${fmtQty(t.plannedQtyMilli)} / ${fmtQty(t.actualQtyMilli)}`} />
        <StatCard title="الهدر" value={fmtQty(t.wasteQtyMilli)} tone={t.wasteQtyMilli > 0 ? 'bad' : 'good'} />
        <StatCard title="تكلفة المواد" value={money(t.materialsCostMinor)} />
        <StatCard title="متوسط الكفاءة" value={`${t.avgEfficiencyPercent}%`} tone={t.avgEfficiencyPercent >= 90 ? 'good' : 'accent'} />
      </div>
      {data.items.length === 0 ? (
        <EmptyState title="لا دفعات إنتاج في الفترة" hint="عدّل الفلاتر أو سجّل دفعة من شاشة الإنتاج." />
      ) : (
        <TableShell>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-cream-200">
              <tr>
                <th className="p-3 text-start font-semibold">الدفعة</th>
                <th className="p-3 text-start font-semibold">التاريخ</th>
                <th className="p-3 text-start font-semibold">الوصفة</th>
                <th className="p-3 text-start font-semibold">مخطط</th>
                <th className="p-3 text-start font-semibold">فعلي</th>
                <th className="p-3 text-start font-semibold">هدر</th>
                <th className="p-3 text-start font-semibold">تكلفة الوحدة</th>
                <th className="p-3 text-start font-semibold">كفاءة</th>
                <th className="p-3 text-start font-semibold">هدر %</th>
                <th className="p-3 text-start font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(b => (
                <tr key={b.id} className="border-t">
                  <td className="p-3 font-mono text-xs" dir="ltr">{b.batchNo}</td>
                  <td className="p-3 text-muted-foreground">{b.date.slice(0, 10)}</td>
                  <td className="p-3 font-semibold">{b.recipeName}<span className="block text-xs text-muted-foreground">{b.outputProductName}</span></td>
                  <td className="p-3 tabular-nums">{fmtQty(b.plannedQtyMilli)}</td>
                  <td className="p-3 tabular-nums">{fmtQty(b.actualQtyMilli)}</td>
                  <td className="p-3 tabular-nums">{fmtQty(b.wasteQtyMilli)}</td>
                  <td className="p-3 tabular-nums">{money(b.unitCostMinor)}</td>
                  <td className="p-3 font-bold tabular-nums">{b.efficiencyPercent}%</td>
                  <td className={cn('p-3 tabular-nums', b.wastePercent > 10 && 'text-destructive')}>{b.wastePercent}%</td>
                  <td className="p-3">
                    {b.status === 'COMPLETED' ? <Badge className="bg-ok-600 text-white">مكتملة</Badge> : <Badge variant="outline" className="border-destructive/50 text-destructive">ملغاة</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  )
}

function ExpensesView({ data, money, onExport }: { data: ExpensesReport; money: (m: number) => string; onExport: () => void }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard title="إجمالي مصروفات الفترة (المكتملة)" value={money(data.totalMinor)} tone="bad" />
        <StatCard title="عدد المصروفات" value={String(data.count)} />
      </div>
      <div className="flex justify-end">
        <ExportBtn onClick={onExport} label="تصدير المصروفات CSV" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-bold">حسب التصنيف</h3>
          {data.byCategory.length === 0 ? <EmptyState title="لا مصروفات في الفترة" /> : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">التصنيف</th>
                    <th className="p-3 text-start font-semibold">عدد</th>
                    <th className="p-3 text-start font-semibold">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCategory.map(c => (
                    <tr key={c.categoryId} className="border-t">
                      <td className="p-3 font-semibold">{c.categoryName}</td>
                      <td className="p-3 tabular-nums">{c.count}</td>
                      <td className="p-3 font-bold tabular-nums">{money(c.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
        <div>
          <h3 className="mb-2 font-bold">يوميًا</h3>
          {data.daily.length === 0 ? <EmptyState title="لا مصروفات يومية" /> : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">اليوم</th>
                    <th className="p-3 text-start font-semibold">عدد</th>
                    <th className="p-3 text-start font-semibold">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map(d => (
                    <tr key={d.date} className="border-t">
                      <td className="p-3">{d.date}</td>
                      <td className="p-3 tabular-nums">{d.count}</td>
                      <td className="p-3 font-semibold tabular-nums">{money(d.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
      </div>
    </div>
  )
}

function CashView({ data, money }: { data: CashReport; money: (m: number) => string }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="الصافي" value={signedMoney(data.netMinor, money)} tone={data.netMinor >= 0 ? 'good' : 'bad'} />
        <StatCard title="الداخل" value={money(data.inflowMinor)} tone="good" />
        <StatCard title="الخارج" value={money(Math.abs(data.outflowMinor))} tone="bad" />
        <StatCard title="عدد الحركات" value={String(data.movementsCount)} />
      </div>
      {data.byType.length === 0 ? (
        <EmptyState title="لا حركات صندوق في الفترة" hint="حركات الصندوق تُسجل على الورديات المفتوحة." />
      ) : (
        <TableShell>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-cream-200">
              <tr>
                <th className="p-3 text-start font-semibold">نوع الحركة</th>
                <th className="p-3 text-start font-semibold">عدد</th>
                <th className="p-3 text-start font-semibold">الصافي</th>
              </tr>
            </thead>
            <tbody>
              {data.byType.map(t => (
                <tr key={t.type} className="border-t">
                  <td className="p-3 font-semibold">{CASH_TYPE_LABELS[t.type] ?? t.type}</td>
                  <td className="p-3 tabular-nums">{t.count}</td>
                  <td className={cn('p-3 font-bold tabular-nums', t.totalMinor > 0 ? 'text-ok-600' : t.totalMinor < 0 ? 'text-destructive' : '')}>
                    {signedMoney(t.totalMinor, money)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  )
}

function DistributionView({ data, money }: { data: DistributionReport; money: (m: number) => string }) {
  if (!data) return <EmptyState title="لا بيانات" />
  const t = data.totals
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="الجولات" value={`${t.tripsCount}`} hint={`${t.settledCount} مُسواة — ${t.openCount} مفتوحة`} />
        <StatCard title="محمّل / مبيع" value={`${fmtQty(t.loadedMilli)} / ${fmtQty(t.soldMilli)}`} />
        <StatCard title="نقد محصّل" value={money(t.cashMinor)} tone="good" />
        <StatCard title="آجل للعملاء" value={money(t.creditMinor)} tone="accent" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-bold">حسب المندوب</h3>
          {data.byRep.length === 0 ? <EmptyState title="لا جولات في الفترة" /> : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">المندوب</th>
                    <th className="p-3 text-start font-semibold">جولات</th>
                    <th className="p-3 text-start font-semibold">محمّل</th>
                    <th className="p-3 text-start font-semibold">مبيع</th>
                    <th className="p-3 text-start font-semibold">نقد</th>
                    <th className="p-3 text-start font-semibold">آجل</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byRep.map(r => (
                    <tr key={r.repId} className="border-t">
                      <td className="p-3 font-semibold">{r.repName}</td>
                      <td className="p-3 tabular-nums">{r.tripsCount}</td>
                      <td className="p-3 tabular-nums">{fmtQty(r.loadedMilli)}</td>
                      <td className="p-3 tabular-nums">{fmtQty(r.soldMilli)}</td>
                      <td className="p-3 font-semibold tabular-nums">{money(r.cashMinor)}</td>
                      <td className="p-3 tabular-nums">{money(r.creditMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
        <div>
          <h3 className="mb-2 font-bold">جولات الفترة</h3>
          {data.trips.length === 0 ? <EmptyState title="لا جولات" /> : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">الجولة</th>
                    <th className="p-3 text-start font-semibold">التاريخ</th>
                    <th className="p-3 text-start font-semibold">المندوب</th>
                    <th className="p-3 text-start font-semibold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trips.map(tr => (
                    <tr key={tr.id} className="border-t">
                      <td className="p-3 font-mono text-xs" dir="ltr">{tr.tripNo}</td>
                      <td className="p-3 text-muted-foreground">{tr.date.slice(0, 10)}</td>
                      <td className="p-3">{tr.repName}</td>
                      <td className="p-3">
                        {tr.status === 'OPEN' ? <Badge className="bg-copper-500 text-white">مفتوحة</Badge> : <Badge className="bg-ok-600 text-white">مُسواة</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
      </div>
    </div>
  )
}

function ProfitView({ data, money }: { data: ProfitReport; money: (m: number) => string }) {
  if (!data) return <EmptyState title="لا بيانات" />
  return (
    <div className="space-y-4">
      <Alert className="border-copper-500/50 bg-copper-100/40">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <AlertTitle>رقم تقديري — ليس صافي ربح محاسبي</AlertTitle>
        <AlertDescription className="leading-relaxed">
          {data.definition}
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="إجمالي المبيعات" value={money(data.sales.totalMinor)} hint={`${data.sales.invoicesCount} فاتورة مكتملة`} />
        <StatCard title="تكلفة البضاعة المباعة (COGS)" value={money(data.cogsMinor)} />
        <StatCard title="الربح الإجمالي" value={money(data.grossProfitMinor)} hint={`هامش ${data.marginPercent}%`} tone={data.grossProfitMinor >= 0 ? 'good' : 'bad'} />
        <StatCard title="المصروفات النقدية" value={money(data.cashExpensesMinor)} hint={`${data.cashExpensesCount} مصروف نقدي`} />
        <StatCard title="الفائض التقديري" value={money(data.estimatedSurplusMinor)} tone={data.estimatedSurplusMinor >= 0 ? 'good' : 'bad'} />
        <StatCard title="خصومات الفواتير" value={money(data.sales.discountMinor)} />
      </div>

      <div className="rounded-xl border bg-card p-4 text-sm leading-relaxed">
        <h3 className="mb-2 font-bold">كيف حُسب؟</h3>
        <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
          <li>إجمالي المبيعات = مجموع إجماليات الفواتير المكتملة في الفترة.</li>
          <li>COGS = مجموع (الكمية × تكلفة الوحدة المسجلة لحظة البيع ÷ 1000) لبنود الفواتير المكتملة.</li>
          <li>الربح الإجمالي = المبيعات − COGS.</li>
          <li>الفائض التقديري = الربح الإجمالي − المصروفات النقدية المدفوعة.</li>
        </ol>
      </div>
    </div>
  )
}

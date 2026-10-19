'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/bakery/client'
import type { DashboardData } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import { dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, StatCard, TableShell, money as fmtMoney, qty as fmtQty } from '@/components/bakery/kit'
import { AlertTriangle, Banknote, ChefHat, Clock, Landmark, Route, TrendingUp, Wallet } from 'lucide-react'
import { StatusBadge } from '@/components/bakery/kit'

/** لوحة التحكم — كل الأرقام من الحركات الفعلية (لا بيانات وهمية) */
export function Dashboard() {
  const { user, money, settings } = useSession()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.get<DashboardData>('/api/reports/dashboard'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل اللوحة')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <LoadingRows rows={6} />
  if (error) return <ErrorBanner message={error} onRetry={load} />
  if (!data) return null

  const hasAnyData = data.today.salesTotalMinor > 0 || data.yesterday.salesTotalMinor > 0 || data.today.invoicesCount > 0 || data.latestSales.length > 0

  return (
    <div>
      <PageHeader
        title={`أهلًا، ${user.displayName}`}
        subtitle={`ملخص اليوم — ${settings.businessName}`}
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="مبيعات اليوم"
          value={money(data.today.salesTotalMinor)}
          hint={data.today.invoicesCount > 0 ? `${data.today.invoicesCount} فاتورة` : 'لا فواتير اليوم'}
          tone="accent"
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
        />
        <StatCard
          title="تحصيلات اليوم (نقدي)"
          value={money(data.today.collectedMinor)}
          hint="كل المدفوعات النقدية والتحصيلات"
          tone="good"
          icon={<Banknote className="h-5 w-5" aria-hidden />}
        />
        <StatCard
          title="مبيعات آجلة اليوم"
          value={money(data.today.creditMinor)}
          hint="المبلغ غير المحصل على العملاء"
          tone={data.today.creditMinor > 0 ? 'bad' : 'default'}
          icon={<Wallet className="h-5 w-5" aria-hidden />}
        />
        <StatCard
          title="مصروفات اليوم"
          value={money(data.today.expensesMinor)}
          icon={<Wallet className="h-5 w-5" aria-hidden />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* تنبيهات المخزون */}
        <section className="rounded-xl border bg-card p-4 lg:col-span-1" aria-label="تنبيهات المخزون">
          <h2 className="mb-3 flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4.5 w-4.5 text-copper-600" aria-hidden />
            تنبيهات المخزون
            {data.stockAlerts.count > 0 ? (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">{data.stockAlerts.count}</span>
            ) : null}
          </h2>
          {data.stockAlerts.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد منتجات تحت الحد الأدنى ✓</p>
          ) : (
            <ul className="space-y-2">
              {data.stockAlerts.items.map(a => (
                <li key={a.productId} className="flex items-center justify-between gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm">
                  <span className="truncate font-medium">{a.name}</span>
                  <span className="shrink-0 tabular-nums text-destructive">
                    {fmtQty(a.balanceMilli)} {a.baseUnit} <span className="text-xs">(الحد {fmtQty(a.minStockMilli)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* إحصاءات إضافية */}
        <section className="grid gap-4 sm:grid-cols-2 lg:col-span-2" aria-label="مؤشرات عامة">
          <StatCard
            title="إجمالي ديون العملاء"
            value={money(data.customerDebts.totalMinor)}
            hint={data.customerDebts.debtorsCount > 0 ? `${data.customerDebts.debtorsCount} عميل مدين` : 'لا مديونيات'}
            tone={data.customerDebts.totalMinor > 0 ? 'bad' : 'default'}
          />
          <StatCard
            title="وردية الصندوق"
            value={data.openOperations.openShift ? 'مفتوحة الآن' : 'مغلقة'}
            hint={data.openOperations.openShift ? `فُتحت ${dateTime(data.openOperations.openShift.openedAt)}` : 'افتح وردية من الخزينة'}
            tone={data.openOperations.openShift ? 'good' : 'default'}
            icon={<Landmark className="h-5 w-5" aria-hidden />}
          />
          <StatCard
            title="جولات توزيع مفتوحة"
            value={String(data.openOperations.openTripsCount)}
            hint="جولات لم تُسوَّ بعد"
            icon={<Route className="h-5 w-5" aria-hidden />}
          />
          <StatCard
            title="مبيعات أمس"
            value={money(data.yesterday.salesTotalMinor)}
            hint={data.yesterday.invoicesCount > 0 ? `${data.yesterday.invoicesCount} فاتورة` : '—'}
          />
        </section>
      </div>

      {/* أحدث الفواتير */}
      <section className="mt-4" aria-label="أحدث الفواتير">
        <h2 className="mb-3 font-bold">أحدث الفواتير</h2>
        {data.latestSales.length === 0 ? (
          <EmptyState
            title={hasAnyData ? 'لا فواتير حديثة' : 'لم تبدأ بعد'}
            hint={hasAnyData ? undefined : 'ابدأ من نقطة البيع لتسجيل أول فاتورة، أو حمّل بيانات تجريبية من الإعدادات لاستكشاف النظام.'}
          />
        ) : (
          <TableShell>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-cream-200 text-start">
                <tr className="text-start">
                  <th className="p-3 text-start font-semibold">الفاتورة</th>
                  <th className="p-3 text-start font-semibold">العميل</th>
                  <th className="p-3 text-start font-semibold">الوقت</th>
                  <th className="p-3 text-start font-semibold">الإجمالي</th>
                  <th className="p-3 text-start font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.latestSales.map(s => (
                  <tr key={s.id} className="border-t transition-colors hover:bg-cream-100">
                    <td className="p-3 font-mono text-xs" dir="ltr">{s.invoiceNo}</td>
                    <td className="p-3">{s.customerName}</td>
                    <td className="p-3 text-muted-foreground">{dateTime(s.date)}</td>
                    <td className="p-3 tabular-nums font-semibold">{fmtMoney(s.totalMinor, settings.currencySymbol)}</td>
                    <td className="p-3"><StatusBadge status={s.status} paymentStatus={s.paymentStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </section>
    </div>
  )
}

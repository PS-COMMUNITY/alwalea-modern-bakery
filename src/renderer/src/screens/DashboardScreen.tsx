// =============================================================
// مخبز الولاء الحديث — لوحة التحكم (rc.9 — المرحلة 2)
// بطاقات حية + رسم شهري باختيار الشهر + مقارنات أسبوع/شهر/سنة
// + أعلى المنتجات + أكبر 3 مدينين بزر تحصيل + تنبيهات + ورقة نهاية اليوم.
// كل الأرقام من الحركات الفعلية فقط — لا أرقام كاذبة: «لا بيانات كافية».
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DashboardExtra, DashboardReport, SessionUser } from '../../../shared/types'
import { call, money, fmtDateTime, ageText, BACKUP_STALE_MS } from '../api'
import { EmptyState, statusBadge, Banner } from '../components/ui'
import EodModal from '../components/EodModal'

interface BackupListRow {
  id: number
  created_at: string
  path: string
  size_bytes: number
}

const TOP_TABS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'week', label: 'آخر 7 أيام' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'year', label: 'هذه السنة' }
]

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function daysInMonth(ym: string): string[] {
  const parts = ym.split('-')
  const y = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 1)
  const n = new Date(y, m, 0).getDate()
  const pad = (x: number): string => String(x).padStart(2, '0')
  return Array.from({ length: n }, (_, i) => `${ym}-${pad(i + 1)}`)
}

export default function DashboardScreen(_props: { user: SessionUser }): ReactNode {
  const [rep, setRep] = useState<DashboardReport | null>(null)
  const [extra, setExtra] = useState<DashboardExtra | null>(null)
  const [error, setError] = useState('')
  const [month, setMonth] = useState<string>(currentMonth)
  const [topKey, setTopKey] = useState<string>('week')
  const [eodOpen, setEodOpen] = useState(false)
  const [collectBusy, setCollectBusy] = useState<number | null>(null)
  // rc.8 (P0-2): مؤشر عمر آخر نسخة احتياطية — يحمرّ بعد 3 أيام أو إن لم توجد نسخة
  const [backupAge, setBackupAge] = useState<{ text: string; stale: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = await call<BackupListRow[]>('backup.list', {})
        if (!alive) return
        const newest = list[0]
        if (!newest) {
          setBackupAge({ text: 'لا نسخة احتياطية بعد', stale: true })
          return
        }
        const stale = Date.now() - new Date(newest.created_at).getTime() > BACKUP_STALE_MS
        setBackupAge({ text: ageText(newest.created_at), stale })
      } catch {
        // بلا صلاحية backup.manage — يُخفى المؤشر بصمت
        if (alive) setBackupAge(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const d = await call<DashboardReport>('reports.dashboard')
        if (alive) setRep(d)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const loadExtra = useCallback(async (): Promise<void> => {
    try {
      const x = await call<DashboardExtra>('reports.dashboardExtra', { month, topKey })
      setExtra(x)
      setError('')
    } catch (e) {
      // صلاحية reports.financial غير متاحة — اللوحة الأساسية تكفي
      setExtra(null)
      if (e instanceof Error && !e.message.includes('صلاحية')) setError(e.message)
    }
  }, [month, topKey])

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!alive) return
      await loadExtra()
    })()
    return () => {
      alive = false
    }
  }, [loadExtra])

  const collect = useCallback(
    async (customerId: number, name: string, balanceMinor: number): Promise<void> => {
      if (collectBusy !== null) return
      const cur = extra?.currencySymbol ?? '₪'
      if (!window.confirm(`تحصيل كامل المبلغ ${money(balanceMinor, cur)} من العميل «${name}» نقدًا الآن؟`)) return
      setCollectBusy(customerId)
      try {
        await call('customers.payment', { customerId, amountMinor: balanceMinor, note: 'تحصيل من لوحة التحكم' })
        await loadExtra()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setCollectBusy(null)
      }
    },
    [collectBusy, extra, loadExtra]
  )

  const chart = useMemo(() => {
    if (!extra) return []
    const byDate = new Map(extra.monthSeries.map((p) => [p.date, p.total_minor]))
    return daysInMonth(month).map((d) => ({ date: d, minor: byDate.get(d) ?? 0 }))
  }, [extra, month])

  const chartMax = Math.max(1, ...chart.map((c) => c.minor))

  if (error && !rep) return <div className="banner error">{error}</div>
  if (!rep) return <EmptyState icon="⏳" text="جارٍ تحميل لوحة التحكم…" />

  const cur = extra?.currencySymbol ?? rep.currencySymbol
  const hasData = rep.todaySalesCount > 0 || rep.cashBalanceMinor !== 0 || rep.receivablesMinor !== 0 || rep.recentSales.length > 0
  const alerts = extra?.alerts
  const showAlerts = alerts && (alerts.lateOver30Count > 0 || alerts.openShiftDays >= 2)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ marginRight: 'auto', marginBottom: 0 }}>لوحة التحكم</h1>
        <button className="btn ghost" onClick={() => setEodOpen(true)}>
          📄 ورقة نهاية اليوم
        </button>
      </div>

      {error ? <Banner kind="error" text={error} /> : null}

      {backupAge ? (
        <div
          style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: backupAge.stale ? 'var(--err)' : 'var(--ok)' }}
          role="status"
        >
          {backupAge.stale ? '⚠ ' : '✓ '}
          آخر نسخة احتياطية: {backupAge.text}
          {backupAge.stale ? ' — نسخة تلقائية تُنشأ عند كل إغلاق للتطبيق، أو أنشئ نسخة الآن من «الإعدادات».' : ' — نسخة تلقائية عند كل إغلاق للتطبيق.'}
        </div>
      ) : null}

      {showAlerts && alerts ? (
        <Banner
          kind="error"
          text={
            [
              alerts.lateOver30Count > 0
                ? `⏰ ${alerts.lateOver30Count} عميل متأخرون أكثر من 30 يومًا — إجمالي ${money(alerts.lateOver30Minor, cur)} (يظهرون في «أكبر المدينين» أدناه)`
                : null,
              alerts.openShiftDays >= 2
                ? `🕒 الوردية مفتوحة منذ ${alerts.openShiftDays} يوم (${alerts.openShiftHours ?? 0} ساعة) — أقفلها من «الورديات والصندوق»`
                : null
            ]
              .filter(Boolean)
              .join(' • ')
          }
        />
      ) : null}

      {!hasData ? (
        <div className="empty" style={{ marginBottom: 16 }}>
          <span className="ico" aria-hidden>
            🌱
          </span>
          لا توجد بيانات بعد — ابدأ بإضافة المنتجات ثم أول فاتورة بيع من «نقطة البيع».
        </div>
      ) : null}

      <div className="grid-cards">
        <div className="stat">
          <div className="label">مبيعات اليوم</div>
          <div className="value">{money(rep.todaySalesMinor, cur)}</div>
          <div className="label">{rep.todaySalesCount} فاتورة</div>
        </div>
        <div className="stat">
          <div className="label">رصيد الصندوق</div>
          <div className={`value ${rep.cashBalanceMinor >= 0 ? 'ok' : 'err'}`}>{money(rep.cashBalanceMinor, cur)}</div>
          <div className="label">من كل الحركات</div>
        </div>
        <div className="stat">
          <div className="label">ذمم العملاء (آجل)</div>
          <div className="value warn">{money(rep.receivablesMinor, cur)}</div>
        </div>
        <div className="stat">
          <div className="label">مستحقات الموردين</div>
          <div className="value warn">{money(rep.payablesMinor, cur)}</div>
        </div>
        <div className="stat">
          <div className="label">منتجات تحت الحد الأدنى</div>
          <div className={`value ${rep.lowStockCount > 0 ? 'err' : 'ok'}`}>{rep.lowStockCount}</div>
        </div>
        <div className="stat">
          <div className="label">الوردية الحالية</div>
          <div className="value" style={{ fontSize: 16, paddingTop: 3 }}>
            {rep.openShift ? <span className="badge ok">مفتوحة</span> : <span className="badge muted">مغلقة</span>}
          </div>
          {rep.openShift ? <div className="label">من {fmtDateTime(rep.openShift.opened_at)}</div> : null}
        </div>
      </div>

      {/* ===== الرسم الشهري + المقارنات ===== */}
      {extra ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginTop: 18 }}>
          <div className="stat">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <div className="label" style={{ marginRight: 'auto', fontWeight: 800, color: 'var(--brown-900)', fontSize: 14 }}>
                مبيعات الشهر
              </div>
              <input
                type="month"
                value={month}
                max={currentMonth()}
                onChange={(e) => setMonth(e.target.value)}
                style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', fontFamily: 'inherit' }}
                aria-label="اختيار الشهر"
              />
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--brown-900)', marginBottom: 8 }}>
              {money(extra.monthTotalMinor, cur)}
            </div>
            {chart.every((c) => c.minor === 0) ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '18px 0' }}>
                لا مبيعات في {month} — جرّب شهرًا آخر من المحدد أعلاه.
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 130 }} dir="ltr">
                {chart.map((c) => (
                  <div
                    key={c.date}
                    title={`${c.date} — ${money(c.minor, cur)}`}
                    style={{
                      flex: 1,
                      height: `${Math.max(2, (c.minor / chartMax) * 100)}%`,
                      background: c.minor > 0 ? 'linear-gradient(180deg, #8a5a30, #6b4226)' : 'var(--line)',
                      borderRadius: 2,
                      minHeight: 3
                    }}
                  />
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 4 }} dir="ltr">
              <span>01</span>
              <span>15</span>
              <span>{String(chart.length).padStart(2, '0')}</span>
            </div>
          </div>

          <div className="stat">
            <div className="label" style={{ fontWeight: 800, color: 'var(--brown-900)', fontSize: 14, marginBottom: 10 }}>
              المقارنات
            </div>
            {extra.compares.map((c) => (
              <div key={c.label} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px dashed var(--line)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 3 }}>{c.label}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 800, fontSize: 16 }}>{money(c.currentMinor, cur)}</span>
                  {c.previousMinor === null ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>لا بيانات كافية للمقارنة بعد</span>
                  ) : (
                    <span style={{ fontSize: 13 }}>
                      السابق: {money(c.previousMinor, cur)}{' '}
                      <span style={{ fontWeight: 800, color: (c.deltaMinor ?? 0) >= 0 ? 'var(--ok)' : 'var(--err)' }}>
                        {(c.deltaMinor ?? 0) >= 0 ? '▲' : '▼'} {Math.abs(c.deltaPct ?? 0)}%
                      </span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ===== أعلى المنتجات + أكبر المدينين ===== */}
      {extra ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginTop: 14 }}>
          <div className="stat">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <div className="label" style={{ marginRight: 'auto', fontWeight: 800, color: 'var(--brown-900)', fontSize: 14 }}>
                أعلى المنتجات مبيعًا
              </div>
              {TOP_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`btn ghost small${topKey === t.key ? ' primary' : ''}`}
                  style={topKey === t.key ? { background: 'var(--brown-900)', color: '#fff' } : undefined}
                  onClick={() => setTopKey(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {extra.topProducts.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '10px 0' }}>
                لا مبيعات في {extra.topPeriod.label} — أول فاتورة ستظهر هنا.
              </div>
            ) : (
              extra.topProducts.map((p, i) => {
                const max = extra.topProducts[0]?.revenue_minor ?? 1
                return (
                  <div key={p.product_id} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>
                        {i + 1}. {p.product_name}
                      </span>
                      <span style={{ fontWeight: 700 }}>{money(p.revenue_minor, cur)}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, marginTop: 3 }}>
                      <div
                        style={{
                          width: `${Math.max(4, (p.revenue_minor / max) * 100)}%`,
                          height: '100%',
                          background: 'var(--brown-900)',
                          borderRadius: 3
                        }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="stat">
            <div className="label" style={{ fontWeight: 800, color: 'var(--brown-900)', fontSize: 14, marginBottom: 10 }}>
              أكبر 3 مدينين
            </div>
            {extra.debtors.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '10px 0' }}>لا ديون قائمة — كل الحسابات مسددة ✅</div>
            ) : (
              extra.debtors.map((d) => (
                <div
                  key={d.customer_id}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed var(--line)' }}
                >
                  <div style={{ marginRight: 'auto' }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{d.customer_name}</div>
                    <div style={{ fontSize: 11.5, color: d.days_late > 30 ? 'var(--err)' : 'var(--muted)' }}>
                      {d.oldest_unpaid_date ? `أقدم فاتورة آجلة: ${d.oldest_unpaid_date} (${d.days_late} يوم)` : 'بدون فواتير آجلة ظاهرة'}
                    </div>
                  </div>
                  <span style={{ fontWeight: 800, color: 'var(--err)' }}>{money(d.balance_minor, cur)}</span>
                  <button
                    className="btn primary small"
                    disabled={collectBusy !== null}
                    onClick={() => void collect(d.customer_id, d.customer_name, d.balance_minor)}
                  >
                    {collectBusy === d.customer_id ? 'جارٍ…' : '💵 تحصيل'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <h2 style={{ marginTop: 22 }}>آخر الفواتير</h2>
      {rep.recentSales.length === 0 ? (
        <EmptyState icon="🧾" text="لا فواتير بعد — أول عملية بيع ستظهر هنا مباشرة." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>الفاتورة</th>
              <th>التاريخ</th>
              <th>العميل</th>
              <th className="num">الإجمالي</th>
              <th className="num">المدفوع</th>
              <th className="num">الآجل</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rep.recentSales.map((s) => (
              <tr key={s.id}>
                <td dir="ltr">{s.invoice_no}</td>
                <td>{s.date}</td>
                <td>{s.customer_name ?? '—'}</td>
                <td className="num">{money(s.total_minor, cur)}</td>
                <td className="num">{money(s.paid_minor, cur)}</td>
                <td className="num">{money(s.credit_minor, cur)}</td>
                <td>{statusBadge(s.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {eodOpen ? <EodModal date={new Date().toISOString().slice(0, 10)} onClose={() => setEodOpen(false)} /> : null}
    </div>
  )
}

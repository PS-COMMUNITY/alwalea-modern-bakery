// =============================================================
// مخبز الولاء الحديث — لوحة التحكم (أرقام حقيقية من القاعدة)
// =============================================================
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DashboardReport, SessionUser } from '../../../shared/types'
import { call, money, fmtDateTime, ageText, BACKUP_STALE_MS } from '../api'
import { EmptyState, statusBadge } from '../components/ui'

interface BackupListRow {
  id: number
  created_at: string
  path: string
  size_bytes: number
}

export default function DashboardScreen(_props: { user: SessionUser }): ReactNode {
  const [rep, setRep] = useState<DashboardReport | null>(null)
  const [error, setError] = useState('')
  // rc.8 (P0-2): مؤشر عمر آخر نسخة احتياطية — يحمرّ بعد 3 أيام أو إن لم توجد نسخة
  const [backupAge, setBackupAge] = useState<{ text: string; stale: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = await call<BackupListRow[]>('backup.list', {})
        if (!alive) return
        if (list.length === 0) {
          setBackupAge({ text: 'لا نسخة احتياطية بعد', stale: true })
          return
        }
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

  if (error) return <div className="banner error">{error}</div>
  if (!rep) return <EmptyState icon="⏳" text="جارٍ تحميل لوحة التحكم…" />

  const cur = rep.currencySymbol
  const hasData = rep.todaySalesCount > 0 || rep.cashBalanceMinor !== 0 || rep.receivablesMinor !== 0 || rep.recentSales.length > 0

  return (
    <div>
      <h1>لوحة التحكم</h1>
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
      {!hasData ? (
        <div className="empty" style={{ marginBottom: 16 }}>
          <span className="ico" aria-hidden>🌱</span>
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
          <div className="value">{rep.openShift ? '🟢 مفتوحة' : '⚪ مغلقة'}</div>
          {rep.openShift ? <div className="label">من {fmtDateTime(rep.openShift.opened_at)}</div> : null}
        </div>
      </div>

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
    </div>
  )
}

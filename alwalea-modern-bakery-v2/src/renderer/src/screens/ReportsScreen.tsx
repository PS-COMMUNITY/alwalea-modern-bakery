// =============================================================
// مخبز الولاء الحديث — شاشة التقارير: تقرير المبيعات اليومي
// من قناة reports.sales (يتطلب صلاحية reports.financial)
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { call, money } from '../api'
import { downloadCsv, csvMoney } from '../csvExport'
import { EmptyState, Banner } from '../components/ui'

interface SalesDailyRow {
  date: string
  invoices: number
  total_minor: number
  paid_minor: number
  credit_minor: number
}

/** أول يوم من الشهر الحالي بصيغة YYYY-MM-DD */
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** تاريخ اليوم بصيغة YYYY-MM-DD */
function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function ReportsScreen(): ReactNode {
  const [from, setFrom] = useState<string>(monthStart)
  const [to, setTo] = useState<string>(today)
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: monthStart(), to: today() })
  const [rows, setRows] = useState<SalesDailyRow[] | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await call<SalesDailyRow[]>('reports.sales', { from: applied.from, to: applied.to })
        if (alive) {
          setRows(r)
          setError('')
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [applied, retry])

  const refresh = useCallback((): void => {
    setApplied({ from, to })
    setRetry((n) => n + 1)
  }, [from, to])

  const totals = (rows ?? []).reduce(
    (acc, r) => ({
      invoices: acc.invoices + Number(r.invoices),
      total: acc.total + Number(r.total_minor),
      paid: acc.paid + Number(r.paid_minor),
      credit: acc.credit + Number(r.credit_minor)
    }),
    { invoices: 0, total: 0, paid: 0, credit: 0 }
  )

  return (
    <div>
      <h1>التقارير</h1>
      <h2 style={{ marginTop: 2 }}>المبيعات اليومية</h2>

      {error ? <Banner kind="error" text={error} /> : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rep-from">من</label>
          <input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rep-to">إلى</label>
          <input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn primary" onClick={refresh}>
          عرض التقرير
        </button>
        <button
          className="btn ghost"
          disabled={rows === null || rows.length === 0}
          onClick={() => {
            if (!rows) return
            // rc.8 (P0-1): تصدير CSV بـ BOM — أعمدة عربية سليمة في Excel (وعد UAT 2.12)
            downloadCsv(`تقرير-المبيعات_${applied.from}_${applied.to}`, [
              ['التاريخ', 'عدد الفواتير', 'الإجمالي', 'المدفوع', 'الآجل'],
              ...rows.map((r) => [r.date, Number(r.invoices), csvMoney(r.total_minor), csvMoney(r.paid_minor), csvMoney(r.credit_minor)]),
              ['الإجمالي', totals.invoices, csvMoney(totals.total), csvMoney(totals.paid), csvMoney(totals.credit)]
            ])
          }}
        >
          ⬇ تصدير CSV
        </button>
      </div>

      {rows === null && !error ? (
        <EmptyState icon="⏳" text="جارٍ تحضير التقرير…" />
      ) : rows !== null && rows.length === 0 ? (
        <EmptyState icon="🧾" text="لا مبيعات في هذه الفترة — جرّب توسيع المدى أو أنشئ فاتورة من نقطة البيع." />
      ) : rows !== null ? (
        <table className="data">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th className="num">عدد الفواتير</th>
              <th className="num">الإجمالي</th>
              <th className="num">المدفوع</th>
              <th className="num">الآجل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td className="num">{Number(r.invoices)}</td>
                <td className="num">{money(Number(r.total_minor))}</td>
                <td className="num">{money(Number(r.paid_minor))}</td>
                <td className="num" style={{ color: Number(r.credit_minor) > 0 ? 'var(--err)' : undefined }}>
                  {money(Number(r.credit_minor))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 700, color: 'var(--brown-900)' }}>الإجمالي</td>
              <td className="num" style={{ fontWeight: 800 }}>{totals.invoices}</td>
              <td className="num" style={{ fontWeight: 800 }}>{money(totals.total)}</td>
              <td className="num" style={{ fontWeight: 800 }}>{money(totals.paid)}</td>
              <td className="num" style={{ fontWeight: 800, color: totals.credit > 0 ? 'var(--err)' : undefined }}>
                {money(totals.credit)}
              </td>
            </tr>
          </tfoot>
        </table>
      ) : null}
    </div>
  )
}

// =============================================================
// مخبز الولاء الحديث — شاشة التقارير (rc.9 — المرحلة 3)
// أربعة تقارير: المبيعات اليومية • الذمم • التحصيلات • المصروفات
// كل تقرير: عرض + تصدير CSV + تصدير Excel احترافي + طباعة PDF رسمي A4.
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { call, money } from '../api'
import { downloadCsv, csvMoney } from '../csvExport'
import { downloadXlsx, xlsxMoney } from '../xlsxExport'
import { A4Doc, DocModal, docMoney, type DocSection } from '../printDoc'
import { EmptyState, Banner } from '../components/ui'
import type { AppSettings } from '../../../shared/types'

type TabKey = 'sales' | 'debts' | 'collections' | 'expenses'

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: string }> = [
  { key: 'sales', label: 'المبيعات اليومية', icon: '🧾' },
  { key: 'debts', label: 'ذمم العملاء', icon: '📒' },
  { key: 'collections', label: 'التحصيلات', icon: '💵' },
  { key: 'expenses', label: 'المصروفات', icon: '🧮' }
]

interface SalesDailyRow {
  date: string
  invoices: number
  total_minor: number
  paid_minor: number
  credit_minor: number
}
interface DebtRow {
  id: number
  name: string
  phone: string | null
  balance_minor: number
}
interface CollectionRow {
  date: string
  customer_name: string
  amount_minor: number
  ref_type: string
  note: string | null
}
interface ExpensesReport {
  totalMinor: number
  byCategory: Array<{ category_name: string; total_minor: number; count: number }>
  byDate: Array<{ date: string; total_minor: number }>
}

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function ReportsScreen(): ReactNode {
  const [tab, setTab] = useState<TabKey>('sales')
  const [from, setFrom] = useState<string>(monthStart)
  const [to, setTo] = useState<string>(today)
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: monthStart(), to: today() })
  const [salesRows, setSalesRows] = useState<SalesDailyRow[] | null>(null)
  const [debtRows, setDebtRows] = useState<DebtRow[] | null>(null)
  const [collRows, setCollRows] = useState<CollectionRow[] | null>(null)
  const [expRows, setExpRows] = useState<ExpensesReport | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [printDoc, setPrintDoc] = useState<{ title: string; sections: DocSection[] } | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await call<AppSettings>('settings.get', {})
        if (alive) setSettings(s)
      } catch {
        /* الترويسة تسقط للاسم الافتراضي */
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
        if (tab === 'sales') {
          const r = await call<SalesDailyRow[]>('reports.sales', { from: applied.from, to: applied.to })
          if (alive) setSalesRows(r)
        } else if (tab === 'debts') {
          const r = await call<DebtRow[]>('reports.debts', {})
          if (alive) setDebtRows(r)
        } else if (tab === 'collections') {
          const r = await call<CollectionRow[]>('reports.collections', { from: applied.from, to: applied.to })
          if (alive) setCollRows(r)
        } else {
          const r = await call<ExpensesReport>('reports.expenses', { from: applied.from, to: applied.to })
          if (alive) setExpRows(r)
        }
        if (alive) setError('')
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [tab, applied, retry])

  const refresh = useCallback((): void => {
    setApplied({ from, to })
    setRetry((n) => n + 1)
  }, [from, to])

  const salesTotals = (salesRows ?? []).reduce(
    (acc, r) => ({
      invoices: acc.invoices + Number(r.invoices),
      total: acc.total + Number(r.total_minor),
      paid: acc.paid + Number(r.paid_minor),
      credit: acc.credit + Number(r.credit_minor)
    }),
    { invoices: 0, total: 0, paid: 0, credit: 0 }
  )
  const debtsTotal = (debtRows ?? []).reduce((s, r) => s + Number(r.balance_minor), 0)
  const collTotal = (collRows ?? []).reduce((s, r) => s + Number(r.amount_minor), 0)

  const rangeLabel = `${applied.from} ← ${applied.to}`

  // ---------- مولدات المستندات الرسمية (A4) ----------
  const buildPrint = useCallback((): void => {
    if (tab === 'sales' && salesRows) {
      setPrintDoc({
        title: 'تقرير المبيعات اليومية',
        sections: [
          {
            table: {
              head: ['التاريخ', 'الفواتير', 'الإجمالي', 'المدفوع', 'الآجل'],
              numericFrom: 1,
              rows: [
                ...salesRows.map((r) => [r.date, String(r.invoices), docMoney(r.total_minor), docMoney(r.paid_minor), docMoney(r.credit_minor)]),
                ['الإجمالي', String(salesTotals.invoices), docMoney(salesTotals.total), docMoney(salesTotals.paid), docMoney(salesTotals.credit)]
              ],
              boldLastRow: true
            }
          }
        ]
      })
    } else if (tab === 'debts' && debtRows) {
      setPrintDoc({
        title: 'تقرير ذمم العملاء',
        sections: [
          {
            table: {
              head: ['العميل', 'الهاتف', 'الرصيد المستحق'],
              numericFrom: 2,
              rows: [
                ...debtRows.map((r) => [r.name, r.phone ?? '—', docMoney(r.balance_minor)]),
                ['الإجمالي', '', docMoney(debtsTotal)]
              ],
              boldLastRow: true
            }
          }
        ]
      })
    } else if (tab === 'collections' && collRows) {
      setPrintDoc({
        title: 'تقرير التحصيلات',
        sections: [
          {
            table: {
              head: ['التاريخ', 'العميل', 'المبلغ', 'البيان'],
              numericFrom: 2,
              rows: [
                ...collRows.map((r) => [r.date, r.customer_name, docMoney(r.amount_minor), r.note ?? '']),
                ['الإجمالي', '', docMoney(collTotal), '']
              ],
              boldLastRow: true
            }
          }
        ]
      })
    } else if (tab === 'expenses' && expRows) {
      setPrintDoc({
        title: 'تقرير المصروفات',
        sections: [
          {
            title: 'حسب التصنيف',
            table: {
              head: ['التصنيف', 'عدد العمليات', 'الإجمالي'],
              numericFrom: 2,
              rows: [
                ...expRows.byCategory.map((r) => [r.category_name, String(r.count), docMoney(r.total_minor)]),
                ['الإجمالي', '', docMoney(expRows.totalMinor)]
              ],
              boldLastRow: true
            }
          },
          ...(expRows.byDate.length > 0
            ? [
                {
                  title: 'حسب اليوم',
                  table: {
                    head: ['التاريخ', 'الإجمالي'],
                    numericFrom: 1,
                    rows: expRows.byDate.map((r) => [r.date, docMoney(r.total_minor)])
                  }
                }
              ]
            : [])
        ]
      })
    }
  }, [tab, salesRows, debtRows, collRows, expRows, salesTotals, debtsTotal, collTotal])

  const docProps = {
    docTitle: printDoc?.title ?? '',
    businessName: settings?.businessName || 'مخبز الولاء الحديث',
    phone: settings?.phone || '',
    address: settings?.address || '',
    metaRight: `الفترة: ${rangeLabel}`,
    metaLeft: `حتى: ${today()}`
  }

  return (
    <div>
      <h1>التقارير</h1>

      {error ? <Banner kind="error" text={error} /> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`btn ${tab === t.key ? 'primary' : 'ghost'}`}
            onClick={() => setTab(t.key)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab !== 'debts' ? (
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
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn ghost small" disabled={!canExport()} onClick={() => doCsv()}>
          ⬇ CSV
        </button>
        <button className="btn ghost small" disabled={!canExport()} onClick={() => void doXlsx()}>
          ⬇ Excel (xlsx)
        </button>
        <button className="btn ghost small" disabled={!canExport()} onClick={buildPrint}>
          🖨 PDF رسمي
        </button>
      </div>

      {/* ===== جداول التقارير ===== */}
      {tab === 'sales' ? (
        salesRows === null ? (
          <EmptyState icon="⏳" text="جارٍ تحضير التقرير…" />
        ) : salesRows.length === 0 ? (
          <EmptyState icon="🧾" text="لا مبيعات في هذه الفترة — جرّب توسيع المدى أو أنشئ فاتورة من نقطة البيع." />
        ) : (
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
              {salesRows.map((r) => (
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
                <td className="num" style={{ fontWeight: 800 }}>{salesTotals.invoices}</td>
                <td className="num" style={{ fontWeight: 800 }}>{money(salesTotals.total)}</td>
                <td className="num" style={{ fontWeight: 800 }}>{money(salesTotals.paid)}</td>
                <td className="num" style={{ fontWeight: 800, color: salesTotals.credit > 0 ? 'var(--err)' : undefined }}>
                  {money(salesTotals.credit)}
                </td>
              </tr>
            </tfoot>
          </table>
        )
      ) : null}

      {tab === 'debts' ? (
        debtRows === null ? (
          <EmptyState icon="⏳" text="جارٍ تحضير التقرير…" />
        ) : debtRows.length === 0 ? (
          <EmptyState icon="✅" text="لا ديون قائمة — كل العملاء مسددون." />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>العميل</th>
                <th>الهاتف</th>
                <th className="num">الرصيد المستحق</th>
              </tr>
            </thead>
            <tbody>
              {debtRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td dir="ltr">{r.phone ?? '—'}</td>
                  <td className="num" style={{ color: 'var(--err)', fontWeight: 700 }}>{money(Number(r.balance_minor))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700, color: 'var(--brown-900)' }}>الإجمالي</td>
                <td></td>
                <td className="num" style={{ fontWeight: 800, color: 'var(--err)' }}>{money(debtsTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )
      ) : null}

      {tab === 'collections' ? (
        collRows === null ? (
          <EmptyState icon="⏳" text="جارٍ تحضير التقرير…" />
        ) : collRows.length === 0 ? (
          <EmptyState icon="💵" text="لا تحصيلات في هذه الفترة — التحصيل من شاشة «العملاء» أو لوحة التحكم." />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>العميل</th>
                <th className="num">المبلغ</th>
                <th>البيان</th>
              </tr>
            </thead>
            <tbody>
              {collRows.map((r, i) => (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td>{r.customer_name}</td>
                  <td className="num" style={{ color: 'var(--ok)', fontWeight: 700 }}>{money(Number(r.amount_minor))}</td>
                  <td>{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700, color: 'var(--brown-900)' }}>الإجمالي</td>
                <td></td>
                <td className="num" style={{ fontWeight: 800, color: 'var(--ok)' }}>{money(collTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )
      ) : null}

      {tab === 'expenses' ? (
        expRows === null ? (
          <EmptyState icon="⏳" text="جارٍ تحضير التقرير…" />
        ) : expRows.byCategory.length === 0 ? (
          <EmptyState icon="🧮" text="لا مصروفات في هذه الفترة — سجّلها من شاشة «المصروفات»." />
        ) : (
          <>
            <h2 style={{ marginTop: 4 }}>حسب التصنيف</h2>
            <table className="data">
              <thead>
                <tr>
                  <th>التصنيف</th>
                  <th className="num">عدد العمليات</th>
                  <th className="num">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {expRows.byCategory.map((r, i) => (
                  <tr key={i}>
                    <td>{r.category_name}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{money(Number(r.total_minor))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 700, color: 'var(--brown-900)' }}>الإجمالي</td>
                  <td></td>
                  <td className="num" style={{ fontWeight: 800 }}>{money(expRows.totalMinor)}</td>
                </tr>
              </tfoot>
            </table>
            <h2 style={{ marginTop: 18 }}>حسب اليوم</h2>
            <table className="data">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th className="num">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {expRows.byDate.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td className="num">{money(Number(r.total_minor))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      ) : null}

      {/* ===== معاينة الطباعة A4 ===== */}
      {printDoc ? (
        <DocModal title={`معاينة — ${printDoc.title}`} onClose={() => setPrintDoc(null)}>
          <A4Doc {...docProps} sections={printDoc.sections} />
        </DocModal>
      ) : null}
    </div>
  )

  // ---------- أدوات داخلية ----------
  function canExport(): boolean {
    if (tab === 'sales') return (salesRows?.length ?? 0) > 0
    if (tab === 'debts') return (debtRows?.length ?? 0) > 0
    if (tab === 'collections') return (collRows?.length ?? 0) > 0
    return (expRows?.byCategory.length ?? 0) > 0
  }

  function doCsv(): void {
    if (tab === 'sales' && salesRows) {
      downloadCsv(`تقرير-المبيعات_${applied.from}_${applied.to}`, [
        ['التاريخ', 'عدد الفواتير', 'الإجمالي', 'المدفوع', 'الآجل'],
        ...salesRows.map((r) => [r.date, Number(r.invoices), csvMoney(r.total_minor), csvMoney(r.paid_minor), csvMoney(r.credit_minor)]),
        ['الإجمالي', salesTotals.invoices, csvMoney(salesTotals.total), csvMoney(salesTotals.paid), csvMoney(salesTotals.credit)]
      ])
    } else if (tab === 'debts' && debtRows) {
      downloadCsv('تقرير-ذمم-العملاء', [
        ['العميل', 'الهاتف', 'الرصيد المستحق'],
        ...debtRows.map((r) => [r.name, r.phone ?? '', csvMoney(r.balance_minor)]),
        ['الإجمالي', '', csvMoney(debtsTotal)]
      ])
    } else if (tab === 'collections' && collRows) {
      downloadCsv(`تقرير-التحصيلات_${applied.from}_${applied.to}`, [
        ['التاريخ', 'العميل', 'المبلغ', 'البيان'],
        ...collRows.map((r) => [r.date, r.customer_name, csvMoney(r.amount_minor), r.note ?? '']),
        ['الإجمالي', '', csvMoney(collTotal), '']
      ])
    } else if (tab === 'expenses' && expRows) {
      downloadCsv(`تقرير-المصروفات_${applied.from}_${applied.to}`, [
        ['التصنيف', 'عدد العمليات', 'الإجمالي'],
        ...expRows.byCategory.map((r) => [r.category_name, r.count, csvMoney(r.total_minor)]),
        ['الإجمالي', '', csvMoney(expRows.totalMinor)]
      ])
    }
  }

  async function doXlsx(): Promise<void> {
    if (tab === 'sales' && salesRows) {
      await downloadXlsx(`تقرير-المبيعات_${applied.from}_${applied.to}`, 'المبيعات اليومية', [
        { key: 'date', label: 'التاريخ', width: 14, center: true },
        { key: 'invoices', label: 'عدد الفواتير', width: 14 },
        { key: 'total', label: 'الإجمالي', width: 16, numFmt: '#,##0.00' },
        { key: 'paid', label: 'المدفوع', width: 16, numFmt: '#,##0.00' },
        { key: 'credit', label: 'الآجل', width: 16, numFmt: '#,##0.00' }
      ], salesRows.map((r) => ({ date: r.date, invoices: r.invoices, total: xlsxMoney(r.total_minor), paid: xlsxMoney(r.paid_minor), credit: xlsxMoney(r.credit_minor) })), {
        date: 'الإجمالي', invoices: salesTotals.invoices, total: xlsxMoney(salesTotals.total), paid: xlsxMoney(salesTotals.paid), credit: xlsxMoney(salesTotals.credit)
      })
    } else if (tab === 'debts' && debtRows) {
      await downloadXlsx('تقرير-ذمم-العملاء', 'الذمم', [
        { key: 'name', label: 'العميل', width: 26 },
        { key: 'phone', label: 'الهاتف', width: 16, center: true },
        { key: 'balance', label: 'الرصيد المستحق', width: 18, numFmt: '#,##0.00' }
      ], debtRows.map((r) => ({ name: r.name, phone: r.phone ?? '', balance: xlsxMoney(r.balance_minor) })), {
        name: 'الإجمالي', phone: '', balance: xlsxMoney(debtsTotal)
      })
    } else if (tab === 'collections' && collRows) {
      await downloadXlsx(`تقرير-التحصيلات_${applied.from}_${applied.to}`, 'التحصيلات', [
        { key: 'date', label: 'التاريخ', width: 14, center: true },
        { key: 'customer', label: 'العميل', width: 26 },
        { key: 'amount', label: 'المبلغ', width: 16, numFmt: '#,##0.00' },
        { key: 'note', label: 'البيان', width: 30 }
      ], collRows.map((r) => ({ date: r.date, customer: r.customer_name, amount: xlsxMoney(r.amount_minor), note: r.note ?? '' })), {
        date: 'الإجمالي', customer: '', amount: xlsxMoney(collTotal), note: ''
      })
    } else if (tab === 'expenses' && expRows) {
      await downloadXlsx(`تقرير-المصروفات_${applied.from}_${applied.to}`, 'المصروفات', [
        { key: 'category', label: 'التصنيف', width: 26 },
        { key: 'count', label: 'عدد العمليات', width: 14 },
        { key: 'total', label: 'الإجمالي', width: 16, numFmt: '#,##0.00' }
      ], expRows.byCategory.map((r) => ({ category: r.category_name, count: r.count, total: xlsxMoney(r.total_minor) })), {
        category: 'الإجمالي', count: '', total: xlsxMoney(expRows.totalMinor)
      })
    }
  }
}

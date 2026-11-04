// =============================================================
// مخبز الولاء الحديث — ورقة نهاية اليوم (rc.9 — المرحلة 3)
// مجمع رسمي A4: مبيعات/نقدية/تحصيلات/مصروفات/أعلى الأصناف — يُطبع ويُحفظ PDF.
// =============================================================
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { EodData } from '../../../shared/types'
import { call, fmtDateTime } from '../api'
import { Banner } from './ui'
import { A4Doc, DocModal, docMoney } from '../printDoc'

const METHOD_LABEL: Record<string, string> = {
  CASH: 'نقدًا',
  CREDIT: 'آجل'
}

export default function EodModal(props: { date: string; onClose: () => void }): ReactNode {
  const [data, setData] = useState<EodData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const d = await call<EodData>('reports.eod', { date: props.date })
        if (alive) setData(d)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [props.date])

  const cur = data?.currencySymbol ?? '₪'

  return (
    <DocModal title={`ورقة نهاية اليوم — ${props.date}`} onClose={props.onClose}>
      {error ? <Banner kind="error" text={error} /> : null}
      {!data && !error ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>جارٍ تجهيز الورقة…</div> : null}
      {data ? (
        <A4Doc
          docTitle="ورقة نهاية اليوم"
          docSubtitle="مجمّع يومي رسمي"
          businessName={data.businessName}
          metaRight={`التاريخ: ${data.date}`}
          metaLeft={`وقت التجهيز: ${fmtDateTime(new Date().toISOString())}`}
          sections={[
            {
              title: 'الملخص المالي',
              table: {
                head: ['البند', 'المبلغ'],
                numericFrom: 1,
                rows: [
                  ['عدد الفواتير', String(data.invoicesCount)],
                  ['إجمالي المبيعات', docMoney(data.salesTotalMinor, cur)],
                  ['منها آجل (على الحساب)', docMoney(data.creditSalesMinor, cur)],
                  ['التحصيلات من الذمم', docMoney(data.collectionsMinor, cur)],
                  ['المصروفات', docMoney(data.expensesMinor, cur)],
                  ['صافي حركة الصندوق', docMoney(data.cashNetMinor, cur)]
                ],
                boldLastRow: true
              }
            },
            ...(data.byMethod.length > 0
              ? [
                  {
                    title: 'المدفوعات حسب الطريقة',
                    table: {
                      head: ['الطريقة', 'المبلغ'],
                      numericFrom: 1,
                      rows: data.byMethod.map((m) => [METHOD_LABEL[m.method] ?? m.method, docMoney(m.amount_minor, cur)])
                    }
                  }
                ]
              : []),
            ...(data.topItems.length > 0
              ? [
                  {
                    title: 'أعلى الأصناف مبيعًا اليوم',
                    table: {
                      head: ['الصنف', 'الكمية', 'الإيراد'],
                      numericFrom: 2,
                      rows: data.topItems.map((t) => [t.product_name, (t.qty_milli / 1000).toLocaleString('ar'), docMoney(t.revenue_minor, cur)])
                    }
                  }
                ]
              : []),
            {
              title: 'الحالة',
              lines: [
                data.openShift ? `الوردية مفتوحة منذ ${fmtDateTime(data.openShift.opened_at)} — أقفلها من شاشة «الورديات والصندوق».` : 'لا وردية مفتوحة حاليًا.',
                'هذه الورقة من الحركات الفعلية المسجلة في النظام حتى لحظة الطباعة.'
              ]
            }
          ]}
        />
      ) : null}
    </DocModal>
  )
}

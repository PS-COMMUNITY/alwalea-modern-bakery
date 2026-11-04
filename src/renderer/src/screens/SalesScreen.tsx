// =============================================================
// مخبز الولاء الحديث — شاشة المبيعات: سجل الفواتير + تفاصيل + إلغاء
// القنوات: sales.list/get/cancel
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SaleRow, SessionUser } from '../../../shared/types'
import { call, money, qty as fmtQ, fmtDateTime } from '../api'
import { Field, Modal, Banner, EmptyState, statusBadge } from '../components/ui'

interface SaleDetailUI extends SaleRow {
  subtotal_minor: number
  discount_minor: number
  tax_minor: number
  note: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  items: Array<{
    id: number
    product_id: number
    product_name: string
    qty_milli: number
    unit_price_minor: number
    discount_minor: number
    line_total_minor: number
  }>
  payments: Array<{ id: number; method: string; amount_minor: number }>
}

function sourceLabel(s: string): string {
  if (s === 'POS') return 'نقطة البيع'
  if (s === 'DISTRIBUTION') return 'جولة توزيع'
  return s
}

function methodLabel(m: string): string {
  if (m === 'CASH') return 'نقدًا'
  if (m === 'CREDIT') return 'آجل'
  return m
}

export default function SalesScreen(props: { user: SessionUser }): ReactNode {
  const [rows, setRows] = useState<SaleRow[] | null>(null)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [detail, setDetail] = useState<SaleDetailUI | null>(null)
  const [cancelFor, setCancelFor] = useState<SaleRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const canCancel = props.user.perms.includes('sales.cancel')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      if (status) payload.status = status
      if (q.trim()) payload.q = q.trim()
      const data = await call<SaleRow[]>('sales.list', payload)
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [status, q])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (id: number): Promise<void> => {
    setError('')
    try {
      setDetail(await call<SaleDetailUI>('sales.get', { id }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const submitCancel = async (): Promise<void> => {
    if (!cancelFor) return
    if (cancelReason.trim().length < 3) {
      setError('اكتب سبب الإلغاء (3 أحرف على الأقل)')
      return
    }
    setBusy(true)
    setError('')
    try {
      await call('sales.cancel', { id: cancelFor.id, reason: cancelReason.trim() })
      setCancelFor(null)
      setCancelReason('')
      setNotice('تم إلغاء الفاتورة: رُدت الكميات للمخزون ووُثّق رد النقد وخصم الآجل من دفتر العميل')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ marginRight: 'auto' }}>المبيعات</h1>
        <input
          placeholder="🔍 بحث برقم الفاتورة…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px', minWidth: 200 }}
        />
        <div className="field" style={{ marginBottom: 0 }}>
          <label>الحالة</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">الكل</option>
            <option value="PAID">مدفوعة</option>
            <option value="PARTIAL">جزئية</option>
            <option value="CREDIT">آجلة</option>
            <option value="CANCELLED">ملغاة</option>
          </select>
        </div>
      </div>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {rows === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : rows.length === 0 ? (
        <EmptyState icon="📋" text="لا فواتير مطابقة — جرّب تغيير الحالة أو رقم البحث، أو سجّل بيعًا من نقطة البيع." />
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
              <th>المصدر</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                style={{ cursor: 'pointer' }}
                onClick={() => void openDetail(r.id)}
                title="انقر لعرض تفاصيل الفاتورة"
              >
                <td>
                  <strong>{r.invoice_no}</strong>
                </td>
                <td dir="ltr">{r.date}</td>
                <td>{r.customer_name ?? '— عميل نقدي —'}</td>
                <td className="num">{money(r.total_minor)}</td>
                <td className="num">{money(r.paid_minor)}</td>
                <td className="num">{r.credit_minor > 0 ? money(r.credit_minor) : '—'}</td>
                <td>{statusBadge(r.status)}</td>
                <td>{sourceLabel(r.source)}</td>
                <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost small" onClick={() => void openDetail(r.id)}>
                    تفاصيل
                  </button>{' '}
                  {canCancel && r.status !== 'CANCELLED' ? (
                    <button
                      className="btn danger small"
                      disabled={busy}
                      onClick={() => {
                        setCancelReason('')
                        setCancelFor(r)
                      }}
                    >
                      إلغاء
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail ? (
        <Modal title={`فاتورة بيع: ${detail.invoice_no}`} onClose={() => setDetail(null)} wide>
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">الإجمالي</div>
              <div className="value">{money(detail.total_minor)}</div>
            </div>
            <div className="stat">
              <div className="label">المدفوع</div>
              <div className="value ok">{money(detail.paid_minor)}</div>
            </div>
            <div className="stat">
              <div className="label">الآجل</div>
              <div className={`value ${detail.credit_minor > 0 ? 'err' : ''}`}>{money(detail.credit_minor)}</div>
            </div>
            <div className="stat">
              <div className="label">الحالة</div>
              <div className="value" style={{ fontSize: 16 }}>{statusBadge(detail.status)}</div>
            </div>
          </div>

          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 10px' }}>
            العميل: {detail.customer_name ?? 'نقدي'} — المصدر: {sourceLabel(detail.source)} — التاريخ: <span dir="ltr">{detail.date}</span> —
            سُجّلت: {fmtDateTime(detail.created_at)}
          </p>
          {detail.note ? <p style={{ fontSize: 13, margin: '0 0 10px' }}>ملاحظة: {detail.note}</p> : null}
          {detail.cancel_reason ? (
            <Banner
              kind="error"
              text={`ملغاة — السبب: ${detail.cancel_reason}${detail.cancelled_at ? ` (${fmtDateTime(detail.cancelled_at)})` : ''}`}
            />
          ) : null}

          <table className="data">
            <thead>
              <tr>
                <th>المنتج</th>
                <th className="num">الكمية</th>
                <th className="num">سعر الوحدة</th>
                <th className="num">الخصم</th>
                <th className="num">إجمالي السطر</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.product_name}</td>
                  <td className="num">{fmtQ(it.qty_milli)}</td>
                  <td className="num">{money(it.unit_price_minor)}</td>
                  <td className="num">{it.discount_minor > 0 ? money(it.discount_minor) : '—'}</td>
                  <td className="num">{money(it.line_total_minor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ fontWeight: 700 }}>المجموع قبل الخصم</td>
                <td className="num">{money(detail.subtotal_minor)}</td>
              </tr>
              {detail.discount_minor > 0 ? (
                <tr>
                  <td colSpan={4}>خصم الفاتورة</td>
                  <td className="num">−{money(detail.discount_minor)}</td>
                </tr>
              ) : null}
              {detail.tax_minor > 0 ? (
                <tr>
                  <td colSpan={4}>الضريبة</td>
                  <td className="num">+{money(detail.tax_minor)}</td>
                </tr>
              ) : null}
            </tfoot>
          </table>

          <h3 style={{ marginTop: 14 }}>الدفعات</h3>
          {detail.payments.length === 0 ? (
            <EmptyState icon="💳" text="لا دفعات مسجلة على هذه الفاتورة (آجلة بالكامل)." />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>الطريقة</th>
                  <th className="num">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {detail.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{methodLabel(p.method)}</td>
                    <td className="num">{money(p.amount_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      ) : null}

      {cancelFor ? (
        <Modal title={`إلغاء فاتورة بيع: ${cancelFor.invoice_no}`} onClose={() => setCancelFor(null)}>
          <Banner
            kind="error"
            text={
              `الإلغاء عكسي وموثق: تُرد الكميات للمخزون، و${cancelFor.paid_minor > 0 ? `يُرد النقد (${money(cancelFor.paid_minor)}) من الصندوق، ` : ''}` +
              `${cancelFor.credit_minor > 0 && cancelFor.customer_name ? `ويُخصم الآجل (${money(cancelFor.credit_minor)}) من دفتر العميل «${cancelFor.customer_name}».` : 'وتُصفّر حقوق الفاتورة.'}`
            }
          />
          <Field label="سبب الإلغاء *" hint="يُوثق في سجل التدقيق — 3 أحرف على الأقل">
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="مثال: خطأ في التسجيل / مرتجع كامل"
              autoFocus
            />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" disabled={busy} onClick={() => void submitCancel()}>
              {busy ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
            </button>
            <button className="btn ghost" onClick={() => setCancelFor(null)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

// =============================================================
// مخبز الولاء الحديث — إيصال حراري 80مم + طباعة عبر window.print
// =============================================================
import type { ReactNode } from 'react'
import type { SaleDetail } from '../../../shared/types'
import { Modal } from './ui'
import { qty as fmtQ } from '../api'

function m(minor: number): string {
  return (minor / 100).toFixed(2)
}

export default function ReceiptModal(props: {
  sale: SaleDetail
  businessName: string
  footer: string
  currency: string
  onClose: () => void
}): ReactNode {
  const s = props.sale
  const cur = props.currency

  return (
    <Modal title={`فاتورة ${s.invoice_no}`} onClose={props.onClose}>
      <div id="receipt-print">
        <div className="receipt-80">
          <div className="r-center r-biz">{props.businessName}</div>
          {s.customer_name ? <div className="r-center">العميل: {s.customer_name}</div> : null}
          <div className="r-center">
            {s.date} — {s.invoice_no}
          </div>
          <div className="r-line" />
          <table>
            <thead>
              <tr>
                <th>الصنف</th>
                <th>كمية</th>
                <th>سعر</th>
                <th>إجمالي</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.product_name}</td>
                  <td>{fmtQ(it.qty_milli)}</td>
                  <td>{m(it.unit_price_minor)}</td>
                  <td>{m(it.line_total_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="r-line" />
          <table>
            <tbody>
              <tr>
                <td>المجموع</td>
                <td>{m(s.subtotal_minor)} {cur}</td>
              </tr>
              {s.discount_minor > 0 ? (
                <tr>
                  <td>الخصم</td>
                  <td>−{m(s.discount_minor)} {cur}</td>
                </tr>
              ) : null}
              {s.tax_minor > 0 ? (
                <tr>
                  <td>الضريبة</td>
                  <td>{m(s.tax_minor)} {cur}</td>
                </tr>
              ) : null}
              <tr className="r-total">
                <td>الإجمالي</td>
                <td>{m(s.total_minor)} {cur}</td>
              </tr>
              {s.payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.method === 'CASH' ? 'نقدًا' : 'آجل'}</td>
                  <td>{m(p.amount_minor)} {cur}</td>
                </tr>
              ))}
              {s.credit_minor > 0 ? (
                <tr>
                  <td>المتبقي (آجل)</td>
                  <td>{m(s.credit_minor)} {cur}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className="r-line" />
          <div className="r-center">{props.footer}</div>
          <div className="r-center" style={{ fontSize: 10 }}>
            شكرًا لزيارتكم 🥖
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => window.print()}>
          🖨️ طباعة
        </button>
        <button className="btn ghost" onClick={props.onClose}>
          إغلاق
        </button>
      </div>
    </Modal>
  )
}

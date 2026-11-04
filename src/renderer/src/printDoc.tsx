// =============================================================
// مخبز الولاء الحديث — محرك المستندات الرسمية A4 (rc.9 — المرحلة 3)
// ترويسة باسم المخبز وهواتفه + عنوان المستند + أقسام وجداول + توقيع.
// الطباعة: window.print مع تبديل مقاس الورقة إلى A4 ثم إرجاعه للإيصال 80مم.
// العربية مضمونة 100% — الطباعة من داخل التطبيق لا عبر HTML خارجي.
// =============================================================
import type { ReactNode } from 'react'
import { Modal } from './components/ui'

/** مبلغ بالأغورة لنص في المستند (1250 → "12.50 ₪") */
export function docMoney(minor: number, symbol = '₪'): string {
  return `${(minor / 100).toFixed(2)} ${symbol}`
}

export interface DocTable {
  head: readonly string[]
  rows: readonly (readonly string[])[]
  /** الأعمدة الرقمية (من فهرس 0) تُحاذى يسارًا */
  numericFrom?: number
  /** صف المجاميع = آخر صف يُجسأ */
  boldLastRow?: boolean
}

export interface DocSection {
  title?: string
  lines?: readonly string[]
  table?: DocTable
}

function DocTableEl(props: { table: DocTable }): ReactNode {
  const { head, rows, numericFrom, boldLastRow } = props.table
  return (
    <table className="a4-table">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className={boldLastRow && ri === rows.length - 1 ? 'a4-total' : undefined}>
            {r.map((v, ci) => (
              <td key={ci} className={numericFrom !== undefined && ci >= numericFrom ? 'num' : undefined}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** مستند A4 كامل — يوضع داخل عنصر بمعرف #a4-print ليُطبع وحده */
export function A4Doc(props: {
  docTitle: string
  docSubtitle?: string
  businessName: string
  phone?: string
  address?: string
  metaRight?: string
  metaLeft?: string
  sections: readonly DocSection[]
  footerNote?: string
}): ReactNode {
  return (
    <div id="a4-print" dir="rtl">
      <div className="a4-head">
        <div className="a4-biz">
          <div className="a4-biz-name">{props.businessName}</div>
          <div className="a4-biz-line">
            {[props.phone, props.address].filter((x) => x && x.trim() !== '').join(' • ') || '\u00a0'}
          </div>
        </div>
        <div className="a4-doc-title">
          <div>{props.docTitle}</div>
          {props.docSubtitle ? <div className="a4-doc-sub">{props.docSubtitle}</div> : null}
        </div>
      </div>
      {(props.metaRight || props.metaLeft) && (
        <div className="a4-meta">
          <span>{props.metaRight ?? ''}</span>
          <span>{props.metaLeft ?? ''}</span>
        </div>
      )}
      {props.sections.map((s, si) => (
        <div className="a4-section" key={si}>
          {s.title ? <div className="a4-section-title">{s.title}</div> : null}
          {s.lines ? (
            <ul className="a4-lines">
              {s.lines.map((l, li) => (
                <li key={li}>{l}</li>
              ))}
            </ul>
          ) : null}
          {s.table ? <DocTableEl table={s.table} /> : null}
        </div>
      ))}
      <div className="a4-footer">{props.footerNote ?? `طُبع من نظام مخبز الولاء الحديث — ${new Date().toLocaleDateString('ar')}`}</div>
    </div>
  )
}

/** طباعة المستند A4: تبديل مقاس الورقة مؤقتًا (الإيصال الافتراضي 80مم يبقى سليمًا) */
export function printA4(): void {
  let el = document.getElementById('page-size-rule') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'page-size-rule'
    document.head.appendChild(el)
  }
  el.textContent = '@page { size: A4; margin: 12mm; }'
  const restore = (): void => {
    el!.textContent = '@page { size: 80mm auto; margin: 0; }'
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  window.print()
}

/** نافذة معاينة المستند الرسمي قبل الطباعة (تُستخدم من كل التقارير) */
export function DocModal(props: {
  title: string
  onClose: () => void
  children: ReactNode
}): ReactNode {
  return (
    <Modal title={props.title} onClose={props.onClose} wide>
      {props.children}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => printA4()}>
          🖨 طباعة / حفظ PDF
        </button>
        <button className="btn ghost" onClick={props.onClose}>
          إغلاق
        </button>
      </div>
    </Modal>
  )
}

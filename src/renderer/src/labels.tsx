// =============================================================
// مخبز الولاء الحديث — ملصقات باركود Code 39 للطباعة A4 (rc.10)
// SKU صالح (حرف/رقم/رموز Code39، 1–20 خانة) يُستخدم كما هو،
// وإلا يُطبع رقم المنتج مبطّنًا إلى 6 أرقام — مقاسان: 48×25 و58×30 ملم.
// =============================================================
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProductRow } from '../../shared/types'
import { money } from './api'
import { isCode39Valid, encodeCode39, code39Bars } from './code39'
import { Modal } from './components/ui'

const SIZES = {
  small: { label: '48×25 ملم — 4 أعمدة (تقريبًا 40 ملصقًا/ورقة)', cols: 4, w: 48, h: 25, barH: 9 },
  large: { label: '58×30 ملم — 3 أعمدة (أوضح للقراءة)', cols: 3, w: 58, h: 30, barH: 11 }
} as const

type SizeKey = keyof typeof SIZES

/** رمز الملصق: SKU صالح كما هو، وإلا رقم المنتج مبطّن (6 أرقام) */
function labelCode(p: ProductRow): string {
  const sku = (p.sku ?? '').trim().toUpperCase()
  return sku.length >= 1 && sku.length <= 20 && isCode39Valid(sku) ? sku : String(p.id).padStart(6, '0')
}

/** قضبان الباركود: كل وحدة 0.33 ملم — أسود/شفاف بالتناوب */
function BarcodeBars(props: { value: string; barHeight: number }): ReactNode {
  const runs = code39Bars(encodeCode39(props.value))
  const unit = 0.33
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        height: `${props.barHeight}mm`,
        direction: 'ltr'
      }}
    >
      {runs.map((r, i) => (
        <div key={i} style={{ width: `${r * unit}mm`, background: i % 2 === 0 ? '#000' : 'transparent' }} />
      ))}
    </div>
  )
}

function LabelCell(props: { p: ProductRow; size: (typeof SIZES)[SizeKey] }): ReactNode {
  const code = labelCode(props.p)
  return (
    <div className="label-cell" style={{ width: `${props.size.w}mm`, height: `${props.size.h}mm` }}>
      <div className="label-name">{props.p.name}</div>
      <BarcodeBars value={code} barHeight={props.size.barH} />
      <div className="label-code">{code}</div>
      <div className="label-price">{money(props.p.price_minor)}</div>
    </div>
  )
}

/** طباعة: صفحة A4 بهامش 6مم — تعود الإعدادات بعد الطباعة تلقائيًا */
function printA4(): void {
  const id = 'page-size-rule'
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  if (el) el.textContent = '@page { size: A4; margin: 6mm; }'
  const restore = (): void => {
    const h = document.getElementById(id)
    if (h) h.textContent = '@page { size: 80mm auto; margin: 0; }'
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  window.print()
}

export default function LabelsModal(props: { products: ProductRow[]; onClose: () => void }): ReactNode {
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [copies, setCopies] = useState(1)
  const [sizeKey, setSizeKey] = useState<SizeKey>('small')

  const toggle = (id: number): void => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  const selectAll = (): void => setSelected(new Set(props.products.map((p) => p.id)))
  const clearAll = (): void => setSelected(new Set())
  const copiesNum = Math.max(1, Math.min(200, Math.floor(copies) || 1))

  const labels = useMemo(() => {
    const out: ProductRow[] = []
    for (const p of props.products) {
      if (selected.has(p.id)) {
        for (let i = 0; i < copiesNum; i++) out.push(p)
      }
    }
    return out
  }, [props.products, selected, copiesNum])

  const size = SIZES[sizeKey]

  return (
    <Modal title="🏷️ ملصقات باركود — طباعة A4" onClose={props.onClose}>
      <div style={{ maxWidth: 860 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <button className="btn ghost small" onClick={selectAll}>
            تحديد الكل ({props.products.length})
          </button>
          <button className="btn ghost small" onClick={clearAll}>
            مسح التحديد
          </button>
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            نسخ لكل منتج:
            <input
              type="number"
              min={1}
              max={200}
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value))}
              style={{ width: 70, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px' }}
            />
          </label>
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            المقاس:
            <select
              value={sizeKey}
              onChange={(e) => setSizeKey(e.target.value as SizeKey)}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px' }}
            >
              {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                <option key={k} value={k}>
                  {SIZES[k].label}
                </option>
              ))}
            </select>
          </label>
          <span className="badge muted">
            المحدد: {selected.size} • الملصقات: {labels.length}
          </span>
        </div>

        <div style={{ maxHeight: '40vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 10 }}>
          <table className="data" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>المنتج</th>
                <th>الرمز</th>
                <th className="num">السعر</th>
              </tr>
            </thead>
            <tbody>
              {props.products.map((p) => (
                <tr key={p.id} onClick={() => toggle(p.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td>
                    {p.name}
                    {p.active !== 1 ? ' (معطل)' : ''}
                  </td>
                  <td dir="ltr">{p.sku ?? '—'}</td>
                  <td className="num">{money(p.price_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {labels.length === 0 ? (
          <p className="empty" style={{ padding: '18px 0' }}>
            حدّد منتجًا واحدًا على الأقل من الجدول لتوليد الملصقات.
          </p>
        ) : (
          <>
            <div
              style={{
                maxHeight: '38vh',
                overflowY: 'auto',
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: 10,
                background: '#fff'
              }}
            >
              <div
                id="labels-print"
                dir="rtl"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${size.cols}, ${size.w}mm)`,
                  gap: '2mm',
                  justifyContent: 'center'
                }}
              >
                {labels.map((p, i) => (
                  <LabelCell key={`${p.id}-${i}`} p={p} size={size} />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start', marginTop: 12 }}>
              <button className="btn primary" onClick={printA4}>
                🖨 طباعة الورقة
              </button>
              <button className="btn ghost" onClick={props.onClose}>
                إغلاق
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#777', marginTop: 8 }}>
              الباركود بصيغة Code 39 — أي قارئ مسح عادي يقرأه. إن كان للمنتج رمز SKU صالح يُستخدم، وإلا يُطبع رقم المنتج (6 أرقام).
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

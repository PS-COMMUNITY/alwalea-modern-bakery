// =============================================================
// مخبز الولاء الحديث — مكوّنات واجهة صغيرة (React hooks فقط)
// =============================================================
import type { ReactNode } from 'react'

export function Field(props: {
  label: string
  children: ReactNode
  hint?: string
}): ReactNode {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  )
}

export function Banner(props: { kind: 'error' | 'ok'; text: string }): ReactNode {
  return <div className={`banner ${props.kind}`}>{props.text}</div>
}

export function EmptyState(props: { icon: string; text: string }): ReactNode {
  return (
    <div className="empty">
      <span className="ico" aria-hidden>
        {props.icon}
      </span>
      {props.text}
    </div>
  )
}

export function Modal(props: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}): ReactNode {
  return (
    <div
      className="modal-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className={`modal${props.wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="btn ghost small" onClick={props.onClose}>
            إغلاق ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

export function Badge(props: { kind: 'ok' | 'warn' | 'err' | 'muted'; text: string }): ReactNode {
  return <span className={`badge ${props.kind}`}>{props.text}</span>
}

// rc.12-merge: نقل ConfirmModal من local — نافذة تأكيد موحدة للإجراءات الخطرة، يستخدمها مدير الفئات المدمج في شاشة المنتجات (إضافة فقط — لا تكسر أي مكوّن قائم)
/** نافذة تأكيد موحدة للحذف والإجراءات الخطرة (حمراء) — تُستخدم في الحذف/الاستعادة/الاعتماد */
export function ConfirmModal(props: {
  title: string
  message: string
  confirmLabel?: string
  busy?: boolean
  disabled?: boolean
  onConfirm: () => void
  onClose: () => void
}): ReactNode {
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <Banner kind="error" text={props.message} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button className="btn danger" disabled={props.busy || props.disabled} onClick={props.onConfirm}>
          {props.busy ? 'جارٍ التنفيذ…' : props.confirmLabel ?? 'تأكيد'}
        </button>
        <button className="btn ghost" onClick={props.onClose} disabled={props.busy}>
          تراجع
        </button>
      </div>
    </Modal>
  )
}

export function statusBadge(status: string): ReactNode {
  if (status === 'PAID') return <Badge kind="ok" text="مدفوعة" />
  if (status === 'PARTIAL') return <Badge kind="warn" text="جزئية" />
  if (status === 'CREDIT') return <Badge kind="err" text="آجلة" />
  if (status === 'CANCELLED') return <Badge kind="muted" text="ملغاة" />
  if (status === 'OPEN') return <Badge kind="warn" text="مفتوحة" />
  if (status === 'SETTLED') return <Badge kind="ok" text="مسواة" />
  if (status === 'ACTIVE') return <Badge kind="ok" text="نشط" />
  return <Badge kind="muted" text={status} />
}

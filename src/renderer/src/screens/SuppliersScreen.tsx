// =============================================================
// مخبز الولاء الحديث — شاشة الموردين: ملف + كشف حساب + تسجيل دفعة
// القنوات: suppliers.list/get/create/update/statement/payment
// الرصيد موجب = مستحق للمورد (علينا)
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PartyRow, LedgerRow, SessionUser } from '../../../shared/types'
import { call, money, fmtDateTime } from '../api'
import { Field, Modal, Banner, Badge, EmptyState } from '../components/ui'

interface SupplierUI extends PartyRow {
  balance_minor: number
}

interface StatementData {
  supplier: PartyRow
  rows: LedgerRow[]
  balanceMinor: number
}

const emptyForm = { id: 0, name: '', phone: '', address: '', note: '' }
type FormState = typeof emptyForm

export default function SuppliersScreen(props: { user: SessionUser }): ReactNode {
  const [rows, setRows] = useState<SupplierUI[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [statement, setStatement] = useState<StatementData | null>(null)
  const [payFor, setPayFor] = useState<SupplierUI | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')

  const canManage = props.user.perms.includes('suppliers.manage')
  const canPay = props.user.perms.includes('suppliers.pay')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const data = await call<SupplierUI[]>('suppliers.list', { q, includeInactive: true })
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [q])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (): Promise<void> => {
    if (!form) return
    if (!form.name.trim()) {
      setError('اسم المورد مطلوب')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        note: form.note.trim() || null
      }
      if (form.id === 0) await call('suppliers.create', payload)
      else await call('suppliers.update', { id: form.id, ...payload })
      setForm(null)
      setNotice('تم الحفظ')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openStatement = async (s: SupplierUI): Promise<void> => {
    setError('')
    try {
      const st = await call<StatementData>('suppliers.statement', { id: s.id })
      setStatement(st)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const submitPayment = async (): Promise<void> => {
    if (!payFor) return
    const n = parseFloat(payAmount)
    if (!Number.isFinite(n) || n <= 0) {
      setError('أدخل مبلغ دفعة صحيحًا أكبر من صفر')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await call<{ balanceMinor: number }>('suppliers.payment', {
        supplierId: payFor.id,
        amountMinor: Math.round(n * 100),
        note: payNote.trim() || null
      })
      setPayFor(null)
      setPayAmount('')
      setPayNote('')
      setNotice(`تم تسجيل دفعة المورد وخصمها من الصندوق — الرصيد الجديد: ${money(res.balanceMinor)}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const refLabel = (r: LedgerRow): string => {
    if (r.ref_type === 'PURCHASE') return 'فاتورة شراء'
    if (r.ref_type === 'PAYMENT') return 'دفعة'
    if (r.ref_type === 'ADJUSTMENT') return 'تسوية'
    if (r.ref_type === 'PURCHASE_CANCEL') return 'إلغاء شراء'
    return r.ref_type
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ marginRight: 'auto' }}>الموردون</h1>
        <input
          placeholder="🔍 بحث بالاسم أو الهاتف…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px', minWidth: 220 }}
        />
        {canManage ? (
          <button className="btn primary" onClick={() => setForm({ ...emptyForm })}>
            ＋ مورد جديد
          </button>
        ) : null}
      </div>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {rows === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : rows.length === 0 ? (
        <EmptyState icon="🚚" text="لا موردين بعد — أضف موردًا لمتابعة فواتير الشراء والمستحقات وكشف الحساب." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>المورد</th>
              <th>الهاتف</th>
              <th className="num">الرصيد (مستحق للمورد)</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  {s.note ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.note}</div> : null}
                </td>
                <td dir="ltr">{s.phone ?? '—'}</td>
                <td className="num">
                  {s.balance_minor > 0 ? <Badge kind="err" text={money(s.balance_minor)} /> : <Badge kind="ok" text={money(s.balance_minor)} />}
                </td>
                <td>{s.active === 1 ? <Badge kind="ok" text="نشط" /> : <Badge kind="muted" text="معطّل" />}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost small" onClick={() => void openStatement(s)}>
                    كشف حساب
                  </button>{' '}
                  {canPay ? (
                    <>
                      <button className="btn small" onClick={() => { setPayAmount(''); setPayNote(''); setPayFor(s) }}>
                        تسجيل دفعة
                      </button>{' '}
                    </>
                  ) : null}
                  {canManage ? (
                    <button
                      className="btn ghost small"
                      onClick={() =>
                        setForm({ id: s.id, name: s.name, phone: s.phone ?? '', address: s.address ?? '', note: s.note ?? '' })
                      }
                    >
                      تعديل
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form ? (
        <Modal title={form.id === 0 ? 'مورد جديد' : `تعديل: ${form.name}`} onClose={() => setForm(null)}>
          <Field label="اسم المورد *">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <div className="form-row">
            <Field label="الهاتف">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            </Field>
            <Field label="العنوان">
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <Field label="ملاحظة">
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button className="btn ghost" onClick={() => setForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {statement ? (
        <Modal title={`كشف حساب: ${statement.supplier.name}`} onClose={() => setStatement(null)} wide>
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">الرصيد الحالي (مستحق للمورد)</div>
              <div className={`value ${statement.balanceMinor > 0 ? 'err' : 'ok'}`}>{money(statement.balanceMinor)}</div>
            </div>
            <div className="stat">
              <div className="label">عدد القيود</div>
              <div className="value">{statement.rows.length}</div>
            </div>
          </div>
          {statement.rows.length === 0 ? (
            <EmptyState icon="📄" text="لا قيود على هذا المورد بعد." />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th className="num">استحقاق +</th>
                  <th className="num">سداد −</th>
                  <th className="num">الرصيد</th>
                  <th>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {statement.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.created_at)}</td>
                    <td>{refLabel(r)}</td>
                    <td className="num">{r.amount_minor > 0 ? money(r.amount_minor) : '—'}</td>
                    <td className="num">{r.amount_minor < 0 ? money(-r.amount_minor) : '—'}</td>
                    <td className="num">
                      <strong>{money(r.balance_minor)}</strong>
                    </td>
                    <td>{r.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      ) : null}

      {payFor ? (
        <Modal title={`تسجيل دفعة لمورد: ${payFor.name}`} onClose={() => setPayFor(null)}>
          <div className="stat" style={{ marginBottom: 12 }}>
            <div className="label">الرصيد الحالي (مستحق للمورد)</div>
            <div className="value err">{money(payFor.balance_minor ?? 0)}</div>
          </div>
          <Field label="مبلغ الدفعة *" hint="تُخصم من دفتر المورد وتخرج من الصندوق">
            <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus />
          </Field>
          <Field label="ملاحظة">
            <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="اختياري" />
          </Field>
          <button className="btn primary" disabled={busy} onClick={() => void submitPayment()}>
            {busy ? 'جارٍ التسجيل…' : 'تسجيل الدفعة'}
          </button>
        </Modal>
      ) : null}
    </div>
  )
}

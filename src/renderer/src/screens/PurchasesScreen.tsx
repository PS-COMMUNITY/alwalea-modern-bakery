// =============================================================
// مخبز الولاء الحديث — شاشة المشتريات: قائمة + إنشاء + إلغاء + دفعة مورد
// القنوات: purchases.list/get/create/cancel + purchases.payment
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProductRow, SessionUser } from '../../../shared/types'
import { call, money, qty as fmtQ, fmtDateTime } from '../api'
import { toMilli, toMinor } from '../../../shared/money'
import { Field, Modal, Banner, Badge, EmptyState, statusBadge } from '../components/ui'

interface PurchaseListRow {
  id: number
  invoice_no: string
  date: string
  supplier_id: number
  supplier_name: string
  subtotal_minor: number
  discount_minor: number
  total_minor: number
  paid_minor: number
  status: string
  created_at: string
}

interface PurchaseDetail extends PurchaseListRow {
  note: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  items: Array<{
    id: number
    product_id: number
    product_name: string
    qty_milli: number
    unit_cost_minor: number
    line_total_minor: number
  }>
  payments: Array<{ id: number; method: string; amount_minor: number }>
}

interface SupplierLite {
  id: number
  name: string
  active: number
}

interface LineUI {
  productId: string
  qty: string
  cost: string
}

interface CreateForm {
  supplierId: string
  lines: LineUI[]
  paid: string
  note: string
  clientRef: string
}

/** مرجع فريد لمنع الترحيل المزدوج عند النقر المكرر */
function newClientRef(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const emptyLine = (): LineUI => ({ productId: '', qty: '', cost: '' })

export default function PurchasesScreen(props: { user: SessionUser }): ReactNode {
  const [rows, setRows] = useState<PurchaseListRow[] | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // نافذة إنشاء فاتورة
  const [form, setForm] = useState<CreateForm | null>(null)
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([])
  const [products, setProducts] = useState<Array<ProductRow & { balance_milli: number | null }>>([])

  // تفاصيل فاتورة
  const [detail, setDetail] = useState<PurchaseDetail | null>(null)

  // إلغاء فاتورة
  const [cancelFor, setCancelFor] = useState<PurchaseListRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  // دفعة مورد سريعة
  const [payFor, setPayFor] = useState<{ supplierId: number; name: string } | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')

  const canManage = props.user.perms.includes('purchases.manage')
  const canCancel = props.user.perms.includes('purchases.cancel')
  const canPay = props.user.perms.includes('suppliers.pay')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      if (from) payload.from = from
      if (to) payload.to = to
      const data = await call<PurchaseListRow[]>('purchases.list', payload)
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = useCallback((): void => {
    setError('')
    setForm({ supplierId: '', lines: [emptyLine()], paid: '', note: '', clientRef: newClientRef() })
    void (async () => {
      try {
        const [s, p] = await Promise.all([
          call<SupplierLite[]>('suppliers.list', { includeInactive: true }),
          call<Array<ProductRow & { balance_milli: number | null }>>('products.list', { includeInactive: true })
        ])
        setSuppliers(s)
        setProducts(p)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const openDetail = async (id: number): Promise<void> => {
    setError('')
    try {
      setDetail(await call<PurchaseDetail>('purchases.get', { id }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const setLine = (idx: number, patch: Partial<LineUI>): void => {
    setForm((f) => (f ? { ...f, lines: f.lines.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)) } : f))
  }

  /** إجمالي الفاتورة الجديدة (للعرض فقط — الخادم هو مرجع الحساب النهائي) */
  const formTotalMinor = (form?.lines ?? []).reduce((s, ln) => {
    const q = toMilli(ln.qty)
    const c = toMinor(ln.cost)
    if (q === null || c === null) return s
    return s + Math.round((q * c) / 1000)
  }, 0)

  const save = async (): Promise<void> => {
    if (!form) return
    setError('')
    const supplierId = Number(form.supplierId)
    if (!supplierId) {
      setError('اختر المورد أولًا')
      return
    }
    if (form.lines.length === 0) {
      setError('أضف بندًا واحدًا على الأقل')
      return
    }
    const items: Array<{ productId: number; qtyMilli: number; unitCostMinor: number }> = []
    for (let i = 0; i < form.lines.length; i++) {
      const ln = form.lines[i]
      if (!ln) continue
      const productId = Number(ln.productId)
      const qtyMilli = toMilli(ln.qty)
      const unitCostMinor = toMinor(ln.cost)
      if (!productId) {
        setError(`اختر المنتج للبند ${i + 1}`)
        return
      }
      if (qtyMilli === null || qtyMilli <= 0) {
        setError(`كمية غير صحيحة للبند ${i + 1}`)
        return
      }
      if (unitCostMinor === null) {
        setError(`تكلفة الوحدة غير صحيحة للبند ${i + 1}`)
        return
      }
      items.push({ productId, qtyMilli, unitCostMinor })
    }
    const paidMinor = form.paid.trim() === '' ? 0 : toMinor(form.paid)
    if (paidMinor === null) {
      setError('مبلغ المدفوع غير صحيح')
      return
    }
    setBusy(true)
    try {
      const res = await call<PurchaseDetail>('purchases.create', {
        supplierId,
        items,
        paidMinor,
        note: form.note.trim() || null,
        clientRef: form.clientRef
      })
      setForm(null)
      setNotice(`تم إنشاء فاتورة الشراء ${res.invoice_no}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
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
      await call('purchases.cancel', { id: cancelFor.id, reason: cancelReason.trim() })
      setCancelFor(null)
      setCancelReason('')
      setNotice('تم إلغاء فاتورة الشراء وترحيل الحركات العكسية')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitPayment = async (): Promise<void> => {
    if (!payFor) return
    const amountMinor = toMinor(payAmount)
    if (amountMinor === null || amountMinor <= 0) {
      setError('أدخل مبلغ دفعة صحيحًا أكبر من صفر')
      return
    }
    setBusy(true)
    setError('')
    try {
      await call('purchases.payment', { supplierId: payFor.supplierId, amountMinor, note: payNote.trim() || null })
      setPayFor(null)
      setPayAmount('')
      setPayNote('')
      setNotice('تم تسجيل دفعة المورد وخصمها من الصندوق')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const creditMinor = (r: PurchaseListRow): number => r.total_minor - r.paid_minor

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ marginRight: 'auto' }}>المشتريات</h1>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>من تاريخ</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>إلى تاريخ</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {canManage ? (
          <button className="btn primary" onClick={openCreate}>
            ＋ فاتورة شراء
          </button>
        ) : null}
      </div>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {rows === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : rows.length === 0 ? (
        <EmptyState icon="🛒" text="لا فواتير شراء في هذا النطاق — أنشئ أول فاتورة لإدخال المواد للمخزون." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>الفاتورة</th>
              <th>التاريخ</th>
              <th>المورد</th>
              <th className="num">الإجمالي</th>
              <th className="num">المدفوع</th>
              <th className="num">المتبقي</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <button className="btn ghost small" style={{ border: 'none', padding: '2px 4px', fontWeight: 700 }} onClick={() => void openDetail(r.id)}>
                    {r.invoice_no}
                  </button>
                </td>
                <td dir="ltr">{r.date}</td>
                <td>{r.supplier_name}</td>
                <td className="num">{money(r.total_minor)}</td>
                <td className="num">{money(r.paid_minor)}</td>
                <td className="num">{creditMinor(r) > 0 ? <Badge kind="err" text={money(creditMinor(r))} /> : money(0)}</td>
                <td>{statusBadge(r.status)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost small" onClick={() => void openDetail(r.id)}>
                    تفاصيل
                  </button>{' '}
                  {canPay && r.status !== 'CANCELLED' ? (
                    <>
                      {' '}
                      <button
                        className="btn small"
                        onClick={() => {
                          setPayAmount('')
                          setPayNote('')
                          setPayFor({ supplierId: r.supplier_id, name: r.supplier_name })
                        }}
                      >
                        دفعة مورد
                      </button>
                    </>
                  ) : null}{' '}
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

      {form ? (
        <Modal title="فاتورة شراء جديدة" onClose={() => setForm(null)} wide>
          {error ? <Banner kind="error" text={error} /> : null}
          <Field label="المورد *">
            <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} autoFocus>
              <option value="">— اختر موردًا —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                  {s.active === 1 ? '' : ' (معطّل)'}
                </option>
              ))}
            </select>
          </Field>

          <div style={{ margin: '10px 0 4px', fontWeight: 700, color: 'var(--brown-700)', fontSize: 14 }}>بنود الفاتورة</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 36px',
              gap: 8,
              fontSize: 12,
              color: 'var(--muted)',
              marginBottom: 4
            }}
          >
            <div>المنتج</div>
            <div>الكمية (بوحدة المنتج)</div>
            <div>تكلفة الوحدة (₪)</div>
            <div></div>
          </div>
          {form.lines.map((ln, idx) => (
            <div
              key={idx}
              style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 36px', gap: 8, marginBottom: 8, alignItems: 'center' }}
            >
              <select
                value={ln.productId}
                onChange={(e) => {
                  const np = products.find((p) => String(p.id) === e.target.value)
                  setLine(idx, { productId: e.target.value, cost: np ? (np.cost_minor / 100).toFixed(2) : '' })
                }}
              >
                <option value="">— اختر —</option>
                {products.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name} ({p.base_unit})
                  </option>
                ))}
              </select>
              <input
                dir="ltr"
                inputMode="decimal"
                placeholder="0"
                value={ln.qty}
                onChange={(e) => setLine(idx, { qty: e.target.value })}
              />
              <input dir="ltr" inputMode="decimal" placeholder="0.00" value={ln.cost} onChange={(e) => setLine(idx, { cost: e.target.value })} />
              <button
                className="btn danger small"
                disabled={form.lines.length === 1}
                onClick={() => setForm((f) => (f ? { ...f, lines: f.lines.filter((_, i) => i !== idx) } : f))}
                aria-label={`حذف البند ${idx + 1}`}
                title="حذف البند"
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn ghost small" onClick={() => setForm((f) => (f ? { ...f, lines: [...f.lines, emptyLine()] } : f))}>
            ＋ إضافة بند
          </button>

          <div className="form-row" style={{ marginTop: 14 }}>
            <Field label="المدفوع الآن" hint="الباقي يُقيَّد آجلًا على دفتر المورد">
              <input dir="ltr" inputMode="decimal" placeholder="0.00" value={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.value })} />
            </Field>
            <Field label="ملاحظة">
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="اختياري" />
            </Field>
          </div>

          <div className="grid-cards" style={{ marginBottom: 14 }}>
            <div className="stat">
              <div className="label">إجمالي الفاتورة</div>
              <div className="value">{money(formTotalMinor)}</div>
            </div>
            <div className="stat">
              <div className="label">المتبقي بعد الدفع</div>
              <div className={`value ${Math.max(0, formTotalMinor - (toMinor(form.paid) ?? 0)) > 0 ? 'warn' : 'ok'}`}>
                {money(Math.max(0, formTotalMinor - (toMinor(form.paid) ?? 0)))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ الفاتورة'}
            </button>
            <button className="btn ghost" onClick={() => setForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {detail ? (
        <Modal title={`فاتورة شراء: ${detail.invoice_no}`} onClose={() => setDetail(null)} wide>
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">المورد</div>
              <div className="value" style={{ fontSize: 16 }}>{detail.supplier_name}</div>
            </div>
            <div className="stat">
              <div className="label">الإجمالي</div>
              <div className="value">{money(detail.total_minor)}</div>
            </div>
            <div className="stat">
              <div className="label">المدفوع</div>
              <div className="value ok">{money(detail.paid_minor)}</div>
            </div>
            <div className="stat">
              <div className="label">الحالة</div>
              <div className="value" style={{ fontSize: 16 }}>{statusBadge(detail.status)}</div>
            </div>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 10px' }}>
            تاريخ الفاتورة: <span dir="ltr">{detail.date}</span> — سُجّلت: {fmtDateTime(detail.created_at)}
            {detail.note ? ` — ملاحظة: ${detail.note}` : ''}
          </p>
          {detail.cancel_reason ? (
            <Banner kind="error" text={`سبب الإلغاء: ${detail.cancel_reason}${detail.cancelled_at ? ` (${fmtDateTime(detail.cancelled_at)})` : ''}`} />
          ) : null}
          {detail.items.length === 0 ? (
            <EmptyState icon="📄" text="لا بنود في هذه الفاتورة." />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th className="num">الكمية</th>
                  <th className="num">تكلفة الوحدة</th>
                  <th className="num">إجمالي السطر</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product_name}</td>
                    <td className="num">{fmtQ(it.qty_milli)}</td>
                    <td className="num">{money(it.unit_cost_minor)}</td>
                    <td className="num">{money(it.line_total_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {detail.payments.length > 0 ? (
            <>
              <h3 style={{ marginTop: 14 }}>الدفعات</h3>
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
                      <td>{p.method === 'CASH' ? 'نقدًا' : p.method}</td>
                      <td className="num">{money(p.amount_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </Modal>
      ) : null}

      {cancelFor ? (
        <Modal title={`إلغاء فاتورة: ${cancelFor.invoice_no}`} onClose={() => setCancelFor(null)}>
          <Banner kind="error" text="الإلغاء عكسي وموثق: تُرد الكميات للمخزون، يُخصم إجمالي الفاتورة من دفتر المورد، ويُعاد المدفوع للصندوق." />
          <Field label="سبب الإلغاء *" hint="يُوثق في سجل التدقيق — 3 أحرف على الأقل">
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="مثال: خطأ في الفاتورة / تلف المواد الموردة"
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

      {payFor ? (
        <Modal title={`دفعة لمورد: ${payFor.name}`} onClose={() => setPayFor(null)}>
          <Field label="مبلغ الدفعة *" hint="تُخصم من دفتر المورد ومن الصندوق">
            <input dir="ltr" inputMode="decimal" placeholder="0.00" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
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

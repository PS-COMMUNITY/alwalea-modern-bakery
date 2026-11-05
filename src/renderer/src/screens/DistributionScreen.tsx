// =============================================================
// مخبز الولاء الحديث — شاشة التوزيع: مندوبون وخطوط وجولات
// القنوات: distribution.reps.* + distribution.routes.* + distribution.trips.*
// الجولة المفتوحة: تحميل/بيع/مرتجعات — التسوية ترحل الفواتير والنقد والآجل
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionUser } from '../../../shared/types'
import { call, money, qty as fmtQ, fmtDateTime } from '../api'
import { toMilli, toMinor } from '../../../shared/money'
import { Field, Modal, Banner, Badge, EmptyState, statusBadge } from '../components/ui'

interface RepRow {
  id: number
  name: string
  phone: string | null
  active: number
}

interface RouteRow {
  id: number
  name: string
  note: string | null
  active: number
}

interface TripListRow {
  id: number
  trip_no: string
  date: string
  status: string
  rep_id: number
  rep_name: string
  route_id: number | null
  route_name: string | null
  loaded_milli: number
  settled_at: string | null
  created_at: string
}

interface TripDetail {
  id: number
  trip_no: string
  rep_id: number
  route_id: number | null
  date: string
  status: string
  notes: string | null
  settle_notes: string | null
  created_at: string
  settled_at: string | null
  rep_name: string | null
  route_name: string | null
  loads: Array<{ product_id: number; product_name: string; qty_milli: number }>
  sales: Array<{
    id: number
    product_id: number
    product_name: string
    qty_milli: number
    unit_price_minor: number
    payment_type: string
    customer_id: number | null
    customer_name: string | null
    sale_id: number | null
    created_at: string
  }>
  returns: Array<{ id: number; product_id: number; product_name: string; qty_milli: number; condition: string; note: string | null }>
  vanStock: Array<{ productId: number; loaded: number; sold: number; returned: number; onVan: number }>
  cashTotalMinor: number
  creditTotalMinor: number
}

interface ProductLite {
  id: number
  name: string
  base_unit: string
  price_minor: number
  track_stock: number
  active: number
}

interface CustomerLite {
  id: number
  name: string
  active: number
}

/** تاريخ اليوم بصيغة YYYY-MM-DD */
function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function DistributionScreen(props: { user: SessionUser }): ReactNode {
  const [reps, setReps] = useState<RepRow[] | null>(null)
  const [routes, setRoutes] = useState<RouteRow[] | null>(null)
  const [trips, setTrips] = useState<TripListRow[] | null>(null)
  const [products, setProducts] = useState<ProductLite[]>([])
  const [customers, setCustomers] = useState<CustomerLite[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // نوافذ المندوبين والخطوط والجولات
  const [repForm, setRepForm] = useState<{ name: string; phone: string } | null>(null)
  const [routeForm, setRouteForm] = useState<{ name: string; note: string } | null>(null)
  const [tripForm, setTripForm] = useState<{ repId: string; routeId: string; date: string; notes: string } | null>(null)

  // تفاصيل الجولة + النماذج داخلها
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [loadForm, setLoadForm] = useState<{ productId: string; qty: string }>({ productId: '', qty: '' })
  const [saleForm, setSaleForm] = useState<{ productId: string; qty: string; price: string; payType: 'CASH' | 'CREDIT'; customerId: string }>({
    productId: '',
    qty: '',
    price: '',
    payType: 'CASH',
    customerId: ''
  })
  const [returnForm, setReturnForm] = useState<{ productId: string; qty: string; condition: 'GOOD' | 'DAMAGED'; note: string }>({
    productId: '',
    qty: '',
    condition: 'GOOD',
    note: ''
  })

  // التسوية والإلغاء
  const [settleFor, setSettleFor] = useState<TripDetail | null>(null)
  const [settleCounted, setSettleCounted] = useState('')
  const [settleNotes, setSettleNotes] = useState('')
  const [cancelFor, setCancelFor] = useState<TripListRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const canManage = props.user.perms.includes('distribution.manage')

  const deleteRep = async (r: { id: number; name: string }): Promise<void> => {
    if (!window.confirm(`حذف المندوب «${r.name}» نهائيًا؟ الحذف مسموح فقط لمندوب بلا جولات موثقة.`)) return
    setError('')
    try {
      await call('distribution.reps.delete', { id: r.id })
      setNotice(`تم حذف المندوب «${r.name}»`)
      const repsList = await call<Array<{ id: number; name: string; phone: string | null; active: number }>>('distribution.reps.list', {})
      setReps(repsList)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteRoute = async (r: { id: number; name: string }): Promise<void> => {
    if (!window.confirm(`حذف خط التوزيع «${r.name}» نهائيًا؟ الحذف مسموح فقط لخط بلا جولات موثقة.`)) return
    setError('')
    try {
      await call('distribution.routes.delete', { id: r.id })
      setNotice(`تم حذف الخط «${r.name}»`)
      const routesList = await call<Array<{ id: number; name: string; note: string | null; active: number }>>('distribution.routes.list', {})
      setRoutes(routesList)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const tripsPayload: Record<string, unknown> = {}
      if (statusFilter) tripsPayload.status = statusFilter
      const [r, rt, t, p, c] = await Promise.all([
        call<RepRow[]>('distribution.reps.list', { includeInactive: true }),
        call<RouteRow[]>('distribution.routes.list', { includeInactive: true }),
        call<TripListRow[]>('distribution.trips.list', tripsPayload),
        call<ProductLite[]>('products.list', { includeInactive: true }),
        call<CustomerLite[]>('customers.list', { includeInactive: true })
      ])
      setReps(r)
      setRoutes(rt)
      setTrips(t)
      setProducts(p)
      setCustomers(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = useCallback(async (id: number): Promise<void> => {
    setError('')
    try {
      const d = await call<TripDetail>('distribution.trips.get', { id })
      setDetail(d)
      setLoadForm({ productId: '', qty: '' })
      setSaleForm({ productId: '', qty: '', price: '', payType: 'CASH', customerId: '' })
      setReturnForm({ productId: '', qty: '', condition: 'GOOD', note: '' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshDetail = async (id: number): Promise<void> => {
    const d = await call<TripDetail>('distribution.trips.get', { id })
    setDetail(d)
  }

  // ---------- مندوب / خط / جولة ----------
  const saveRep = async (): Promise<void> => {
    if (!repForm) return
    if (!repForm.name.trim()) {
      setError('اسم المندوب مطلوب')
      return
    }
    setBusy(true)
    setError('')
    try {
      await call('distribution.reps.create', { name: repForm.name.trim(), phone: repForm.phone.trim() || null })
      setRepForm(null)
      setNotice('تمت إضافة المندوب')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveRoute = async (): Promise<void> => {
    if (!routeForm) return
    if (!routeForm.name.trim()) {
      setError('اسم الخط مطلوب')
      return
    }
    setBusy(true)
    setError('')
    try {
      await call('distribution.routes.create', { name: routeForm.name.trim(), note: routeForm.note.trim() || null })
      setRouteForm(null)
      setNotice('تمت إضافة الخط')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveTrip = async (): Promise<void> => {
    if (!tripForm) return
    setError('')
    const repId = Number(tripForm.repId)
    if (!repId) {
      setError('اختر المندوب')
      return
    }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { repId, notes: tripForm.notes.trim() || null }
      if (tripForm.routeId) payload.routeId = Number(tripForm.routeId)
      if (tripForm.date) payload.date = tripForm.date
      const res = await call<TripDetail>('distribution.trips.create', payload)
      setTripForm(null)
      setNotice(`تم فتح الجولة ${res.trip_no} — حمّل المنتجات ثم سجّل البيع والمرتجعات`)
      await load()
      await openDetail(res.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // ---------- عمليات داخل الجولة ----------
  const submitLoad = async (): Promise<void> => {
    if (!detail) return
    setError('')
    const productId = Number(loadForm.productId)
    const qtyMilli = toMilli(loadForm.qty)
    if (!productId) {
      setError('اختر المنتج للتحميل')
      return
    }
    if (qtyMilli === null || qtyMilli <= 0) {
      setError('كمية التحميل يجب أن تكون أكبر من صفر')
      return
    }
    setBusy(true)
    try {
      await call('distribution.trips.load', { tripId: detail.id, productId, qtyMilli })
      setLoadForm({ productId: '', qty: '' })
      setNotice('تم تحميل المنتج على عربة الجولة')
      await refreshDetail(detail.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitSale = async (): Promise<void> => {
    if (!detail) return
    setError('')
    const productId = Number(saleForm.productId)
    const qtyMilli = toMilli(saleForm.qty)
    const unitPriceMinor = toMinor(saleForm.price)
    if (!productId) {
      setError('اختر المنتج المبيع')
      return
    }
    if (qtyMilli === null || qtyMilli <= 0) {
      setError('كمية البيع يجب أن تكون أكبر من صفر')
      return
    }
    if (unitPriceMinor === null) {
      setError('سعر الوحدة غير صحيح')
      return
    }
    if (saleForm.payType === 'CREDIT' && !saleForm.customerId) {
      setError('البيع الآجل يتطلب تحديد العميل')
      return
    }
    setBusy(true)
    try {
      await call('distribution.trips.sale', {
        tripId: detail.id,
        items: [
          {
            productId,
            qtyMilli,
            unitPriceMinor,
            paymentType: saleForm.payType,
            customerId: saleForm.payType === 'CREDIT' ? Number(saleForm.customerId) : null
          }
        ]
      })
      setSaleForm({ productId: '', qty: '', price: '', payType: saleForm.payType, customerId: '' })
      setNotice('سُجّل البيع على الجولة — يُرحّل عند التسوية')
      await refreshDetail(detail.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitReturn = async (): Promise<void> => {
    if (!detail) return
    setError('')
    const productId = Number(returnForm.productId)
    const qtyMilli = toMilli(returnForm.qty)
    if (!productId) {
      setError('اختر منتج المرتجع')
      return
    }
    if (qtyMilli === null || qtyMilli <= 0) {
      setError('كمية المرتجع يجب أن تكون أكبر من صفر')
      return
    }
    setBusy(true)
    try {
      await call('distribution.trips.return', {
        tripId: detail.id,
        items: [{ productId, qtyMilli, condition: returnForm.condition, note: returnForm.note.trim() || null }]
      })
      setReturnForm({ productId: '', qty: '', condition: 'GOOD', note: '' })
      setNotice(returnForm.condition === 'GOOD' ? 'أُعيدت الكمية للمخزون (سليمة)' : 'وُثق المرتجع التالف كهالك بعد إعادته للمخزون')
      await refreshDetail(detail.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitSettle = async (): Promise<void> => {
    if (!settleFor) return
    setError('')
    const countedMinor = settleCounted.trim() === '' ? null : toMinor(settleCounted)
    if (settleCounted.trim() !== '' && countedMinor === null) {
      setError('النقد المجرود غير صحيح')
      return
    }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { tripId: settleFor.id }
      if (countedMinor !== null) payload.countedCashMinor = countedMinor
      if (settleNotes.trim()) payload.notes = settleNotes.trim()
      await call('distribution.trips.settle', payload)
      const no = settleFor.trip_no
      setSettleFor(null)
      setSettleCounted('')
      setSettleNotes('')
      setNotice(`سُوّت الجولة ${no}: رُحّلت فواتير البيع ودخل النقد للصندوق وقُيّد الآجل على دفتر العملاء`)
      await load()
      await openDetail(settleFor.id)
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
      await call('distribution.trips.cancel', { id: cancelFor.id, reason: cancelReason.trim() })
      setCancelFor(null)
      setCancelReason('')
      setNotice('أُلغيت الجولة ورُد تحميلها للمخزون')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onSaleProductChange = (pid: string): void => {
    const p = products.find((x) => String(x.id) === pid)
    setSaleForm((f) => ({ ...f, productId: pid, price: p ? (p.price_minor / 100).toFixed(2) : f.price }))
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ marginRight: 'auto' }}>التوزيع (الجولات)</h1>
        {canManage ? (
          <>
            <button className="btn ghost" onClick={() => setRepForm({ name: '', phone: '' })}>
              ＋ مندوب
            </button>
            <button className="btn ghost" onClick={() => setRouteForm({ name: '', note: '' })}>
              ＋ خط توزيع
            </button>
            <button className="btn primary" onClick={() => setTripForm({ repId: '', routeId: '', date: today(), notes: '' })}>
              ＋ جولة جديدة
            </button>
          </>
        ) : null}
      </div>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {/* ================= المندوبون والخطوط ================= */}
      <div className="grid-cards" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card" style={{ padding: 14 }}>
          <h3>🛵 المندوبون</h3>
          {reps === null ? (
            <EmptyState icon="⏳" text="جارٍ التحميل…" />
          ) : reps.length === 0 ? (
            <EmptyState icon="🛵" text="لا مندوبين بعد." />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الهاتف</th>
                  <th>الحالة</th>
                  {canManage ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td dir="ltr">{r.phone ?? '—'}</td>
                    <td>{r.active === 1 ? <Badge kind="ok" text="نشط" /> : <Badge kind="muted" text="معطّل" />}</td>
                    {canManage ? (
                      <td>
                        <button className="btn danger small" onClick={() => void deleteRep(r)} title="حذف نهائي (لمن بلا جولات)">
                          حذف
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card" style={{ padding: 14 }}>
          <h3>🗺️ خطوط التوزيع</h3>
          {routes === null ? (
            <EmptyState icon="⏳" text="جارٍ التحميل…" />
          ) : routes.length === 0 ? (
            <EmptyState icon="🗺️" text="لا خطوط بعد." />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>الخط</th>
                  <th>ملاحظة</th>
                  <th>الحالة</th>
                  {canManage ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.note ?? '—'}</td>
                    <td>{r.active === 1 ? <Badge kind="ok" text="نشط" /> : <Badge kind="muted" text="معطّل" />}</td>
                    {canManage ? (
                      <td>
                        <button className="btn danger small" onClick={() => void deleteRoute(r)} title="حذف نهائي (لمن بلا جولات)">
                          حذف
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ================= الجولات ================= */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ marginRight: 'auto' }}>🚚 الجولات</h2>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>الحالة</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">الكل</option>
            <option value="OPEN">مفتوحة</option>
            <option value="SETTLED">مسواة</option>
            <option value="CANCELLED">ملغاة</option>
          </select>
        </div>
      </div>
      {trips === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : trips.length === 0 ? (
        <EmptyState icon="🚚" text="لا جولات مطابقة — افتح جولة: اختر مندوبًا وحمّل المنتجات على العربة." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>الجولة</th>
              <th>التاريخ</th>
              <th>المندوب</th>
              <th>الخط</th>
              <th className="num">المحمّل</th>
              <th>الحالة</th>
              <th>سُوّت في</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.trip_no}</strong>
                </td>
                <td dir="ltr">{t.date}</td>
                <td>{t.rep_name}</td>
                <td>{t.route_name ?? '—'}</td>
                <td className="num">{fmtQ(t.loaded_milli)}</td>
                <td>{statusBadge(t.status)}</td>
                <td>{t.settled_at ? fmtDateTime(t.settled_at) : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost small" onClick={() => void openDetail(t.id)}>
                    تفاصيل
                  </button>{' '}
                  {canManage && t.status === 'OPEN' ? (
                    <button
                      className="btn danger small"
                      disabled={busy}
                      onClick={() => {
                        setCancelReason('')
                        setCancelFor(t)
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

      {/* ================= نافذة مندوب ================= */}
      {repForm ? (
        <Modal title="مندوب جديد" onClose={() => setRepForm(null)}>
          <Field label="اسم المندوب *">
            <input value={repForm.name} onChange={(e) => setRepForm({ ...repForm, name: e.target.value })} autoFocus />
          </Field>
          <Field label="الهاتف">
            <input dir="ltr" value={repForm.phone} onChange={(e) => setRepForm({ ...repForm, phone: e.target.value })} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void saveRep()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button className="btn ghost" onClick={() => setRepForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ================= نافذة خط ================= */}
      {routeForm ? (
        <Modal title="خط توزيع جديد" onClose={() => setRouteForm(null)}>
          <Field label="اسم الخط *">
            <input value={routeForm.name} onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })} autoFocus />
          </Field>
          <Field label="ملاحظة">
            <input value={routeForm.note} onChange={(e) => setRouteForm({ ...routeForm, note: e.target.value })} placeholder="اختياري — الأحياء أو المنطقة" />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void saveRoute()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button className="btn ghost" onClick={() => setRouteForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ================= نافذة جولة جديدة ================= */}
      {tripForm ? (
        <Modal title="جولة توزيع جديدة" onClose={() => setTripForm(null)}>
          <div className="form-row">
            <Field label="المندوب *">
              <select value={tripForm.repId} onChange={(e) => setTripForm({ ...tripForm, repId: e.target.value })} autoFocus>
                <option value="">— اختر —</option>
                {(reps ?? [])
                  .filter((r) => r.active === 1)
                  .map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="الخط">
              <select value={tripForm.routeId} onChange={(e) => setTripForm({ ...tripForm, routeId: e.target.value })}>
                <option value="">— بلا خط —</option>
                {(routes ?? [])
                  .filter((r) => r.active === 1)
                  .map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label="التاريخ">
              <input type="date" value={tripForm.date} onChange={(e) => setTripForm({ ...tripForm, date: e.target.value })} />
            </Field>
            <Field label="ملاحظات">
              <input value={tripForm.notes} onChange={(e) => setTripForm({ ...tripForm, notes: e.target.value })} placeholder="اختياري" />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void saveTrip()}>
              {busy ? 'جارٍ الحفظ…' : 'فتح الجولة'}
            </button>
            <button className="btn ghost" onClick={() => setTripForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ================= نافذة تفاصيل الجولة ================= */}
      {detail ? (
        <Modal title={`الجولة ${detail.trip_no} — ${detail.rep_name ?? ''}${detail.route_name ? ` (${detail.route_name})` : ''}`} onClose={() => setDetail(null)} wide>
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">الحالة</div>
              <div className="value" style={{ fontSize: 16 }}>{statusBadge(detail.status)}</div>
            </div>
            <div className="stat">
              <div className="label">التاريخ</div>
              <div className="value" style={{ fontSize: 16 }} dir="ltr">{detail.date}</div>
            </div>
            <div className="stat">
              <div className="label">نقد الجولة</div>
              <div className="value ok">{money(detail.cashTotalMinor)}</div>
            </div>
            <div className="stat">
              <div className="label">آجل الجولة</div>
              <div className="value err">{money(detail.creditTotalMinor)}</div>
            </div>
          </div>
          {detail.notes ? <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>ملاحظات: {detail.notes}</p> : null}
          {detail.settle_notes ? <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>ملاحظات التسوية: {detail.settle_notes}</p> : null}

          {detail.status !== 'OPEN' ? <Banner kind="ok" text="هذه الجولة غير مفتوحة — للعرض فقط." /> : null}

          {/* المتبقي في العربة */}
          <h3>🧮 المتبقي في العربة</h3>
          {detail.vanStock.length === 0 ? (
            <EmptyState icon="🚚" text="لم يُحمّل شيء على العربة بعد." />
          ) : (
            <table className="data" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th className="num">محمّل</th>
                  <th className="num">مباع</th>
                  <th className="num">مرتجع</th>
                  <th className="num">المتبقي</th>
                </tr>
              </thead>
              <tbody>
                {detail.vanStock.map((v) => (
                  <tr key={v.productId}>
                    <td>{products.find((p) => p.id === v.productId)?.name ?? `#${v.productId}`}</td>
                    <td className="num">{fmtQ(v.loaded)}</td>
                    <td className="num">{fmtQ(v.sold)}</td>
                    <td className="num">{fmtQ(v.returned)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmtQ(v.onVan)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* التحميل */}
          <h3>📦 التحميل</h3>
          {detail.loads.length === 0 ? (
            <EmptyState icon="📦" text="لا تحميل بعد." />
          ) : (
            <table className="data" style={{ marginBottom: 8 }}>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th className="num">الكمية</th>
                </tr>
              </thead>
              <tbody>
                {detail.loads.map((l, idx) => (
                  <tr key={`${l.product_id}-${idx}`}>
                    <td>{l.product_name}</td>
                    <td className="num">{fmtQ(l.qty_milli)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {detail.status === 'OPEN' && canManage ? (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8, marginBottom: 18, alignItems: 'center' }}>
              <select value={loadForm.productId} onChange={(e) => setLoadForm({ ...loadForm, productId: e.target.value })} aria-label="منتج للتحميل">
                <option value="">— منتج للتحميل —</option>
                {products
                  .filter((p) => p.track_stock === 1 && p.active === 1)
                  .map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({p.base_unit})
                    </option>
                  ))}
              </select>
              <input
                dir="ltr"
                inputMode="decimal"
                placeholder="الكمية"
                value={loadForm.qty}
                onChange={(e) => setLoadForm({ ...loadForm, qty: e.target.value })}
                aria-label="كمية التحميل"
              />
              <button className="btn primary" disabled={busy} onClick={() => void submitLoad()}>
                تحميل
              </button>
            </div>
          ) : null}

          {/* المبيعات */}
          <h3>🧾 مبيعات الجولة</h3>
          {detail.sales.length === 0 ? (
            <EmptyState icon="🧾" text="لا مبيعات مسجلة على الجولة بعد." />
          ) : (
            <table className="data" style={{ marginBottom: 8 }}>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th className="num">الكمية</th>
                  <th className="num">سعر الوحدة</th>
                  <th className="num">الإجمالي</th>
                  <th>الدفع</th>
                  <th>العميل</th>
                  <th>الفاتورة</th>
                </tr>
              </thead>
              <tbody>
                {detail.sales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.product_name}</td>
                    <td className="num">{fmtQ(s.qty_milli)}</td>
                    <td className="num">{money(s.unit_price_minor)}</td>
                    <td className="num">{money(Math.round((s.qty_milli * s.unit_price_minor) / 1000))}</td>
                    <td>{s.payment_type === 'CASH' ? <Badge kind="ok" text="نقدي" /> : <Badge kind="err" text="آجل" />}</td>
                    <td>{s.customer_name ?? '—'}</td>
                    <td>{s.sale_id ? `#${s.sale_id}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {detail.status === 'OPEN' && canManage ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select value={saleForm.productId} onChange={(e) => onSaleProductChange(e.target.value)} aria-label="منتج مبيع">
                  <option value="">— منتج مبيع —</option>
                  {products
                    .filter((p) => p.active === 1)
                    .map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name} ({p.base_unit})
                      </option>
                    ))}
                </select>
                <input
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="الكمية"
                  value={saleForm.qty}
                  onChange={(e) => setSaleForm({ ...saleForm, qty: e.target.value })}
                  aria-label="كمية البيع"
                />
                <input
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="سعر الوحدة ₪"
                  value={saleForm.price}
                  onChange={(e) => setSaleForm({ ...saleForm, price: e.target.value })}
                  aria-label="سعر الوحدة"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 2fr auto', gap: 8, marginBottom: 18, alignItems: 'center' }}>
                <div className="pay-toggle" style={{ margin: 0 }}>
                  <button className={saleForm.payType === 'CASH' ? 'sel' : ''} onClick={() => setSaleForm({ ...saleForm, payType: 'CASH' })}>
                    نقدي
                  </button>
                  <button className={saleForm.payType === 'CREDIT' ? 'sel' : ''} onClick={() => setSaleForm({ ...saleForm, payType: 'CREDIT' })}>
                    آجل
                  </button>
                </div>
                <select
                  value={saleForm.customerId}
                  onChange={(e) => setSaleForm({ ...saleForm, customerId: e.target.value })}
                  disabled={saleForm.payType === 'CASH'}
                  aria-label="العميل للآجل"
                >
                  <option value="">— العميل (للآجل) —</option>
                  {customers
                    .filter((c) => c.active === 1)
                    .map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <button className="btn primary" disabled={busy} onClick={() => void submitSale()}>
                  تسجيل بيع
                </button>
              </div>
            </>
          ) : null}

          {/* المرتجعات */}
          <h3>↩️ المرتجعات</h3>
          {detail.returns.length === 0 ? (
            <EmptyState icon="↩️" text="لا مرتجعات على الجولة بعد." />
          ) : (
            <table className="data" style={{ marginBottom: 8 }}>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th className="num">الكمية</th>
                  <th>الحالة</th>
                  <th>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {detail.returns.map((r) => (
                  <tr key={r.id}>
                    <td>{r.product_name}</td>
                    <td className="num">{fmtQ(r.qty_milli)}</td>
                    <td>{r.condition === 'GOOD' ? <Badge kind="ok" text="سليمة" /> : <Badge kind="err" text="تالفة" />}</td>
                    <td>{r.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {detail.status === 'OPEN' && canManage ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select
                  value={returnForm.productId}
                  onChange={(e) => setReturnForm({ ...returnForm, productId: e.target.value })}
                  aria-label="منتج مرتجع"
                >
                  <option value="">— منتج مرتجع —</option>
                  {detail.vanStock
                    .filter((v) => v.onVan > 0)
                    .map((v) => {
                      const p = products.find((x) => x.id === v.productId)
                      return (
                        <option key={v.productId} value={String(v.productId)}>
                          {p ? p.name : `#${v.productId}`} (متبقي {fmtQ(v.onVan)})
                        </option>
                      )
                    })}
                </select>
                <input
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="الكمية"
                  value={returnForm.qty}
                  onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })}
                  aria-label="كمية المرتجع"
                />
                <select
                  value={returnForm.condition}
                  onChange={(e) => setReturnForm({ ...returnForm, condition: e.target.value === 'DAMAGED' ? 'DAMAGED' : 'GOOD' })}
                  aria-label="حالة المرتجع"
                >
                  <option value="GOOD">سليمة (تعود للمخزون)</option>
                  <option value="DAMAGED">تالفة (توثق كهالك)</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr auto', gap: 8, marginBottom: 18, alignItems: 'center' }}>
                <input
                  value={returnForm.note}
                  onChange={(e) => setReturnForm({ ...returnForm, note: e.target.value })}
                  placeholder="ملاحظة (اختياري)"
                  aria-label="ملاحظة المرتجع"
                />
                <button className="btn primary" disabled={busy} onClick={() => void submitReturn()}>
                  تسجيل مرتجع
                </button>
              </div>
            </>
          ) : null}

          {/* التسوية */}
          {detail.status === 'OPEN' && canManage ? (
            <div style={{ borderTop: '2px solid var(--brown-100)', paddingTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  setSettleCounted('')
                  setSettleNotes('')
                  setSettleFor(detail)
                }}
              >
                ✅ تسوية الجولة وترحيل الفواتير
              </button>
              <span style={{ color: 'var(--muted)', fontSize: 13, alignSelf: 'center' }}>
                المتوقع نقدًا: {money(detail.cashTotalMinor)} — آجل: {money(detail.creditTotalMinor)}
              </span>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {/* ================= نافذة التسوية ================= */}
      {settleFor ? (
        <Modal title={`تسوية الجولة ${settleFor.trip_no}`} onClose={() => setSettleFor(null)}>
          <Banner
            kind="error"
            text="التسوية نهائية: تُرحّل مبيعات الجولة كفواتير بيع، يدخل النقد للصندوق، ويُقيَّد الآجل على دفتر العملاء — لا يمكن التكرار."
          />
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">النقد المتوقع (حسب مبيعات الجولة)</div>
              <div className="value warn">{money(settleFor.cashTotalMinor)}</div>
            </div>
            <div className="stat">
              <div className="label">الآجل المرحّل للعملاء</div>
              <div className="value err">{money(settleFor.creditTotalMinor)}</div>
            </div>
          </div>
          <Field label="النقد المجرود فعليًا" hint="اتركه فارغًا إذا جرودت كامل النقد المتوقع — أي فرق يُوثق كتسوية">
            <input dir="ltr" inputMode="decimal" placeholder={String(settleFor.cashTotalMinor / 100)} value={settleCounted} onChange={(e) => setSettleCounted(e.target.value)} autoFocus />
          </Field>
          <Field label="ملاحظات التسوية">
            <input value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)} placeholder="اختياري" />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void submitSettle()}>
              {busy ? 'جارٍ الترحيل…' : 'تأكيد التسوية'}
            </button>
            <button className="btn ghost" onClick={() => setSettleFor(null)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ================= نافذة إلغاء جولة ================= */}
      {cancelFor ? (
        <Modal title={`إلغاء جولة: ${cancelFor.trip_no}`} onClose={() => setCancelFor(null)}>
          <Banner kind="error" text="الإلغاء متاح للجولة المفتوحة الخالية من البيع/المرتجعات — يُرد التحميل كاملًا للمخزون." />
          <Field label="سبب الإلغاء *" hint="يُوثق في سجل التدقيق — 3 أحرف على الأقل">
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="مثال: تعطل العربة / لم ينطلق المندوب"
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

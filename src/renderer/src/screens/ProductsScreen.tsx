// =============================================================
// مخبز الولاء الحديث — شاشة المنتجات: بحث/إضافة/تعديل/تعطيل
// rc.12-merge: + مدير الفئات (إضافة/تعديل/حذف آمن بفحص المراجع) منقول من local —
//              مع إبقاء ميزات target كاملة (ملصقات الباركود + حذف المنتج الآمن)
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CategoryRow, ProductRow, SessionUser } from '../../../shared/types'
import { call, money, qty as fmtQ } from '../api'
import { Field, Modal, Banner, Badge, EmptyState, statusBadge, ConfirmModal } from '../components/ui'
import LabelsModal from '../labels'

interface ProductUI extends ProductRow {
  balance_milli: number | null
}

const emptyForm = {
  id: 0,
  name: '',
  sku: '',
  category_id: '' as string | number,
  type: 'FINISHED',
  base_unit: 'قطعة',
  price: '',
  cost: '',
  min_stock: '',
  track_stock: true,
  active: true
}
type FormState = typeof emptyForm

function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

export default function ProductsScreen(props: { user: SessionUser }): ReactNode {
  // rc.12-merge: صلاحية إدارة الفئات — تُخفي لوحة الفئات عن من لا يملكها (القناة نفسها مفروضة في الخلفية)
  const canManageCats = props.user.perms.includes('categories.manage')
  const [rows, setRows] = useState<ProductUI[]>([])
  const [cats, setCats] = useState<CategoryRow[]>([])
  const [q, setQ] = useState('')
  const [includeInactive, setIncludeInactive] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)

  // ===== rc.12-merge: إدارة الفئات — إضافة/تعديل/حذف آمن بفحص المراجع (من local) =====
  const [catsOpen, setCatsOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [catEdit, setCatEdit] = useState<{ id: number; name: string } | null>(null)
  const [catDeleteFor, setCatDeleteFor] = useState<CategoryRow | null>(null)
  const [catBusy, setCatBusy] = useState(false)
  const [catError, setCatError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [p, c] = await Promise.all([
        call<ProductUI[]>('products.list', { q, includeInactive }),
        call<CategoryRow[]>('categories.list', { includeInactive: true })
      ])
      setRows(p)
      setCats(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [q, includeInactive])

  useEffect(() => {
    void load()
  }, [load])

  const openNew = (): FormState => ({ ...emptyForm })
  const openEdit = (p: ProductUI): FormState => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? '',
    category_id: p.category_id ?? '',
    type: p.type,
    base_unit: p.base_unit,
    price: (p.price_minor / 100).toFixed(2),
    cost: (p.cost_minor / 100).toFixed(2),
    min_stock: p.min_stock_milli === 0 ? '' : String(p.min_stock_milli / 1000),
    track_stock: p.track_stock === 1,
    active: p.active === 1
  })

  const save = async (): Promise<void> => {
    if (!form) return
    setError('')
    const priceMinor = parseNum(form.price)
    const costMinor = parseNum(form.cost)
    const minMilli = parseNum(form.min_stock)
    if (!form.name.trim()) {
      setError('اسم المنتج مطلوب')
      return
    }
    if (priceMinor === null) {
      setError('سعر البيع مطلوب')
      return
    }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        categoryId: form.category_id === '' ? null : Number(form.category_id),
        type: form.type,
        baseUnit: form.base_unit.trim() || 'قطعة',
        priceMinor: Math.round(priceMinor * 100),
        costMinor: costMinor === null ? 0 : Math.round(costMinor * 100),
        minStockMilli: minMilli === null ? 0 : Math.round(minMilli * 1000),
        trackStock: form.track_stock,
        active: form.active
      }
      if (form.id === 0) await call('products.create', payload)
      else await call('products.update', { id: form.id, ...payload })
      setForm(null)
      setNotice(form.id === 0 ? 'تمت إضافة المنتج' : 'تم تحديث المنتج')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteProduct = async (p: ProductUI): Promise<void> => {
    if (!window.confirm(`حذف المنتج «${p.name}» نهائيًا؟\n\nالحذف مسموح فقط لمنتج بلا أي حركات (بيع/شراء/إنتاج/جرد) — إن كان له أثر سيُرفض ويُقترح التعطيل.`)) return
    setBusy(true)
    setError('')
    try {
      await call('products.delete', { id: p.id })
      setNotice(`تم حذف المنتج «${p.name}»`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (p: ProductUI): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await call('products.update', { id: p.id, active: p.active !== 1 })
      setNotice(p.active === 1 ? `تم تعطيل «${p.name}»` : `تم تنشيط «${p.name}»`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // ===== rc.12-merge: إدارة الفئات — إضافة/تعديل/حذف آمن (من local) =====
  const saveNewCat = async (): Promise<void> => {
    const name = newCatName.trim()
    if (!name) return
    setCatBusy(true)
    setCatError('')
    try {
      await call('categories.create', { name })
      setNewCatName('')
      setNotice(`تمت إضافة الفئة «${name}»`)
      await load()
    } catch (e) {
      setCatError(e instanceof Error ? e.message : String(e))
    } finally {
      setCatBusy(false)
    }
  }

  const saveCatEdit = async (): Promise<void> => {
    if (!catEdit) return
    const name = catEdit.name.trim()
    if (!name) return
    setCatBusy(true)
    setCatError('')
    try {
      await call('categories.update', { id: catEdit.id, name })
      setCatEdit(null)
      setNotice('تم حفظ الفئة')
      await load()
    } catch (e) {
      setCatError(e instanceof Error ? e.message : String(e))
    } finally {
      setCatBusy(false)
    }
  }

  const deleteCat = async (): Promise<void> => {
    if (!catDeleteFor) return
    setCatBusy(true)
    setCatError('')
    try {
      await call('categories.delete', { id: catDeleteFor.id })
      setNotice(`تم حذف الفئة «${catDeleteFor.name}»`)
      setCatDeleteFor(null)
      await load()
    } catch (e) {
      setCatError(e instanceof Error ? e.message : String(e))
      setCatDeleteFor(null)
    } finally {
      setCatBusy(false)
    }
  }

  const [labelsOpen, setLabelsOpen] = useState(false)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ marginRight: 'auto' }}>المنتجات</h1>
        <input
          placeholder="🔍 بحث بالاسم أو الرمز…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px', minWidth: 220 }}
        />
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          إظهار المعطلة
        </label>
        {/* rc.12-merge: زر فتح/إغلاق لوحة إدارة الفئات */}
        {canManageCats ? (
          <button className="btn ghost" onClick={() => setCatsOpen((v) => !v)}>
            🏷 الفئات ({cats.length}) {catsOpen ? '▲' : '▼'}
          </button>
        ) : null}
        <button className="btn ghost" onClick={() => setLabelsOpen(true)} title="طباعة ملصقات باركود Code 39">
          🏷️ ملصقات باركود
        </button>
        <button className="btn primary" onClick={() => setForm(openNew())}>
          ＋ منتج جديد
        </button>
      </div>

      {/* rc.12-merge: لوحة إدارة الفئات — إضافة فئة جديدة + شرائح تعديل/حذف لكل فئة.
          الحذف الآمن مفروض في الخلفية (catalog.deleteCategory يرفض حذف فئة عليها منتجات) */}
      {catsOpen && canManageCats ? (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <strong>إدارة الفئات</strong>
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveNewCat() }}
              placeholder="اسم فئة جديدة…"
              style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', minWidth: 200 }}
            />
            <button className="btn primary small" disabled={catBusy || !newCatName.trim()} onClick={() => void saveNewCat()}>
              ＋ إضافة فئة
            </button>
          </div>
          {catError ? <Banner kind="error" text={catError} /> : null}
          {cats.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>لا فئات بعد — أضف أول فئة لتنظيم منتجاتك (خبز، معجنات، مواد خام…).</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {cats.map((c) => (
                <span
                  key={c.id}
                  style={{
                    display: 'inline-flex', gap: 6, alignItems: 'center',
                    border: '1px solid var(--line)', borderRadius: 999, padding: '6px 12px', fontSize: 13,
                    opacity: c.active === 1 ? 1 : 0.55
                  }}
                >
                  {c.name}
                  {c.active !== 1 ? <Badge kind="muted" text="معطّلة" /> : null}
                  <button
                    className="btn ghost small"
                    style={{ padding: '2px 6px' }}
                    aria-label={`تعديل الفئة ${c.name}`}
                    onClick={() => setCatEdit({ id: c.id, name: c.name })}
                  >
                    ✏️
                  </button>
                  <button
                    className="btn ghost small"
                    style={{ padding: '2px 6px', color: 'var(--danger)' }}
                    aria-label={`حذف الفئة ${c.name}`}
                    onClick={() => setCatDeleteFor(c)}
                  >
                    🗑
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {rows.length === 0 ? (
        <EmptyState icon="🥐" text="لا منتجات بعد — أضف أول منتج لتظهر هنا وتصلح للبيع في نقطة البيع." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>المنتج</th>
              <th>النوع</th>
              <th>الفئة</th>
              <th>الوحدة</th>
              <th className="num">سعر البيع</th>
              <th className="num">التكلفة</th>
              <th className="num">الرصيد</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  {p.sku ? <div style={{ fontSize: 12, color: 'var(--muted)' }} dir="ltr">{p.sku}</div> : null}
                </td>
                <td>{p.type === 'RAW' ? 'مادة خام' : p.type === 'FINISHED' ? 'مصنّع' : 'تجاري'}</td>
                <td>{p.category_name ?? '—'}</td>
                <td>{p.base_unit}</td>
                <td className="num">{money(p.price_minor)}</td>
                <td className="num">{money(p.cost_minor)}</td>
                <td className="num">
                  {p.track_stock === 1 ? fmtQ(p.balance_milli ?? 0) : '—'}
                  {p.track_stock === 1 && (p.balance_milli ?? 0) < p.min_stock_milli ? <Badge kind="err" text="تحت الحد" /> : null}
                </td>
                <td>{p.active === 1 ? statusBadge('ACTIVE') : <Badge kind="muted" text="معطّل" />}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost small" onClick={() => setForm(openEdit(p))}>
                    تعديل
                  </button>{' '}
                  <button className={`btn small ${p.active === 1 ? 'danger' : 'ghost'}`} disabled={busy} onClick={() => void toggleActive(p)}>
                    {p.active === 1 ? 'تعطيل' : 'تنشيط'}
                  </button>{' '}
                  {p.active === 0 ? (
                    <button className="btn danger small" onClick={() => void deleteProduct(p)} title="حذف نهائي (لمن بلا حركات)">
                      حذف
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form ? (
        <Modal title={form.id === 0 ? 'منتج جديد' : `تعديل: ${form.name}`} onClose={() => setForm(null)}>
          {error ? <Banner kind="error" text={error} /> : null}
          <Field label="اسم المنتج *">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <div className="form-row">
            <Field label="رمز SKU (اختياري)">
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} dir="ltr" />
            </Field>
            <Field label="الفئة">
              <select value={String(form.category_id)} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">— بلا فئة —</option>
                {cats.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label="النوع">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="FINISHED">مصنّع (ينتج داخليًا)</option>
                <option value="RAW">مادة خام</option>
                <option value="TRADE">تجاري (مشترى)</option>
              </select>
            </Field>
            <Field label="وحدة القياس">
              <input value={form.base_unit} onChange={(e) => setForm({ ...form, base_unit: e.target.value })} placeholder="قطعة / كغ" />
            </Field>
          </div>
          <div className="form-row">
            <Field label="سعر البيع *">
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="التكلفة">
              <input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} inputMode="decimal" placeholder="0.00" />
            </Field>
          </div>
          <div className="form-row">
            <Field label="الحد الأدنى للمخزون" hint="بالوحدة الأساسية — يظهر تحذير عند النزول تحته">
              <input value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="تتبع المخزون">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 0' }}>
                <input type="checkbox" checked={form.track_stock} onChange={(e) => setForm({ ...form, track_stock: e.target.checked })} />
                نعم — احسب الرصيد من الحركات
              </label>
            </Field>
          </div>
          <Field label="الحالة">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              نشط (ظاهر للبيع)
            </label>
          </Field>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
            <button className="btn primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button className="btn ghost" onClick={() => setForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {/* rc.12-merge: تعديل الفئة */}
      {catEdit ? (
        <Modal title={`تعديل الفئة: ${catEdit.name}`} onClose={() => setCatEdit(null)}>
          <Field label="اسم الفئة *">
            <input
              value={catEdit.name}
              onChange={(e) => setCatEdit({ ...catEdit, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveCatEdit() }}
              autoFocus
            />
          </Field>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
            <button className="btn primary" disabled={catBusy || !catEdit.name.trim()} onClick={() => void saveCatEdit()}>
              {catBusy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button className="btn ghost" onClick={() => setCatEdit(null)}>إلغاء</button>
          </div>
        </Modal>
      ) : null}

      {/* rc.12-merge: تأكيد حذف الفئة — الحذف الآمن مفروض في الخلفية (يرفض فئة عليها منتجات) */}
      {catDeleteFor ? (
        <ConfirmModal
          title={`حذف الفئة: ${catDeleteFor.name}`}
          message="سيُحذف التصنيف نهائيًا. إن كان أية منتجات مرتبطة به سيرفض النظام الحذف ويقترح التعطيل بدلًا منه."
          confirmLabel="حذف نهائي"
          busy={catBusy}
          onConfirm={() => void deleteCat()}
          onClose={() => setCatDeleteFor(null)}
        />
      ) : null}

      {labelsOpen ? <LabelsModal products={rows} onClose={() => setLabelsOpen(false)} /> : null}
    </div>
  )
}

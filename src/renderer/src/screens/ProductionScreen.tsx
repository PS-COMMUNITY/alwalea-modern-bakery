// =============================================================
// مخبز الولاء الحديث — شاشة الإنتاج: الوصفات + دفعات الإنتاج
// القنوات: recipes.list/get/create/update + production.list/create/cancel
// إنشاء الدفعة يرسل clientRef فريدًا لمنع الترحيل المزدوج
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionUser } from '../../../shared/types'
import { call, money, qty as fmtQ } from '../api'
import { toMilli } from '../../../shared/money'
import { Field, Modal, Banner, EmptyState, statusBadge } from '../components/ui'

interface RecipeListRow {
  id: number
  name: string
  product_id: number
  product_name: string
  output_qty_milli: number
  note: string | null
  active: number
  items_count: number
}

interface RecipeDetailUI extends RecipeListRow {
  items: Array<{ id: number; product_id: number; product_name: string; qty_milli: number }>
}

interface BatchRow {
  id: number
  batch_no: string
  date: string
  recipe_id: number
  recipe_name: string
  actual_qty_milli: number
  waste_qty_milli: number
  material_cost_minor: number
  unit_cost_minor: number
  status: string
  notes: string | null
}

interface ProductLite {
  id: number
  name: string
  base_unit: string
  cost_minor: number
  track_stock: number
  active: number
}

interface RecipeItemUI {
  productId: string
  qty: string
}

interface RecipeForm {
  id: number
  name: string
  productId: string
  outputQty: string
  note: string
  active: boolean
  items: RecipeItemUI[]
}

interface BatchForm {
  recipeId: string
  actualQty: string
  wasteQty: string
  notes: string
  /** مرجع فريد يُولَّد مرة واحدة عند فتح النافذة لمنع الترحيل المزدوج */
  clientRef: string
}

/** مرجع فريد لمنع الترحيل المزدوج عند النقر المكرر */
function newClientRef(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const emptyLine = (): RecipeItemUI => ({ productId: '', qty: '' })

export default function ProductionScreen(props: { user: SessionUser }): ReactNode {
  const [recipes, setRecipes] = useState<RecipeListRow[] | null>(null)
  const [batches, setBatches] = useState<BatchRow[] | null>(null)
  const [products, setProducts] = useState<ProductLite[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // نافذة وصفة (إنشاء/تعديل)
  const [recipeForm, setRecipeForm] = useState<RecipeForm | null>(null)

  // نافذة دفعة إنتاج جديدة
  const [batchForm, setBatchForm] = useState<BatchForm | null>(null)

  // إلغاء دفعة
  const [cancelFor, setCancelFor] = useState<BatchRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const canManage = props.user.perms.includes('production.manage')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [r, b] = await Promise.all([
        call<RecipeListRow[]>('recipes.list', { includeInactive: true }),
        call<BatchRow[]>('production.list', {})
      ])
      setRecipes(r)
      setBatches(b)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const ensureProducts = useCallback(async (): Promise<void> => {
    if (products.length > 0) return
    try {
      setProducts(await call<ProductLite[]>('products.list', { includeInactive: true }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [products.length])

  const openNewRecipe = useCallback((): void => {
    setError('')
    setRecipeForm({ id: 0, name: '', productId: '', outputQty: '', note: '', active: true, items: [emptyLine()] })
    void ensureProducts()
  }, [ensureProducts])

  const openEditRecipe = useCallback(
    (r: RecipeListRow): void => {
      setError('')
      setRecipeForm(null)
      void (async () => {
        try {
          const [det, prods] = await Promise.all([
            call<RecipeDetailUI>('recipes.get', { id: r.id }),
            products.length > 0 ? Promise.resolve(products) : call<ProductLite[]>('products.list', { includeInactive: true })
          ])
          if (products.length === 0) setProducts(prods)
          setRecipeForm({
            id: det.id,
            name: det.name,
            productId: String(det.product_id),
            outputQty: String(det.output_qty_milli / 1000),
            note: det.note ?? '',
            active: det.active === 1,
            items: det.items.map((it) => ({ productId: String(it.product_id), qty: String(it.qty_milli / 1000) }))
          })
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
      })()
    },
    [products]
  )

  const setRecipeLine = (idx: number, patch: Partial<RecipeItemUI>): void => {
    setRecipeForm((f) => (f ? { ...f, items: f.items.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)) } : f))
  }

  const saveRecipe = async (): Promise<void> => {
    const f = recipeForm
    if (!f) return
    setError('')
    if (!f.name.trim()) {
      setError('اسم الوصفة مطلوب')
      return
    }
    const productId = Number(f.productId)
    if (!productId) {
      setError('اختر المنتج الناتج')
      return
    }
    const outputQtyMilli = toMilli(f.outputQty)
    if (outputQtyMilli === null || outputQtyMilli <= 0) {
      setError('كمية الناتج يجب أن تكون أكبر من صفر')
      return
    }
    if (f.items.length === 0) {
      setError('أضف مكونًا واحدًا على الأقل')
      return
    }
    const items: Array<{ productId: number; qtyMilli: number }> = []
    for (let i = 0; i < f.items.length; i++) {
      const ln = f.items[i]
      if (!ln) continue
      const pid = Number(ln.productId)
      const q = toMilli(ln.qty)
      if (!pid) {
        setError(`اختر المنتج للمكون ${i + 1}`)
        return
      }
      if (q === null || q <= 0) {
        setError(`كمية غير صحيحة للمكون ${i + 1}`)
        return
      }
      if (pid === productId) {
        setError('لا يمكن أن يكون المنتج الناتج مكونًا في نفس الوصفة')
        return
      }
      items.push({ productId: pid, qtyMilli: q })
    }
    setBusy(true)
    try {
      if (f.id === 0) {
        await call('recipes.create', { name: f.name.trim(), productId, outputQtyMilli, note: f.note.trim() || null, items })
      } else {
        await call('recipes.update', { id: f.id, name: f.name.trim(), outputQtyMilli, note: f.note.trim() || null, active: f.active, items })
      }
      setRecipeForm(null)
      setNotice(f.id === 0 ? 'تمت إضافة الوصفة' : 'تم تحديث الوصفة')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openNewBatch = useCallback((): void => {
    setError('')
    setBatchForm({ recipeId: '', actualQty: '', wasteQty: '', notes: '', clientRef: newClientRef() })
    void ensureProducts()
  }, [ensureProducts])

  const saveBatch = async (): Promise<void> => {
    const f = batchForm
    if (!f) return
    setError('')
    const recipeId = Number(f.recipeId)
    if (!recipeId) {
      setError('اختر الوصفة أولًا')
      return
    }
    const actualQtyMilli = toMilli(f.actualQty)
    if (actualQtyMilli === null || actualQtyMilli <= 0) {
      setError('كمية الناتج الفعلية يجب أن تكون أكبر من صفر')
      return
    }
    const wasteQtyMilli = f.wasteQty.trim() === '' ? 0 : toMilli(f.wasteQty)
    if (wasteQtyMilli === null) {
      setError('كمية الهالك غير صحيحة')
      return
    }
    setBusy(true)
    try {
      const res = await call<BatchRow>('production.create', {
        recipeId,
        actualQtyMilli,
        wasteQtyMilli,
        notes: f.notes.trim() || null,
        clientRef: f.clientRef
      })
      setBatchForm(null)
      setNotice(`تمت ترحيل دفعة الإنتاج ${res.batch_no} — خصم المواد وإضافة الناتج للمخزون`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitCancelBatch = async (): Promise<void> => {
    if (!cancelFor) return
    if (cancelReason.trim().length < 3) {
      setError('اكتب سبب الإلغاء (3 أحرف على الأقل)')
      return
    }
    setBusy(true)
    setError('')
    try {
      await call('production.cancel', { id: cancelFor.id, reason: cancelReason.trim() })
      setCancelFor(null)
      setCancelReason('')
      setNotice('تم إلغاء الدفعة وترحيل الحركات العكسية للمواد والناتج')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>الإنتاج</h1>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {/* ================= الوصفات ================= */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ marginRight: 'auto' }}>🍞 الوصفات</h2>
        {canManage ? (
          <button className="btn primary small" onClick={openNewRecipe}>
            ＋ وصفة جديدة
          </button>
        ) : null}
      </div>
      {recipes === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : recipes.length === 0 ? (
        <EmptyState icon="📖" text="لا وصفات بعد — أضف وصفة تربط المواد الخام بالمنتج الناتج لتشغيل دفعات الإنتاج." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>الوصفة</th>
              <th>المنتج الناتج</th>
              <th className="num">كمية الناتج</th>
              <th className="num">عدد المكونات</th>
              <th>الحالة</th>
              {canManage ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {recipes.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  {r.note ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note}</div> : null}
                </td>
                <td>{r.product_name}</td>
                <td className="num">{fmtQ(r.output_qty_milli)}</td>
                <td className="num">{r.items_count}</td>
                <td>{r.active === 1 ? statusBadge('ACTIVE') : <span className="badge muted">معطّلة</span>}</td>
                {canManage ? (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost small" onClick={() => openEditRecipe(r)}>
                      تعديل
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ================= دفعات الإنتاج ================= */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '26px 0 10px' }}>
        <h2 style={{ marginRight: 'auto' }}>🏭 دفعات الإنتاج</h2>
        {canManage ? (
          <button className="btn primary small" onClick={openNewBatch}>
            ＋ دفعة إنتاج جديدة
          </button>
        ) : null}
      </div>
      {batches === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : batches.length === 0 ? (
        <EmptyState icon="🏭" text="لا دفعات إنتاج بعد — سجّل دفعة لخصم المواد وإضافة الناتج للمخزون وتحديث التكلفة." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>الدفعة</th>
              <th>التاريخ</th>
              <th>الوصفة</th>
              <th className="num">الناتج الفعلي</th>
              <th className="num">الهالك</th>
              <th className="num">تكلفة المواد</th>
              <th className="num">تكلفة الوحدة</th>
              <th>الحالة</th>
              {canManage ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td>
                  <strong>{b.batch_no}</strong>
                  {b.notes ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.notes}</div> : null}
                </td>
                <td dir="ltr">{b.date}</td>
                <td>{b.recipe_name}</td>
                <td className="num">{fmtQ(b.actual_qty_milli)}</td>
                <td className="num">{b.waste_qty_milli > 0 ? fmtQ(b.waste_qty_milli) : '—'}</td>
                <td className="num">{money(b.material_cost_minor)}</td>
                <td className="num">{money(b.unit_cost_minor)}</td>
                <td>{statusBadge(b.status)}</td>
                {canManage ? (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {b.status !== 'CANCELLED' ? (
                      <button
                        className="btn danger small"
                        disabled={busy}
                        onClick={() => {
                          setCancelReason('')
                          setCancelFor(b)
                        }}
                      >
                        إلغاء
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ================= نافذة وصفة ================= */}
      {recipeForm ? (
        <Modal title={recipeForm.id === 0 ? 'وصفة جديدة' : `تعديل الوصفة: ${recipeForm.name}`} onClose={() => setRecipeForm(null)} wide>
          {error ? <Banner kind="error" text={error} /> : null}
          <div className="form-row">
            <Field label="اسم الوصفة *">
              <input value={recipeForm.name} onChange={(e) => setRecipeForm({ ...recipeForm, name: e.target.value })} autoFocus />
            </Field>
            <Field
              label="المنتج الناتج *"
              hint={recipeForm.id !== 0 ? 'لا يمكن تغيير المنتج الناتج بعد الإنشاء — أنشئ وصفة جديدة بدلًا من ذلك' : ''}
            >
              <select
                value={recipeForm.productId}
                onChange={(e) => setRecipeForm({ ...recipeForm, productId: e.target.value })}
                disabled={recipeForm.id !== 0}
              >
                <option value="">— اختر —</option>
                {products.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name} ({p.base_unit})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label="كمية الناتج المعيارية *" hint="بوحدة المنتج — مثال: 50 (رغيف)">
              <input dir="ltr" inputMode="decimal" placeholder="0" value={recipeForm.outputQty} onChange={(e) => setRecipeForm({ ...recipeForm, outputQty: e.target.value })} />
            </Field>
            <Field label="ملاحظة">
              <input value={recipeForm.note} onChange={(e) => setRecipeForm({ ...recipeForm, note: e.target.value })} placeholder="اختياري" />
            </Field>
          </div>

          <div style={{ margin: '6px 0 4px', fontWeight: 700, color: 'var(--brown-700)', fontSize: 14 }}>مكونات الوصفة</div>
          {recipeForm.items.map((ln, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 36px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select value={ln.productId} onChange={(e) => setRecipeLine(idx, { productId: e.target.value })}>
                <option value="">— اختر المكون —</option>
                {products
                  .filter((p) => String(p.id) !== recipeForm.productId)
                  .map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({p.base_unit})
                    </option>
                  ))}
              </select>
              <input dir="ltr" inputMode="decimal" placeholder="0" value={ln.qty} onChange={(e) => setRecipeLine(idx, { qty: e.target.value })} />
              <button
                className="btn danger small"
                disabled={recipeForm.items.length === 1}
                onClick={() => setRecipeForm((f) => (f ? { ...f, items: f.items.filter((_, i) => i !== idx) } : f))}
                aria-label={`حذف المكون ${idx + 1}`}
                title="حذف المكون"
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn ghost small" onClick={() => setRecipeForm((f) => (f ? { ...f, items: [...f.items, emptyLine()] } : f))}>
            ＋ إضافة مكون
          </button>

          {recipeForm.id !== 0 ? (
            <Field label="الحالة">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={recipeForm.active} onChange={(e) => setRecipeForm({ ...recipeForm, active: e.target.checked })} />
                نشطة (متاحة لإنشاء الدفعات)
              </label>
            </Field>
          ) : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => void saveRecipe()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ الوصفة'}
            </button>
            <button className="btn ghost" onClick={() => setRecipeForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ================= نافذة دفعة إنتاج ================= */}
      {batchForm ? (
        <Modal title="دفعة إنتاج جديدة" onClose={() => setBatchForm(null)}>
          {error ? <Banner kind="error" text={error} /> : null}
          <p className="hint" style={{ marginTop: 0 }}>
            الترحيل يخصم المواد بنسب الوصفة ويناسب الناتج الفعلي + الهالك، ويحدّث تكلفة المنتج الناتج تلقائيًا.
          </p>
          <Field label="الوصفة *">
            <select value={batchForm.recipeId} onChange={(e) => setBatchForm({ ...batchForm, recipeId: e.target.value })} autoFocus>
              <option value="">— اختر وصفة —</option>
              {(recipes ?? [])
                .filter((r) => r.active === 1)
                .map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.name} — ناتج معياري {fmtQ(r.output_qty_milli)} {r.product_name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="form-row">
            <Field label="كمية الناتج الفعلية *">
              <input dir="ltr" inputMode="decimal" placeholder="0" value={batchForm.actualQty} onChange={(e) => setBatchForm({ ...batchForm, actualQty: e.target.value })} />
            </Field>
            <Field label="كمية الهالك" hint="اتركها فارغة إن لم يوجد هالك">
              <input dir="ltr" inputMode="decimal" placeholder="0" value={batchForm.wasteQty} onChange={(e) => setBatchForm({ ...batchForm, wasteQty: e.target.value })} />
            </Field>
          </div>
          <Field label="ملاحظات">
            <input value={batchForm.notes} onChange={(e) => setBatchForm({ ...batchForm, notes: e.target.value })} placeholder="اختياري — مثال: وردية الصباح" />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void saveBatch()}>
              {busy ? 'جارٍ الترحيل…' : 'ترحيل الدفعة'}
            </button>
            <button className="btn ghost" onClick={() => setBatchForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ================= نافذة إلغاء دفعة ================= */}
      {cancelFor ? (
        <Modal title={`إلغاء دفعة: ${cancelFor.batch_no}`} onClose={() => setCancelFor(null)}>
          <Banner kind="error" text="الإلغاء عكسي: تُرد المواد للمخزون ويُخصم الناتج — لا يمكن الإلغاء إن كان الناتج بيعَ أو استُهلك." />
          <Field label="سبب الإلغاء *" hint="يُوثق في سجل التدقيق — 3 أحرف على الأقل">
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="مثال: خطأ في الكمية / جودة غير مطابقة"
              autoFocus
            />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" disabled={busy} onClick={() => void submitCancelBatch()}>
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

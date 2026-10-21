// =============================================================
// مخبز الولاء الحديث — شاشة المصروفات: قائمة + إنشاء + إلغاء
// القنوات: expenses.categories.list/create + expenses.list/create/cancel
// ملاحظة: كل مصروف يُخصم من الصندوق نقديًا (لا توجد طرق دفع أخرى في الخادم)
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionUser } from '../../../shared/types'
import { call, money } from '../api'
import { toMinor } from '../../../shared/money'
import { Field, Modal, Banner, EmptyState } from '../components/ui'

interface ExpenseCategoryRow {
  id: number
  name: string
  active: number
}

interface ExpenseRow {
  id: number
  date: string
  category_id: number
  category_name: string
  amount_minor: number
  note: string | null
  created_at: string
}

interface ExpenseForm {
  categoryId: string
  newCategory: string
  amount: string
  note: string
}

export default function ExpensesScreen(props: { user: SessionUser }): ReactNode {
  const [rows, setRows] = useState<ExpenseRow[] | null>(null)
  const [cats, setCats] = useState<ExpenseCategoryRow[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState<ExpenseForm | null>(null)
  const [addingCat, setAddingCat] = useState(false)

  // إلغاء مصروف
  const [cancelFor, setCancelFor] = useState<ExpenseRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const canManage = props.user.perms.includes('expenses.manage')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      if (from) payload.from = from
      if (to) payload.to = to
      if (categoryId) payload.categoryId = Number(categoryId)
      const [list, catsList] = await Promise.all([
        call<ExpenseRow[]>('expenses.list', payload),
        call<ExpenseCategoryRow[]>('expenses.categories.list', { includeInactive: true })
      ])
      setRows(list)
      setCats(catsList)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [from, to, categoryId])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = (): void => {
    setError('')
    setForm({ categoryId: '', newCategory: '', amount: '', note: '' })
  }

  const addCategoryInline = async (): Promise<void> => {
    if (!form) return
    const name = form.newCategory.trim()
    if (!name) {
      setError('اكتب اسم الفئة الجديدة')
      return
    }
    setAddingCat(true)
    setError('')
    try {
      const res = await call<{ id: number; name: string }>('expenses.categories.create', { name })
      setCats((c) => [...c, { id: res.id, name: res.name, active: 1 }])
      setForm((f) => (f ? { ...f, categoryId: String(res.id), newCategory: '' } : f))
      setNotice(`تمت إضافة فئة «${res.name}»`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAddingCat(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!form) return
    setError('')
    const catId = Number(form.categoryId)
    if (!catId) {
      setError('اختر فئة المصروف')
      return
    }
    const amountMinor = toMinor(form.amount)
    if (amountMinor === null || amountMinor <= 0) {
      setError('أدخل مبلغًا صحيحًا أكبر من صفر')
      return
    }
    setBusy(true)
    try {
      await call('expenses.create', { categoryId: catId, amountMinor, note: form.note.trim() || null })
      setForm(null)
      setNotice('تم تسجيل المصروف وخصمه من الصندوق')
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
      await call('expenses.cancel', { id: cancelFor.id, reason: cancelReason.trim() })
      setCancelFor(null)
      setCancelReason('')
      setNotice('تم إلغاء المصروف وإعادة المبلغ للصندوق')
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
        <h1 style={{ marginRight: 'auto' }}>المصروفات</h1>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>من تاريخ</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>إلى تاريخ</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>الفئة</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">الكل</option>
            {cats.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {canManage ? (
          <button className="btn primary" onClick={openCreate}>
            ＋ مصروف جديد
          </button>
        ) : null}
      </div>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {rows === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : rows.length === 0 ? (
        <EmptyState icon="🧾" text="لا مصروفات في هذا النطاق — سجّل مصروفًا ليُخصم من الصندوق ويظهر في التقارير." />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>الفئة</th>
              <th className="num">المبلغ</th>
              <th>طريقة الدفع</th>
              <th>ملاحظة</th>
              <th>الحالة</th>
              {canManage ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td dir="ltr">{r.date}</td>
                <td>{r.category_name}</td>
                <td className="num">{money(r.amount_minor)}</td>
                <td>نقديًا</td>
                <td>{r.note ?? '—'}</td>
                <td>
                  <span className="badge ok">نشط</span>
                </td>
                {canManage ? (
                  <td style={{ whiteSpace: 'nowrap' }}>
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
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700, color: 'var(--brown-900)' }}>
                مجموع المعروض
              </td>
              <td className="num" style={{ fontWeight: 800 }}>
                {money(rows.reduce((s, r) => s + r.amount_minor, 0))}
              </td>
              <td colSpan={canManage ? 4 : 3} />
            </tr>
          </tfoot>
        </table>
      )}

      {form ? (
        <Modal title="مصروف جديد" onClose={() => setForm(null)}>
          {error ? <Banner kind="error" text={error} /> : null}
          <div className="form-row">
            <Field label="الفئة *" hint="أو أنشئ فئة جديدة من الحقل المجاور">
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} autoFocus>
                <option value="">— اختر فئة —</option>
                {cats.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="فئة جديدة">
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={form.newCategory}
                  onChange={(e) => setForm({ ...form, newCategory: e.target.value })}
                  placeholder="اسم الفئة"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addCategoryInline()
                  }}
                />
                <button className="btn ghost small" disabled={addingCat} onClick={() => void addCategoryInline()}>
                  {addingCat ? '…' : 'إضافة'}
                </button>
              </div>
            </Field>
          </div>
          <div className="form-row">
            <Field label="المبلغ *" hint="يُخصم من الصندوق نقديًا فورًا">
              <input dir="ltr" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="ملاحظة">
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="اختياري — بند الصرف" />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ المصروف'}
            </button>
            <button className="btn ghost" onClick={() => setForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {cancelFor ? (
        <Modal title={`إلغاء مصروف (${cancelFor.category_name} — ${money(cancelFor.amount_minor)})`} onClose={() => setCancelFor(null)}>
          <Banner kind="error" text="الإلغاء عكسي: يُعاد مبلغ المصروف إلى الصندوق كحركة موثقة، ويخرج المصروف من القائمة." />
          <Field label="سبب الإلغاء *" hint="يُوثق في سجل التدقيق — 3 أحرف على الأقل">
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="مثال: تسجيل مكرر / خطأ في المبلغ"
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

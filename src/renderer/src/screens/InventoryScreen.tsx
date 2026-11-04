// =============================================================
// مخبز الولاء الحديث — شاشة المخزون: أرصدة + رصيد افتتاحي
// الرصيد دائمًا مجموع الحركات (يأتي من inventory.balances)
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InventoryBalanceRow, ProductRow, SessionUser } from '../../../shared/types'
import { call, money, qty } from '../api'
import { toMilli, toMinor } from '../../../shared/money'
import { EmptyState, Field, Modal, Banner } from '../components/ui'

/** قيمة الرصيد بالأغورة — نفس صيغة الخادم في تقرير تقييم المخزون */
function stockValueMinor(balanceMilli: number, costMinor: number): number {
  return Math.round((balanceMilli * costMinor) / 1000)
}

export default function InventoryScreen(props: { user: SessionUser }): ReactNode {
  const [rows, setRows] = useState<InventoryBalanceRow[] | null>(null)
  const [lowOnly, setLowOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // حالة نافذة الرصيد الافتتاحي
  const [openingOpen, setOpeningOpen] = useState(false)
  const [products, setProducts] = useState<Array<ProductRow & { balance_milli: number | null }>>([])
  const [openProductId, setOpenProductId] = useState('')
  const [openQty, setOpenQty] = useState('')
  const [openCost, setOpenCost] = useState('')
  const [openError, setOpenError] = useState('')
  const [saving, setSaving] = useState(false)

  const canOpening = props.user.perms.includes('inventory.opening')

  const load = useCallback(async (low: boolean, q: string): Promise<void> => {
    try {
      const r = await call<InventoryBalanceRow[]>('inventory.balances', { onlyTracked: true, lowOnly: low, q })
      setRows(r)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load(lowOnly, search)
  }, [load, lowOnly, search])

  const openOpening = useCallback((): void => {
    setOpeningOpen(true)
    setOpenError('')
    setOpenQty('')
    setOpenCost('')
    void (async () => {
      try {
        setProducts(await call<Array<ProductRow & { balance_milli: number | null }>>('products.list', {}))
      } catch (e) {
        setOpenError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const saveOpening = useCallback(async (): Promise<void> => {
    setOpenError('')
    const productId = Number(openProductId)
    if (!productId) {
      setOpenError('اختر المنتج أولًا')
      return
    }
    const qtyMilli = toMilli(openQty)
    if (qtyMilli === null || qtyMilli <= 0) {
      setOpenError('أدخل كمية صحيحة أكبر من صفر')
      return
    }
    const costMinor = openCost.trim() === '' ? null : toMinor(openCost)
    if (openCost.trim() !== '' && costMinor === null) {
      setOpenError('تكلفة الوحدة غير صحيحة')
      return
    }
    setSaving(true)
    try {
      const res = await call<{ done: boolean; count: number }>('inventory.opening', {
        items: [{ productId, qtyMilli, unitCostMinor: costMinor }]
      })
      setOpeningOpen(false)
      setNotice(`تم تسجيل الرصيد الافتتاحي (${res.count} بند)`)
      await load(lowOnly, search)
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [openProductId, openQty, openCost, load, lowOnly, search])

  const totalValue = (rows ?? []).reduce((s, r) => s + stockValueMinor(r.balance_milli, r.cost_minor), 0)
  const selected = products.find((p) => String(p.id) === openProductId)

  return (
    <div>
      <h1>المخزون</h1>

      {error ? <Banner kind="error" text={error} /> : null}
      {!error && notice ? <Banner kind="ok" text={notice} /> : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          style={{ flex: '0 1 260px', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', background: '#fff' }}
          placeholder="بحث باسم المنتج…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className={`btn small ${lowOnly ? 'primary' : 'ghost'}`} onClick={() => setLowOnly((v) => !v)}>
          {lowOnly ? '✓ المنخفضة فقط' : 'المنخفضة فقط'}
        </button>
        <button className="btn ghost small" onClick={() => void load(lowOnly, search)}>
          تحديث ⟳
        </button>
        {canOpening ? (
          <button className="btn primary small" style={{ marginInlineStart: 'auto' }} onClick={openOpening}>
            + رصيد افتتاحي
          </button>
        ) : null}
      </div>

      {rows === null ? (
        <EmptyState icon="⏳" text="جارٍ تحميل الأرصدة…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="📦"
          text={lowOnly ? 'لا توجد منتجات منخفضة المخزون.' : 'لا أرصدة بعد — أضف منتجات من شاشة «المنتجات» ثم سجّل رصيدًا افتتاحيًا.'}
        />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>المنتج</th>
              <th>الوحدة</th>
              <th className="num">الرصيد</th>
              <th className="num">الحد الأدنى</th>
              <th className="num">تكلفة الوحدة</th>
              <th className="num">قيمة الرصيد</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const low = r.balance_milli <= r.min_stock_milli
              return (
                <tr key={r.product_id}>
                  <td>{r.name}</td>
                  <td>{r.base_unit}</td>
                  <td className="num" style={{ color: r.balance_milli <= 0 ? 'var(--err)' : low ? 'var(--amber-dark)' : undefined }}>
                    {qty(r.balance_milli)}
                  </td>
                  <td className="num">{qty(r.min_stock_milli)}</td>
                  <td className="num">{money(r.cost_minor)}</td>
                  <td className="num">{money(stockValueMinor(r.balance_milli, r.cost_minor))}</td>
                  <td>{low ? <span className="badge err">منخفض</span> : <span className="badge ok">جيد</span>}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ fontWeight: 700, color: 'var(--brown-900)' }}>
                إجمالي قيمة المخزون
              </td>
              <td className="num" style={{ fontWeight: 800 }}>
                {money(totalValue)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}

      {openingOpen ? (
        <Modal title="رصيد افتتاحي" onClose={() => setOpeningOpen(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            يُسجَّل كحركة «OPENING» مرة واحدة لكل منتج — الخادم يرفض التكرار.
          </p>
          {openError ? <Banner kind="error" text={openError} /> : null}
          <div className="form-row">
            <Field label="المنتج">
              <select value={openProductId} onChange={(e) => setOpenProductId(e.target.value)}>
                <option value="">— اختر منتجًا —</option>
                {products
                  .filter((p) => Number(p.track_stock) === 1)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (رصيد حالي: {qty(p.balance_milli ?? 0)})
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={`الكمية (${selected ? selected.base_unit : 'بوحدة المنتج'})`}>
              <input
                dir="ltr"
                placeholder="مثال: 25 أو 2.5"
                value={openQty}
                onChange={(e) => setOpenQty(e.target.value)}
              />
            </Field>
          </div>
          <Field label="تكلفة الوحدة (اختيارية — تحدّث تكلفة المنتج)">
            <input dir="ltr" placeholder="مثال: 3.50" value={openCost} onChange={(e) => setOpenCost(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
            <button className="btn primary" disabled={saving} onClick={() => void saveOpening()}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ الرصيد الافتتاحي'}
            </button>
            <button className="btn ghost" onClick={() => setOpeningOpen(false)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

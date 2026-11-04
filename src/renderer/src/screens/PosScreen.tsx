// =============================================================
// مخبز الولاء الحديث — نقطة البيع: بحث سريع، سلة، خصم، نقدي/آجل،
// ترحيل ذري + معاينة إيصال 80مم + منع النقر المزدوج
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppSettings, PartyRow, ProductRow, SaleDetail, SessionUser } from '../../../shared/types'
import { lineTotalMinor, toMilli, toMinor, fromMilli } from '../../../shared/money'
import { call, money, qty as fmtQ } from '../api'
import { Banner, EmptyState } from '../components/ui'
import ReceiptModal from '../components/ReceiptModal'

// rc.9 (المرحلة 1): الدفع الجزئي بالآجل — عربون نقدي الآن والباقي على الحساب
// الأزرار السريعة: صفر = آجل كامل، نصف = نصف المبلغ الآن، كامل = دفع كامل (يصبح PAID)

interface ProductUI extends ProductRow {
  balance_milli: number | null
}

interface CartLine {
  product: ProductUI
  qtyMilli: number
}

export default function PosScreen(props: {
  user: SessionUser
  settings: AppSettings | null
}): ReactNode {
  const cur = props.settings?.currencySymbol ?? '₪'
  const [products, setProducts] = useState<ProductUI[]>([])
  const [customers, setCustomers] = useState<PartyRow[]>([])
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [discount, setDiscount] = useState('')
  const [payType, setPayType] = useState<'CASH' | 'CREDIT'>('CASH')
  const [paidInput, setPaidInput] = useState('')
  const [cashNowInput, setCashNowInput] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [clientRef, setClientRef] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<SaleDetail | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [p, c] = await Promise.all([
        call<ProductUI[]>('products.list', { includeInactive: false }),
        call<PartyRow[]>('customers.list', {})
      ])
      setProducts(p)
      setCustomers(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim()
    if (!q) return products
    return products.filter((p) => p.name.includes(q) || (p.sku ?? '').toLowerCase().includes(q.toLowerCase()))
  }, [products, search])

  const addToCart = (p: ProductUI): void => {
    if (p.active !== 1) return
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product.id === p.id)
      if (idx >= 0) {
        const next = [...prev]
        const line = next[idx]
        if (line) next[idx] = { ...line, qtyMilli: line.qtyMilli + 1000 }
        return next
      }
      return [...prev, { product: p, qtyMilli: 1000 }]
    })
  }

  const setQty = (productId: number, value: string): void => {
    const milli = toMilli(value)
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === productId ? { ...l, qtyMilli: milli ?? 0 } : l))
        .filter((l) => l.qtyMilli > 0)
    )
  }

  const removeLine = (productId: number): void => {
    setCart((prev) => prev.filter((l) => l.product.id !== productId))
  }

  const subtotal = useMemo(() => cart.reduce((s, l) => s + lineTotalMinor(l.qtyMilli, l.product.price_minor), 0), [cart])
  const discountMinor = toMinor(discount) ?? 0
  const total = Math.max(0, subtotal - discountMinor)
  // نقدي: المدفوع (فارغ = كامل). آجل: «نقدًا الآن» (فارغ = صفر — آجل كامل)
  const paidMinor = payType === 'CASH' ? (paidInput.trim() === '' ? total : toMinor(paidInput) ?? 0) : 0
  const cashNowMinor = payType === 'CREDIT' ? (cashNowInput.trim() === '' ? 0 : toMinor(cashNowInput) ?? 0) : 0
  const onAccountMinor = Math.max(0, total - cashNowMinor)
  const change = payType === 'CASH' ? Math.max(0, paidMinor - total) : 0

  const quickCashNow = (kind: 'zero' | 'half' | 'full'): void => {
    if (kind === 'zero') {
      setCashNowInput('')
      return
    }
    const v = kind === 'half' ? Math.round(total / 2) : total
    setCashNowInput((v / 100).toFixed(2))
  }

  const resetCart = (): void => {
    setCart([])
    setDiscount('')
    setPaidInput('')
    setCashNowInput('')
    setCustomerId('')
    setClientRef('')
    setNote('')
    setPayType('CASH')
  }

  const commit = async (): Promise<void> => {
    if (busy) return
    setError('')
    setNotice('')
    if (cart.length === 0) {
      setError('السلة فارغة — أضف منتجات أولًا')
      return
    }
    if (payType === 'CASH' && paidMinor > total) {
      setError('المدفوع أكبر من الإجمالي — الباقي يُعطى كصرد')
      return
    }
    if (payType === 'CREDIT' && customerId === '') {
      setError('البيع الآجل يتطلب اختيار عميل من القائمة — الدين يُسجّل باسمه')
      return
    }
    if (payType === 'CREDIT' && cashNowMinor > total) {
      setError('«نقدًا الآن» أكبر من الإجمالي — اكتب مبلغًا أقل أو اختر «كامل» للدفع الكامل')
      return
    }
    if (discountMinor > subtotal) {
      setError('الخصم أكبر من مجموع السلة')
      return
    }
    setBusy(true)
    try {
      // rc.9: نقدي = المدفوع (فارغ = كامل) • آجل = «نقدًا الآن» اختياري والباقي دين على العميل
      const cashPortion = payType === 'CASH' ? paidMinor : cashNowMinor
      const payments: Array<{ method: string; amountMinor: number }> =
        cashPortion > 0 ? [{ method: 'CASH', amountMinor: cashPortion }] : []
      const sale = await call<SaleDetail>('sales.create', {
        items: cart.map((l) => ({ productId: l.product.id, qtyMilli: l.qtyMilli })),
        discountMinor: discountMinor > 0 ? discountMinor : undefined,
        customerId: customerId === '' ? undefined : Number(customerId),
        payments,
        clientRef: clientRef.trim() || undefined,
        note: note.trim() || undefined
      })
      resetCart()
      setNotice(`تم ترحيل الفاتورة ${sale.invoice_no}`)
      setReceipt(sale)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ marginRight: 'auto' }}>نقطة البيع</h1>
        <input
          placeholder="🔍 بحث بالاسم أو الرمز… (امسح الباركود ثم Enter للإضافة)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const q = search.trim().toLowerCase()
            if (!q) return
            const exact = products.find((p) => (p.sku ?? '').toLowerCase() === q)
            const target = exact ?? (filtered.length === 1 ? filtered[0] : undefined)
            if (target) {
              addToCart(target)
              setSearch('')
            }
          }}
          autoFocus
          style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', minWidth: 260 }}
        />
      </div>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      <div className="pos-layout">
        <div>
          {filtered.length === 0 ? (
            <EmptyState icon="🥖" text="لا منتجات مطابقة — أضف منتجات من شاشة «المنتجات» أولًا." />
          ) : (
            <div className="pos-products">
              {filtered.map((p) => (
                <button key={p.id} className={`pos-product${p.active !== 1 ? ' disabled' : ''}`} onClick={() => addToCart(p)}>
                  <div className="p-name">{p.name}</div>
                  <div className="p-price">{money(p.price_minor, cur)}</div>
                  <div className="p-stock">
                    {p.track_stock === 1 ? `المتوفر: ${fmtQ(p.balance_milli ?? 0)} ${p.base_unit}` : 'بدون تتبع مخزون'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cart">
          <h2>السلة ({cart.length})</h2>
          {cart.length === 0 ? (
            <EmptyState icon="🛒" text="اضغط على أي منتج لإضافته للسلة." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>كمية</th>
                  <th className="num">إجمالي</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((l) => (
                  <tr key={l.product.id}>
                    <td>{l.product.name}</td>
                    <td>
                      <input
                        className="qty-input"
                        value={String(fromMilli(l.qtyMilli))}
                        onChange={(e) => setQty(l.product.id, e.target.value)}
                        inputMode="decimal"
                      />{' '}
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{l.product.base_unit}</span>
                    </td>
                    <td className="num tot">{money(lineTotalMinor(l.qtyMilli, l.product.price_minor), cur)}</td>
                    <td>
                      <button className="btn danger small" onClick={() => removeLine(l.product.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="pos-summary">
            <div className="row">
              <span>المجموع</span>
              <span>{money(subtotal, cur)}</span>
            </div>
            <div className="row">
              <span>الخصم</span>
              <input
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                style={{ width: 90, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', textAlign: 'left' }}
              />
            </div>
            <div className="row grand">
              <span>الإجمالي</span>
              <span>{money(total, cur)}</span>
            </div>

            <div className="pay-toggle">
              <button className={payType === 'CASH' ? 'sel' : ''} onClick={() => setPayType('CASH')}>
                💵 نقدي
              </button>
              <button className={payType === 'CREDIT' ? 'sel' : ''} onClick={() => setPayType('CREDIT')}>
                📒 آجل
              </button>
            </div>

            {payType === 'CASH' ? (
              <div className="row">
                <span>المدفوع (اتركه فارغًا = كامل المبلغ)</span>
                <input
                  value={paidInput}
                  onChange={(e) => setPaidInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="كامل المبلغ"
                  style={{ width: 110, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', textAlign: 'left' }}
                />
              </div>
            ) : null}
            {payType === 'CASH' && paidMinor > 0 ? (
              <div className="row">
                <span>الصرد</span>
                <span style={{ color: 'var(--ok)', fontWeight: 700 }}>{money(change, cur)}</span>
              </div>
            ) : null}

            {payType === 'CREDIT' ? (
              <>
                <div className="row" style={{ alignItems: 'center' }}>
                  <span>نقدًا الآن (اختياري — عربون)</span>
                  <input
                    value={cashNowInput}
                    onChange={(e) => setCashNowInput(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    style={{ width: 90, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', textAlign: 'left' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6, margin: '4px 0' }}>
                  <button type="button" className="btn ghost small" onClick={() => quickCashNow('zero')}>
                    صفر (آجل كامل)
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => quickCashNow('half')}>
                    نصف الآن
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => quickCashNow('full')}>
                    كامل الآن
                  </button>
                </div>
                {total > 0 ? (
                  <div className="row" style={{ fontSize: 13, fontWeight: 700 }}>
                    <span>
                      نقدًا الآن: {money(cashNowMinor, cur)} • على الحساب:{' '}
                      <span style={{ color: onAccountMinor > 0 ? 'var(--err)' : 'var(--ok)' }}>{money(onAccountMinor, cur)}</span>
                    </span>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="row">
              <span>العميل {payType === 'CREDIT' ? '(إلزامي للآجل)' : '(اختياري)'}</span>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                style={{ width: 150, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px' }}
              >
                <option value="">— بلا عميل —</option>
                {customers.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <span>مرجع خارجي (clientRef) — يمنع الترحيل المزدوج</span>
              <input
                value={clientRef}
                onChange={(e) => setClientRef(e.target.value)}
                placeholder="اختياري"
                style={{ width: 110, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', textAlign: 'left' }}
              />
            </div>
            <div className="row">
              <span>ملاحظة</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="اختياري"
                style={{ width: 150, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="btn primary" style={{ flex: 1 }} disabled={busy || cart.length === 0} onClick={() => void commit()}>
                {busy ? 'جارٍ الترحيل…' : '✅ ترحيل الفاتورة'}
              </button>
              <button className="btn ghost" disabled={busy} onClick={resetCart}>
                تفريغ
              </button>
            </div>
          </div>
        </div>
      </div>

      {receipt ? (
        <ReceiptModal
          sale={receipt}
          businessName={props.settings?.businessName ?? 'مخبز الولاء الحديث'}
          footer={props.settings?.receiptFooter ?? ''}
          currency={cur}
          onClose={() => setReceipt(null)}
        />
      ) : null}
    </div>
  )
}

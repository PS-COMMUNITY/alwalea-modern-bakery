'use client'

// =============================================================
// نقطة البيع — سلة، دفع، وردية، إيصال حراري 80مم، اختصارات لوحة مفاتيح
// F2 = تركيز البحث | F4 = ترحيل | Esc = إغلاق الحوارات (Radix natively)
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Customer, Product, Sale } from '@/lib/bakery/types'
import { PAYMENT_METHOD_LABELS } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader,
  money as fmtMoney, qty as fmtQty,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Banknote, Landmark, Minus, Plus, Printer, Search, ShoppingCart, Trash2, UserRound } from 'lucide-react'

// =============================================================
// أدوات تحويل محلية (أغورة/ألفية) — يدوية بدون floating-point تراكمي
// =============================================================

function toMinorSafe(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}
function toMilliSafe(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n * 1000)
}
/** إجمالي السطر: Math.round(qtyMilli × priceMinor / 1000) − خصم السطر (بحد أدنى 0) — مطابق للـ API */
function lineTotalOf(l: CartLine): number {
  return Math.max(0, Math.round((l.qtyMilli * l.priceMinor) / 1000) - l.discountMinor)
}

// =============================================================
// الإيصال الحراري — يُشارك مع شاشة المبيعات (نسخة إعادة الطباعة)
// =============================================================

export type ReceiptLine = {
  productName: string
  qtyMilli: number
  priceMinor: number
  discountMinor?: number
  lineTotalMinor: number
}

export type ReceiptData = {
  invoiceNo: string
  date: string
  cashierName: string
  customerName?: string | null
  items: ReceiptLine[]
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
  paidMinor: number
  creditMinor: number
  payments?: { method: string; amountMinor: number }[]
  reprint?: boolean
}

export function Receipt({ data }: { data: ReceiptData }) {
  const { settings, money } = useSession()
  return (
    <div className="receipt-print-area receipt-80mm p-2 text-[12px] leading-normal text-black">
      {data.reprint ? (
        <div className="mb-1 border-b border-dashed border-black pb-1 text-center font-bold">** نسخة إعادة طباعة **</div>
      ) : null}
      <div className="text-center">
        <div className="text-base font-black">{settings.businessName}</div>
        {settings.phone ? <div>هاتف: {settings.phone}</div> : null}
      </div>
      <div className="my-1 grid grid-cols-2 gap-x-2 border-y border-black py-1">
        <span className="font-semibold">رقم الفاتورة:</span>
        <span className="font-mono" dir="ltr">{data.invoiceNo}</span>
        <span className="font-semibold">التاريخ:</span>
        <span>{dateTime(data.date)}</span>
        <span className="font-semibold">الكاشير:</span>
        <span>{data.cashierName}</span>
        {data.customerName ? (
          <>
            <span className="font-semibold">العميل:</span>
            <span>{data.customerName}</span>
          </>
        ) : null}
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-black text-[11px]">
            <th className="py-0.5 text-start font-bold">البند</th>
            <th className="py-0.5 text-start font-bold">كمية × سعر</th>
            <th className="py-0.5 text-end font-bold">إجمالي</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={i} className="align-top">
              <td className="py-0.5 pe-1">
                {it.productName}
                {it.discountMinor ? <span className="block text-[10px]">خصم سطر: {money(it.discountMinor)}</span> : null}
              </td>
              <td className="py-0.5 whitespace-nowrap tabular-nums">{fmtQty(it.qtyMilli)} × {money(it.priceMinor)}</td>
              <td className="py-0.5 text-end tabular-nums">{money(it.lineTotalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 border-t border-black pt-1">
        <div className="flex justify-between"><span>المجموع</span><span className="tabular-nums">{money(data.subtotalMinor)}</span></div>
        {data.discountMinor > 0 ? (
          <div className="flex justify-between"><span>الخصم</span><span className="tabular-nums">−{money(data.discountMinor)}</span></div>
        ) : null}
        {data.taxMinor > 0 ? (
          <div className="flex justify-between"><span>الضريبة</span><span className="tabular-nums">{money(data.taxMinor)}</span></div>
        ) : null}
        <div className="flex justify-between border-t border-black text-sm font-black"><span>الإجمالي</span><span className="tabular-nums">{money(data.totalMinor)}</span></div>
        <div className="flex justify-between"><span>المدفوع</span><span className="tabular-nums">{money(data.paidMinor)}</span></div>
        {data.payments && data.payments.length > 0 ? (
          <div className="ps-3 text-[10px]">
            {data.payments.map((p, i) => (
              <div key={i} className="flex justify-between text-muted-foreground">
                <span>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</span>
                <span className="tabular-nums">{money(p.amountMinor)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex justify-between font-bold"><span>المتبقي (آجل)</span><span className="tabular-nums">{money(data.creditMinor)}</span></div>
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1 text-center">شكرًا لزيارتكم</div>
    </div>
  )
}

// =============================================================
// شاشة نقطة البيع
// =============================================================

type CartLine = {
  productId: string
  name: string
  unit: string
  trackStock: boolean
  stockMilli: number
  qtyMilli: number
  priceMinor: number
  discountMinor: number
  /** نص أثناء الكتابة — يُمسح عند مغادرة الحقل ليعود القيمة المحفوظة */
  qtyDraft?: string | null
  priceDraft?: string | null
  discDraft?: string | null
}

type ShiftCurrent = {
  shift: ({ id: string; openingCashMinor: number; openedAt: string; userId: string; user?: { id: string; displayName?: string | null; username?: string | null } | null }) | null
  expectedCashMinor: number
}

type PayMode = 'full' | 'partial' | 'credit'

/** الفاتورة كما يعيدها POST /api/sales (تشمل المدفوعات) */
type SaleWithPayments = Sale & { payments?: { id?: string; method: string; amountMinor: number; date?: string }[] }

/** المنتج كما يعيده GET /api/products (يحمل رصيد المخزون الحالي) */
type ProductRow = Product & { stockMilli?: number }

export function PosScreen() {
  const { user, settings, money, can } = useSession()
  const { toast } = useToast()

  // ===== قائمة المنتجات =====
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [prodLoading, setProdLoading] = useState(true)
  const [prodError, setProdError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // ===== السلة والدفع =====
  const [cart, setCart] = useState<CartLine[]>([])
  const [invoiceDiscount, setInvoiceDiscount] = useState('')
  const [payMode, setPayMode] = useState<PayMode>('full')
  const [payMethod, setPayMethod] = useState('CASH')
  const [partialAmount, setPartialAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [formError, setFormError] = useState('')

  // ===== اختيار العميل (بحث) =====
  const [custOpen, setCustOpen] = useState(false)
  const [custQuery, setCustQuery] = useState('')
  const [custList, setCustList] = useState<Customer[]>([])
  const [custLoading, setCustLoading] = useState(false)
  const [customer, setCustomer] = useState<Customer | null>(null)

  // ===== الوردية =====
  const canViewShift = can('shifts.view')
  const [shift, setShift] = useState<ShiftCurrent | null>(null)
  const [shiftDlg, setShiftDlg] = useState(false)
  const [openingCash, setOpeningCash] = useState('0')
  const [shiftBusy, setShiftBusy] = useState(false)

  // ===== الإيصال بعد الترحيل =====
  const [lastSale, setLastSale] = useState<SaleWithPayments | null>(null)
  const [printOpen, setPrintOpen] = useState(false)

  const loadProducts = useCallback(async () => {
    setProdLoading(true)
    setProdError('')
    try {
      const res = await api.get<{ items: ProductRow[]; total: number }>(
        `/api/products?active=true&q=${encodeURIComponent(search)}`,
      )
      setProducts(res.items)
    } catch (e) {
      setProdError(e instanceof ApiError ? e.message : 'تعذر تحميل المنتجات')
      setProducts(null)
    } finally {
      setProdLoading(false)
    }
  }, [search])

  // بحث فوري مع debounce 250ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    void loadProducts()
  }, [loadProducts])

  const loadShift = useCallback(async () => {
    if (!canViewShift) return
    try {
      setShift(await api.get<ShiftCurrent>('/api/shifts/current'))
    } catch {
      setShift(null)
    }
  }, [canViewShift])

  useEffect(() => {
    void loadShift()
  }, [loadShift])

  // ===== اختيار العميل =====
  useEffect(() => {
    if (!custOpen) return
    let cancelled = false
    const t = setTimeout(async () => {
      setCustLoading(true)
      try {
        const res = await api.get<{ items: Customer[]; total: number }>(
          `/api/customers?active=true&q=${encodeURIComponent(custQuery.trim())}`,
        )
        if (!cancelled) setCustList(res.items)
      } catch {
        if (!cancelled) setCustList([])
      } finally {
        if (!cancelled) setCustLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [custOpen, custQuery])

  // ===== حسابات الفاتورة محليًا (نفس صيغة الـ API) =====
  const subtotalMinor = useMemo(() => cart.reduce((s, l) => s + lineTotalOf(l), 0), [cart])
  const discountRaw = toMinorSafe(invoiceDiscount) ?? 0
  const discountMinor = Math.min(discountRaw, subtotalMinor)
  const taxMinor = settings.taxEnabled
    ? Math.round(((subtotalMinor - discountMinor) * settings.taxRateBp) / 10000)
    : 0
  const totalMinor = subtotalMinor - discountMinor + taxMinor

  const partialRaw = toMinorSafe(partialAmount) ?? 0
  const paidMinor = payMode === 'full' ? totalMinor : payMode === 'partial' ? Math.min(partialRaw, totalMinor) : 0
  const remainingMinor = totalMinor - paidMinor
  const discountDisabled = !can('sales.discount')

  // ===== إضافة/تعديل السلة =====
  const addToCart = useCallback((p: ProductRow, stockMilli: number) => {
    setCart(prev => {
      const found = prev.find(l => l.productId === p.id)
      if (found) {
        return prev.map(l => (l.productId === p.id ? { ...l, qtyMilli: l.qtyMilli + 1000, stockMilli } : l))
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: p.baseUnit,
          trackStock: p.trackStock,
          stockMilli,
          qtyMilli: 1000,
          priceMinor: p.priceMinor,
          discountMinor: 0,
        },
      ]
    })
    setFormError('')
  }, [])

  const patchLine = useCallback((productId: string, patch: Partial<CartLine>) => {
    setCart(prev => prev.map(l => (l.productId === productId ? { ...l, ...patch } : l)))
  }, [])

  const removeLine = useCallback((productId: string) => {
    setCart(prev => prev.filter(l => l.productId !== productId))
  }, [])

  // ===== الترحيل =====
  const checkout = useCallback(async () => {
    setFormError('')
    if (cart.length === 0 || busyRef.current) return

    if (discountRaw > 0 && discountDisabled) {
      setFormError('ليس لديك صلاحية منح خصم على مستوى الفاتورة')
      return
    }
    if (payMode === 'partial') {
      if (partialRaw <= 0) {
        setFormError('أدخل مبلغ الدفعة الجزئية')
        return
      }
      if (partialRaw > totalMinor) {
        setFormError('المدفوع أكبر من الإجمالي — استخدم "نقدي كامل" أو قلّل المبلغ')
        return
      }
    }
    if (remainingMinor > 0 && !customer) {
      setFormError(
        settings.requireCustomerForCredit
          ? 'البيع الآجل يتطلب تحديد العميل — الإعداد الحالي يشترط عميلًا مسجلًا لأي دين'
          : 'البيع الآجل يتطلب تحديد العميل',
      )
      return
    }

    // clientRef فريد في كل محاولة لمنع الترحيل المزدوج
    const clientRef = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    setBusy(true)
    busyRef.current = true
    try {
      const sale = await api.post<Sale>('/api/sales', {
        items: cart.map(l => ({
          productId: l.productId,
          qtyMilli: l.qtyMilli,
          priceMinor: l.priceMinor,
          discountMinor: l.discountMinor > 0 ? l.discountMinor : undefined,
        })),
        customerId: customer?.id || undefined,
        payments: paidMinor > 0 ? [{ method: payMethod, amountMinor: paidMinor }] : [],
        discountMinor: discountMinor > 0 ? discountMinor : undefined,
        clientRef,
        shiftId: shift?.shift?.id || undefined,
      })
      toast({ title: `تم ترحيل الفاتورة ${sale.invoiceNo}`, description: `الإجمالي ${money(sale.totalMinor)}` })
      setLastSale(sale)
      setPrintOpen(true)
      // تصفير السلة وإعادة تحميل الأرصدة والوردية
      setCart([])
      setInvoiceDiscount('')
      setPayMode('full')
      setPartialAmount('')
      setPayMethod('CASH')
      setCustomer(null)
      void loadProducts()
      void loadShift()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'تعذر ترحيل الفاتورة'
      setFormError(msg)
      toast({ title: 'تعذر ترحيل الفاتورة', description: msg, variant: 'destructive' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [
    cart, customer, discountDisabled, discountMinor, discountRaw, loadProducts, loadShift,
    money, paidMinor, partialRaw, payMethod, payMode, remainingMinor, shift, settings.requireCustomerForCredit,
    toast, totalMinor,
  ])

  // ===== اختصارات لوحة المفاتيح =====
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.key === 'F4') {
        e.preventDefault()
        if (cart.length > 0 && !busyRef.current) void checkout()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart.length, checkout])

  // ===== فتح وردية سريع =====
  async function openShift() {
    const opening = toMinorSafe(openingCash) ?? 0
    setShiftBusy(true)
    try {
      await api.post('/api/shifts/open', { openingCashMinor: opening })
      toast({ title: 'تم فتح الوردية', description: `نقدية الافتتاح ${money(opening)}` })
      setShiftDlg(false)
      await loadShift()
    } catch (e) {
      toast({
        title: 'تعذر فتح الوردية',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
      // قد تكون الوردية فُتحت من مكان آخر — نحدّث الحالة
      await loadShift()
    } finally {
      setShiftBusy(false)
    }
  }

  function saleToReceipt(s: SaleWithPayments): ReceiptData {
    return {
      invoiceNo: s.invoiceNo,
      date: s.date,
      cashierName: user.displayName,
      customerName: s.customerName,
      items: (s.items ?? []).map(it => ({
        productName: it.productName,
        qtyMilli: it.qtyMilli,
        priceMinor: it.priceMinor,
        discountMinor: it.discountMinor,
        lineTotalMinor: it.lineTotalMinor,
      })),
      subtotalMinor: s.subtotalMinor,
      discountMinor: s.discountMinor,
      taxMinor: s.taxMinor,
      totalMinor: s.totalMinor,
      paidMinor: s.paidMinor,
      creditMinor: s.creditMinor,
      payments: (s.payments ?? []).map(p => ({ method: p.method, amountMinor: p.amountMinor })),
      reprint: false,
    }
  }

  const hasLowStockNote = (p: ProductRow, stockMilli: number) => p.trackStock && stockMilli <= 0

  return (
    <div>
      <PageHeader
        title="نقطة البيع"
        subtitle="سجل فاتورة جديدة — F2 للبحث، F4 للترحيل"
        actions={
          <Button type="button" variant="outline" onClick={() => { setOpeningCash('0'); setShiftDlg(true) }} disabled={!can('shifts.use') || !!shift?.shift}>
            <Landmark className="h-4 w-4" aria-hidden />
            فتح وردية
          </Button>
        }
      />

      {/* ===== شريط الوردية أعلى الشاشة ===== */}
      {canViewShift ? (
        <div
          className={cn(
            'mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3 text-sm',
            shift?.shift ? 'border-ok-600/40 bg-ok-100/50' : 'border-copper-500/50 bg-copper-100/40',
          )}
          role="status"
        >
          {shift === null ? (
            <Skeleton className="h-5 w-64" />
          ) : shift.shift ? (
            <>
              <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>●</span> وردية مفتوحة</Badge>
              <span>
                الرصيد المتوقع: <b className="tabular-nums">{money(shift.expectedCashMinor)}</b>
              </span>
              <span className="text-xs text-muted-foreground">
                فُتحت {dateTime(shift.shift.openedAt)}
                {shift.shift.user?.displayName ? ` بواسطة ${shift.shift.user.displayName}` : ''}
              </span>
            </>
          ) : (
            <>
              <Badge variant="outline" className="border-copper-600 text-copper-700">
                لا وردية مفتوحة — سيُسجل البيع بلا وردية
              </Badge>
              {can('shifts.use') ? (
                <Button type="button" size="sm" className="h-9" onClick={() => { setOpeningCash('0'); setShiftDlg(true) }}>
                  فتح وردية الآن
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {/* ===== قائمة المنتجات (يسار على الشاشات الكبيرة) ===== */}
        <section className="md:order-2 xl:col-span-3" aria-label="قائمة المنتجات">
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                ref={searchRef}
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="ابحث بالاسم أو الكود أو الباركود… (F2)"
                className="h-11 ps-9 text-base"
                aria-label="بحث في المنتجات"
                autoComplete="off"
              />
            </div>
          </div>

          {prodError ? <ErrorBanner message={prodError} onRetry={loadProducts} /> : null}

          {prodLoading && !products ? (
            <LoadingRows rows={4} />
          ) : products && products.length === 0 ? (
            <EmptyState
              title={search ? 'لا نتائج مطابقة' : 'لا منتجات مفعّلة بعد'}
              hint={search ? 'جرّب كلمة بحث أخرى' : 'أضف منتجات من شاشة المنتجات لتظهر هنا.'}
            />
          ) : (
            <div className="nice-scroll grid max-h-[62vh] grid-cols-2 gap-2 overflow-y-auto pe-1 sm:grid-cols-3 xl:grid-cols-4" role="list" aria-label="منتجات للبيع">
              {(products ?? []).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p, p.stockMilli ?? 0)}
                  className="flex min-h-[96px] flex-col justify-between rounded-xl border bg-card p-3 text-start shadow-sm transition-colors hover:border-copper-500 hover:bg-copper-100/40 focus-visible:outline-2 focus-visible:outline-copper-600"
                  aria-label={`إضافة ${p.name} إلى السلة — السعر ${fmtMoney(p.priceMinor, settings.currencySymbol)}`}
                >
                  <span className="line-clamp-2 text-sm font-bold leading-snug">{p.name}</span>
                  <span className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="tabular-nums text-sm font-semibold text-copper-700">{fmtMoney(p.priceMinor, settings.currencySymbol)}</span>
                    <span className={cn('text-xs tabular-nums', hasLowStockNote(p, p.stockMilli ?? 0) ? 'font-bold text-destructive' : 'text-muted-foreground')}>
                      {p.trackStock ? `الرصيد ${fmtQty(p.stockMilli ?? 0)} ${p.baseUnit}` : 'بلا تتبع'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ===== السلة (يمين على الشاشات الكبيرة) ===== */}
        <section className="md:order-1 xl:col-span-2" aria-label="سلة الفاتورة">
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b p-3">
              <h2 className="flex items-center gap-2 font-bold">
                <ShoppingCart className="h-4.5 w-4.5 text-copper-600" aria-hidden />
                السلة
                {cart.length > 0 ? <Badge variant="secondary" className="tabular-nums">{cart.length}</Badge> : null}
              </h2>
              {cart.length > 0 ? (
                <Button type="button" variant="ghost" size="sm" className="h-9 text-destructive hover:text-destructive" onClick={() => { setCart([]); setFormError('') }}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  تفريغ
                </Button>
              ) : null}
            </div>

            {/* بنود السلة */}
            {cart.length === 0 ? (
              <div className="p-4">
                <EmptyState title="السلة فارغة" hint="اختر منتجًا من القائمة لإضافته — كل نقرة تضيف وحدة واحدة." />
              </div>
            ) : (
              <ul className="nice-scroll max-h-[38vh] divide-y overflow-y-auto" aria-label="بنود الفاتورة">
                {cart.map(l => (
                  <li key={l.productId} className="space-y-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-bold">{l.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeLine(l.productId)}
                        aria-label={`إزالة ${l.name} من السلة`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      {/* الكمية */}
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">الكمية ({l.unit})</Label>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            onClick={() => patchLine(l.productId, { qtyMilli: Math.max(1000, l.qtyMilli - 1000) })}
                            aria-label={`إنقاص كمية ${l.name}`}
                          >
                            <Minus className="h-4 w-4" aria-hidden />
                          </Button>
                          <Input
                            inputMode="decimal"
                            value={l.qtyDraft ?? fmtQty(l.qtyMilli)}
                            onChange={e => {
                              const v = e.target.value
                              const m = toMilliSafe(v)
                              if (m !== null && m > 0) patchLine(l.productId, { qtyMilli: m, qtyDraft: v })
                              else patchLine(l.productId, { qtyDraft: v })
                            }}
                            onBlur={() => patchLine(l.productId, { qtyDraft: null })}
                            className="h-9 w-20 text-center tabular-nums"
                            aria-label={`كمية ${l.name}`}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            onClick={() => patchLine(l.productId, { qtyMilli: l.qtyMilli + 1000 })}
                            aria-label={`زيادة كمية ${l.name}`}
                          >
                            <Plus className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </div>
                      {/* السعر */}
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">السعر ({settings.currencySymbol})</Label>
                        <Input
                          inputMode="decimal"
                          value={l.priceDraft ?? (l.priceMinor / 100).toString()}
                          onChange={e => {
                            const v = e.target.value
                            const m = toMinorSafe(v)
                            if (m !== null) patchLine(l.productId, { priceMinor: m, priceDraft: v })
                            else patchLine(l.productId, { priceDraft: v })
                          }}
                          onBlur={() => patchLine(l.productId, { priceDraft: null })}
                          className="h-9 w-24 text-center tabular-nums"
                          aria-label={`سعر ${l.name}`}
                        />
                      </div>
                      {/* خصم السطر */}
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">خصم السطر</Label>
                        <Input
                          inputMode="decimal"
                          value={l.discDraft ?? (l.discountMinor > 0 ? (l.discountMinor / 100).toString() : '')}
                          placeholder="0"
                          onChange={e => {
                            const v = e.target.value
                            const gross = Math.round((l.qtyMilli * l.priceMinor) / 1000)
                            const m = toMinorSafe(v)
                            if (v.trim() === '') patchLine(l.productId, { discountMinor: 0, discDraft: v })
                            else if (m !== null) patchLine(l.productId, { discountMinor: Math.min(m, gross), discDraft: v })
                            else patchLine(l.productId, { discDraft: v })
                          }}
                          onBlur={() => patchLine(l.productId, { discDraft: null })}
                          className="h-9 w-20 text-center tabular-nums"
                          aria-label={`خصم ${l.name}`}
                        />
                      </div>
                      {/* إجمالي السطر */}
                      <div className="ms-auto space-y-1 text-end">
                        <Label className="text-xs text-muted-foreground">إجمالي السطر</Label>
                        <div className="h-9 min-w-24 rounded-md bg-copper-100/60 px-2 text-sm font-bold leading-9 tabular-nums">
                          {money(lineTotalOf(l))}
                        </div>
                      </div>
                    </div>
                    {l.trackStock && l.qtyMilli > l.stockMilli ? (
                      <p className="text-xs font-semibold text-destructive">
                        تنبيه: الكمية أكبر من الرصيد المتاح ({fmtQty(l.stockMilli)} {l.unit})
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {/* عميل + دفع */}
            <div className="space-y-3 border-t p-3">
              {/* اختيار العميل */}
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">العميل</Label>
                <Popover open={custOpen} onOpenChange={setCustOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="h-10 w-full justify-between font-normal" aria-label="اختيار العميل">
                      <span className="flex min-w-0 items-center gap-2">
                        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{customer ? customer.name : 'عميل نقدي (بدون تسجيل)'}</span>
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="ابحث بالاسم أو الهاتف…" value={custQuery} onValueChange={setCustQuery} />
                      <CommandList className="max-h-60">
                        <CommandGroup>
                          <CommandItem
                            value="__cash__"
                            onSelect={() => { setCustomer(null); setCustOpen(false) }}
                            className="gap-2"
                          >
                            <UserRound className="h-4 w-4" aria-hidden />
                            عميل نقدي (بدون تسجيل)
                          </CommandItem>
                          {custLoading ? <CommandItem disabled>جارٍ البحث…</CommandItem> : null}
                          {!custLoading && custList.length === 0 && custQuery ? <CommandEmpty>لا عملاء مطابقون</CommandEmpty> : null}
                          {custList.map(c => (
                            <CommandItem
                              key={c.id}
                              value={`c-${c.id}`}
                              onSelect={() => { setCustomer(c); setCustOpen(false) }}
                            >
                              <span className="min-w-0 flex-1 truncate">{c.name}</span>
                              {typeof c.debtMinor === 'number' && c.debtMinor > 0 ? (
                                <span className="shrink-0 text-xs tabular-nums text-destructive">دين {money(c.debtMinor)}</span>
                              ) : null}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* طريقة الدفع */}
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">نمط الدفع</Label>
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="نمط الدفع">
                  {([
                    { id: 'full', label: 'نقدي كامل' },
                    { id: 'partial', label: 'جزئي' },
                    { id: 'credit', label: 'آجل' },
                  ] as { id: PayMode; label: string }[]).map(m => (
                    <Button
                      key={m.id}
                      type="button"
                      variant={payMode === m.id ? 'default' : 'outline'}
                      className="h-10 text-xs sm:text-sm"
                      aria-pressed={payMode === m.id}
                      onClick={() => setPayMode(m.id)}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
              </div>

              {payMode === 'partial' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="pos-partial">مبلغ المدفوع الآن ({settings.currencySymbol})</Label>
                  <Input
                    id="pos-partial"
                    inputMode="decimal"
                    value={partialAmount}
                    onChange={e => setPartialAmount(e.target.value)}
                    placeholder="0.00"
                    className="h-10 tabular-nums"
                    autoComplete="off"
                  />
                </div>
              ) : null}

              {payMode !== 'credit' ? (
                <div className="space-y-1.5">
                  <Label>طريقة الدفع</Label>
                  <Select value={payMethod} onValueChange={setPayMethod}>
                    <SelectTrigger className="h-10 w-full" aria-label="طريقة الدفع"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="rounded-lg bg-copper-100/50 p-2 text-xs leading-relaxed">
                  البيع الآجل: يُقيّد كامل المتبقي على حساب العميل (يتطلب عميلًا مسجلًا).
                </p>
              )}

              {/* خصم الفاتورة */}
              <div className="space-y-1.5">
                <Label htmlFor="pos-discount" className={cn(discountDisabled && 'text-muted-foreground')}>
                  خصم الفاتورة ({settings.currencySymbol})
                </Label>
                <Input
                  id="pos-discount"
                  inputMode="decimal"
                  value={invoiceDiscount}
                  onChange={e => setInvoiceDiscount(e.target.value)}
                  placeholder="0.00"
                  disabled={discountDisabled}
                  aria-describedby={discountDisabled ? 'pos-discount-hint' : undefined}
                  className="h-10 tabular-nums"
                  autoComplete="off"
                />
                {discountDisabled ? (
                  <p id="pos-discount-hint" className="text-xs text-muted-foreground">
                    الخصم على مستوى الفاتورة يتطلب صلاحية خاصة (sales.discount).
                  </p>
                ) : null}
              </div>
            </div>

            {/* شريط الإجماليات الثابت أسفل السلة */}
            <div className="space-y-2 rounded-b-xl border-t bg-cocoa-900 p-3 text-cream-100" aria-label="ملخص الفاتورة">
              <div className="flex justify-between text-sm"><span>المجموع (قبل الخصم)</span><span className="tabular-nums">{money(subtotalMinor)}</span></div>
              <div className="flex justify-between text-sm"><span>الخصم</span><span className="tabular-nums">−{money(discountMinor)}</span></div>
              {settings.taxEnabled ? (
                <div className="flex justify-between text-sm">
                  <span>الضريبة ({(settings.taxRateBp / 100).toFixed(2)}%)</span>
                  <span className="tabular-nums">{money(taxMinor)}</span>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-cocoa-700 pt-2 text-base font-black"><span>الإجمالي</span><span className="tabular-nums text-copper-300">{money(totalMinor)}</span></div>
              <div className="flex justify-between text-sm"><span>المدفوع</span><span className="tabular-nums">{money(paidMinor)}</span></div>
              <div className={cn('flex justify-between text-sm font-bold', remainingMinor > 0 && 'text-amber-300')}>
                <span>المتبقي (آجل)</span><span className="tabular-nums">{money(remainingMinor)}</span>
              </div>
              {formError ? (
                <p className="rounded-lg bg-destructive/20 p-2 text-xs font-semibold leading-relaxed text-red-200" role="alert">{formError}</p>
              ) : null}
              <Button
                type="button"
                className="h-12 w-full text-base font-bold"
                onClick={() => void checkout()}
                disabled={busy || cart.length === 0}
              >
                <Banknote className="h-5 w-5" aria-hidden />
                {busy ? 'جارٍ الترحيل…' : 'ترحيل الفاتورة (F4)'}
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* ===== حوار فتح وردية ===== */}
      <Dialog open={shiftDlg} onOpenChange={setShiftDlg}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>فتح وردية جديدة</DialogTitle>
            <DialogDescription>سجّل نقدية الصندوق في بداية الوردية لتُحاسب عليها عند الإغلاق.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="opening-cash">نقدية الافتتاح ({settings.currencySymbol})</Label>
            <Input
              id="opening-cash"
              inputMode="decimal"
              value={openingCash}
              onChange={e => setOpeningCash(e.target.value)}
              className="h-10 tabular-nums"
              autoComplete="off"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setShiftDlg(false)} disabled={shiftBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void openShift()} disabled={shiftBusy}>
              {shiftBusy ? 'جارٍ الفتح…' : 'فتح الوردية'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار طباعة الإيصال بعد الترحيل ===== */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تم ترحيل الفاتورة{lastSale ? ` ${lastSale.invoiceNo}` : ''}</DialogTitle>
            <DialogDescription>هل تريد طباعة الإيصال؟</DialogDescription>
          </DialogHeader>
          <div className="nice-scroll max-h-[55vh] overflow-y-auto rounded-lg border bg-white p-2">
            {lastSale ? <Receipt data={saleToReceipt(lastSale)} /> : null}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setPrintOpen(false)}>لاحقًا</Button>
            <Button type="button" className="h-10" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden />
              طباعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

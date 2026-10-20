'use client'

// =============================================================
// المخزون — الأرصدة، سجل الحركات، عمليات (افتتاحي/جرد/إعدام)
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Product } from '@/lib/bakery/types'
import { MOVEMENT_TYPE_LABELS, PRODUCT_TYPE_LABELS } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, TableShell,
  money as fmtMoney, qty as fmtQty,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { AlertTriangle, Boxes, ClipboardCheck, History, PackageOpen, TrendingDown } from 'lucide-react'

/** المنتج كما يعيده GET /api/products (يحمل رصيد المخزون الحالي) */
type ProductRow = Product & { stockMilli?: number }

type InventoryItem = {
  productId: string
  name: string
  code: string | null
  type: string
  baseUnit: string
  trackStock: boolean
  active: boolean
  category: { id: string; name: string } | null
  costMinor: number
  minStockMilli: number
  qtyMilli: number
  stockValueMinor: number
}

type LowItem = {
  productId: string
  name: string
  code: string | null
  baseUnit: string
  active: boolean
  qtyMilli: number
  minStockMilli: number
  diffMilli: number
}

type MovementRow = {
  id: string
  date: string
  productId: string
  qtyMilli: number
  type: string
  refType: string | null
  refId: string | null
  note: string | null
  unitCostMinor: number | null
  product: { id: string; name: string; baseUnit: string }
}

type MovementAdjustResponse = {
  productId: string
  productName: string
  currentMilli: number
  countedMilli: number
  diffMilli: number
}

const PAGE_SIZE = 25

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

function fmtISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function InventoryScreen() {
  const { money, can } = useSession()
  const { toast } = useToast()
  const canOpening = can('inventory.opening')
  const canAdjust = can('inventory.adjust')
  const canWaste = can('inventory.waste')
  const anyOps = canOpening || canAdjust || canWaste

  // ===== الأرصدة =====
  const [balances, setBalances] = useState<InventoryItem[] | null>(null)
  const [balLoading, setBalLoading] = useState(true)
  const [balError, setBalError] = useState('')
  const [lowOnly, setLowOnly] = useState(false)

  // ===== سجل الحركات =====
  const [products, setProducts] = useState<ProductRow[]>([])
  const [mvProductId, setMvProductId] = useState('')
  const [mvType, setMvType] = useState('')
  const [mvFrom, setMvFrom] = useState('')
  const [mvTo, setMvTo] = useState('')
  const [mvRows, setMvRows] = useState<MovementRow[] | null>(null)
  const [mvTotal, setMvTotal] = useState(0)
  const [mvPage, setMvPage] = useState(1)
  const [mvLoading, setMvLoading] = useState(false)
  const [mvError, setMvError] = useState('')

  // ===== حوار الرصيد الافتتاحي =====
  const [openingOpen, setOpeningOpen] = useState(false)
  const [opProductId, setOpProductId] = useState('')
  const [opQty, setOpQty] = useState('')
  const [opCost, setOpCost] = useState('')
  const [opBusy, setOpBusy] = useState(false)
  const [opError, setOpError] = useState('')

  // ===== حوار الجرد =====
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adProductId, setAdProductId] = useState('')
  const [adCounted, setAdCounted] = useState('')
  const [adReason, setAdReason] = useState('')
  const [adBusy, setAdBusy] = useState(false)
  const [adError, setAdError] = useState('')

  // ===== حوار الإعدام =====
  const [wasteOpen, setWasteOpen] = useState(false)
  const [waProductId, setWaProductId] = useState('')
  const [waQty, setWaQty] = useState('')
  const [waReason, setWaReason] = useState('')
  const [waBusy, setWaBusy] = useState(false)
  const [waError, setWaError] = useState('')

  // ===== تحميل الأرصدة =====
  const loadBalances = useCallback(async () => {
    setBalLoading(true)
    setBalError('')
    try {
      if (lowOnly) {
        const res = await api.get<{ items: LowItem[]; total: number }>('/api/inventory/low')
        // نفس شكل الأرصدة مع قيمة محسوبة — نعرضها بالجدول نفسه
        const mapped: InventoryItem[] = res.items.map(x => ({
          productId: x.productId,
          name: x.name,
          code: x.code,
          type: '',
          baseUnit: x.baseUnit,
          trackStock: true,
          active: x.active,
          category: null,
          costMinor: 0,
          minStockMilli: x.minStockMilli,
          qtyMilli: x.qtyMilli,
          stockValueMinor: 0,
        }))
        setBalances(mapped)
      } else {
        const res = await api.get<{ items: InventoryItem[]; total: number }>('/api/inventory')
        setBalances(res.items)
      }
    } catch (e) {
      setBalError(e instanceof ApiError ? e.message : 'تعذر تحميل أرصدة المخزون')
      setBalances(null)
    } finally {
      setBalLoading(false)
    }
  }, [lowOnly])

  useEffect(() => {
    void loadBalances()
  }, [loadBalances])

  // ===== قائمة المنتجات (للفلاتر والعمليات) =====
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await api.get<{ items: ProductRow[]; total: number }>('/api/products')
        if (!cancelled) setProducts(res.items)
      } catch {
        // الفلاتر تعمل بدون قائمة المنتجات
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ===== سجل الحركات =====
  const loadMovements = useCallback(async () => {
    setMvLoading(true)
    setMvError('')
    try {
      const params = new URLSearchParams()
      if (mvProductId) params.set('productId', mvProductId)
      if (mvType) params.set('type', mvType)
      if (mvFrom) params.set('from', mvFrom)
      if (mvTo) params.set('to', mvTo)
      params.set('page', String(mvPage))
      params.set('pageSize', String(PAGE_SIZE))
      const res = await api.get<{ items: MovementRow[]; total: number }>(`/api/inventory/movements?${params.toString()}`)
      setMvRows(res.items)
      setMvTotal(res.total)
    } catch (e) {
      setMvError(e instanceof ApiError ? e.message : 'تعذر تحميل الحركات')
      setMvRows(null)
    } finally {
      setMvLoading(false)
    }
  }, [mvFrom, mvPage, mvProductId, mvTo, mvType])

  useEffect(() => {
    void loadMovements()
  }, [loadMovements])

  const mvPages = Math.max(1, Math.ceil(mvTotal / PAGE_SIZE))

  // ===== الرصيد الافتتاحي =====
  /** منتجات بلا حركات: رصيدها الحالي صفر — الأرجح لا حركات لها (الخادم يرفض المكرر برسالة عربية) */
  const productsWithoutMovements = products.filter(p => p.active && (p.stockMilli ?? 0) === 0)

  function resetOpening() {
    setOpProductId('')
    setOpQty('')
    setOpCost('')
    setOpError('')
  }

  async function submitOpening() {
    setOpError('')
    const productId = opProductId
    if (!productId) {
      setOpError('اختر المنتج')
      return
    }
    const qtyMilli = toMilliSafe(opQty)
    if (qtyMilli === null || qtyMilli <= 0) {
      setOpError('أدخل كمية صحيحة أكبر من صفر')
      return
    }
    const unitCostMinor = toMinorSafe(opCost)
    if (unitCostMinor === null && opCost.trim() !== '') {
      setOpError('تكلفة الوحدة غير صالحة')
      return
    }
    setOpBusy(true)
    try {
      await api.post('/api/inventory/opening', {
        items: [{ productId, qtyMilli, ...(unitCostMinor !== null ? { unitCostMinor } : {}) }],
      })
      toast({ title: 'تم تسجيل الرصيد الافتتاحي' })
      setOpeningOpen(false)
      resetOpening()
      void loadBalances()
    } catch (e) {
      setOpError(e instanceof ApiError ? e.message : 'تعذر تسجيل الرصيد الافتتاحي')
    } finally {
      setOpBusy(false)
    }
  }

  // ===== الجرد =====
  const adProduct = products.find(p => p.id === adProductId) ?? null

  function resetAdjust() {
    setAdProductId('')
    setAdCounted('')
    setAdReason('')
    setAdError('')
  }

  async function submitAdjust() {
    setAdError('')
    if (!adProductId) {
      setAdError('اختر المنتج')
      return
    }
    const countedQtyMilli = toMilliSafe(adCounted)
    if (countedQtyMilli === null) {
      setAdError('أدخل الكمية الفعلية المعدودة (0 أو أكثر)')
      return
    }
    if (!adReason.trim()) {
      setAdError('سبب الجرد إلزامي')
      return
    }
    setAdBusy(true)
    try {
      const res = await api.post<MovementAdjustResponse>('/api/inventory/adjust', {
        productId: adProductId,
        countedQtyMilli,
        reason: adReason.trim(),
      })
      const sign = res.diffMilli > 0 ? '+' : ''
      toast({
        title: res.diffMilli === 0 ? 'الجرد مطابق — لا فرق' : `تم تسجيل فرق الجرد: ${sign}${fmtQty(res.diffMilli)} ${adProduct?.baseUnit ?? ''}`.trim(),
        description: res.diffMilli === 0
          ? `المعدود ${fmtQty(res.countedMilli)} يطابق الرصيد الدفتري.`
          : `الدفتري ${fmtQty(res.currentMilli)} → المعدود ${fmtQty(res.countedMilli)}.`,
      })
      setAdjustOpen(false)
      resetAdjust()
      void loadBalances()
    } catch (e) {
      setAdError(e instanceof ApiError ? e.message : 'تعذر تنفيذ الجرد')
    } finally {
      setAdBusy(false)
    }
  }

  // ===== الإعدام =====
  function resetWaste() {
    setWaProductId('')
    setWaQty('')
    setWaReason('')
    setWaError('')
  }

  async function submitWaste() {
    setWaError('')
    if (!waProductId) {
      setWaError('اختر المنتج')
      return
    }
    const qtyMilli = toMilliSafe(waQty)
    if (qtyMilli === null || qtyMilli <= 0) {
      setWaError('أدخل كمية صحيحة أكبر من صفر')
      return
    }
    if (!waReason.trim()) {
      setWaError('سبب الإعدام إلزامي')
      return
    }
    setWaBusy(true)
    try {
      await api.post('/api/inventory/waste', { productId: waProductId, qtyMilli, reason: waReason.trim() })
      toast({ title: 'تم تسجيل الإعدام', description: 'سُجلت حركة تلف وهدر في المخزون.' })
      setWasteOpen(false)
      resetWaste()
      void loadBalances()
    } catch (e) {
      setWaError(e instanceof ApiError ? e.message : 'تعذر تسجيل الإعدام')
    } finally {
      setWaBusy(false)
    }
  }

  const totalValue = (balances ?? []).reduce((s, x) => s + x.stockValueMinor, 0)

  return (
    <div>
      <PageHeader title="المخزون" subtitle="الأرصدة الحالية وسجل حركات المخزون — أي تغيير رصيد يمر عبر حركة موثقة" />

      <Tabs defaultValue="balances">
        <TabsList className="mb-4 h-11">
          <TabsTrigger value="balances" className="gap-2 px-4">
            <Boxes className="h-4 w-4" aria-hidden />
            الأرصدة
          </TabsTrigger>
          <TabsTrigger value="movements" className="gap-2 px-4">
            <History className="h-4 w-4" aria-hidden />
            سجل الحركات
          </TabsTrigger>
          {anyOps ? (
            <TabsTrigger value="ops" className="gap-2 px-4">
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              عمليات
            </TabsTrigger>
          ) : null}
        </TabsList>

        {/* ==================== تبويب الأرصدة ==================== */}
        <TabsContent value="balances">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={lowOnly ? 'default' : 'outline'}
              className="h-10"
              onClick={() => setLowOnly(v => !v)}
              aria-pressed={lowOnly}
            >
              <TrendingDown className="h-4 w-4" aria-hidden />
              منخفضة المخزون
            </Button>
            {lowOnly ? <span className="text-sm text-muted-foreground">تُعرض المنتجات التي رصيدها ≤ الحد الأدنى أو ≤ صفر.</span> : null}
          </div>

          {balError ? <ErrorBanner message={balError} onRetry={loadBalances} /> : null}

          {balLoading && !balances ? (
            <LoadingRows rows={6} />
          ) : balances && balances.length === 0 ? (
            <EmptyState
              title={lowOnly ? 'لا منتجات منخفضة المخزون' : 'لا منتجات بعد'}
              hint={lowOnly ? 'كل الأرصدة فوق الحد الأدنى — وضع سليم.' : 'أضف منتجات من شاشة المنتجات ثم سجّل أرصدتها الافتتاحية.'}
            />
          ) : balances ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">الاسم</th>
                    {!lowOnly ? <th className="p-3 text-start font-semibold">النوع</th> : null}
                    <th className="p-3 text-start font-semibold">الرصيد</th>
                    <th className="p-3 text-start font-semibold">حد أدنى</th>
                    {!lowOnly ? <th className="p-3 text-start font-semibold">التكلفة</th> : null}
                    {!lowOnly ? <th className="p-3 text-start font-semibold">قيمة المخزون</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {balances.map(it => {
                    const isLow = it.trackStock && (it.qtyMilli <= it.minStockMilli || it.qtyMilli <= 0)
                    return (
                      <tr key={it.productId} className="border-t transition-colors hover:bg-cream-100">
                        <td className="p-3">
                          <span className="font-semibold">{it.name}</span>
                          {it.code ? <span className="block font-mono text-xs text-muted-foreground" dir="ltr">{it.code}</span> : null}
                        </td>
                        {!lowOnly ? (
                          <td className="p-3">
                            <Badge variant="secondary">{PRODUCT_TYPE_LABELS[it.type] ?? it.type}</Badge>
                          </td>
                        ) : null}
                        <td className={cn('p-3 font-semibold tabular-nums', isLow && 'text-destructive')}>
                          {it.trackStock ? `${fmtQty(it.qtyMilli)} ${it.baseUnit}` : '—'}
                          {isLow ? <span className="ms-1 inline-flex items-center gap-1 text-xs"><AlertTriangle className="inline h-3 w-3" aria-hidden />منخفض</span> : null}
                        </td>
                        <td className="p-3 tabular-nums text-muted-foreground">{it.trackStock ? `${fmtQty(it.minStockMilli)} ${it.baseUnit}` : '—'}</td>
                        {!lowOnly ? <td className="p-3 tabular-nums text-muted-foreground">{fmtMoney(it.costMinor)}</td> : null}
                        {!lowOnly ? <td className="p-3 font-semibold tabular-nums">{fmtMoney(it.stockValueMinor)}</td> : null}
                      </tr>
                    )
                  })}
                </tbody>
                {!lowOnly && balances.length > 0 ? (
                  <tfoot className="sticky bottom-0 bg-cream-200">
                    <tr className="border-t-2">
                      <td className="p-3 font-bold" colSpan={5}>إجمالي قيمة المخزون</td>
                      <td className="p-3 text-base font-black tabular-nums">{money(totalValue)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </TableShell>
          ) : null}
        </TabsContent>

        {/* ==================== تبويب سجل الحركات ==================== */}
        <TabsContent value="movements">
          <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="فلاتر حركات المخزون">
            <div className="space-y-1">
              <Label className="text-xs">المنتج</Label>
              <Select value={mvProductId || 'all'} onValueChange={v => { setMvProductId(v === 'all' ? '' : v); setMvPage(1) }}>
                <SelectTrigger className="h-10 w-52" aria-label="المنتج"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المنتجات</SelectItem>
                  {products.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">نوع الحركة</Label>
              <Select value={mvType || 'all'} onValueChange={v => { setMvType(v === 'all' ? '' : v); setMvPage(1) }}>
                <SelectTrigger className="h-10 w-44" aria-label="نوع الحركة"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {Object.entries(MOVEMENT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="mv-from" className="text-xs">من</Label>
              <Input id="mv-from" type="date" value={mvFrom} onChange={e => { setMvFrom(e.target.value); setMvPage(1) }} className="h-10" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mv-to" className="text-xs">إلى</Label>
              <Input id="mv-to" type="date" value={mvTo} onChange={e => { setMvTo(e.target.value); setMvPage(1) }} className="h-10" />
            </div>
          </div>

          {mvError ? <ErrorBanner message={mvError} onRetry={loadMovements} /> : null}

          {mvLoading && !mvRows ? (
            <LoadingRows rows={6} />
          ) : mvRows && mvRows.length === 0 ? (
            <EmptyState title="لا حركات مطابقة" hint="عدّل الفلاتر أو نفّذ عملية على المخزون لتظهر الحركات هنا." />
          ) : mvRows ? (
            <>
              <TableShell>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-cream-200">
                    <tr>
                      <th className="p-3 text-start font-semibold">الوقت</th>
                      <th className="p-3 text-start font-semibold">المنتج</th>
                      <th className="p-3 text-start font-semibold">النوع</th>
                      <th className="p-3 text-start font-semibold">الكمية</th>
                      <th className="p-3 text-start font-semibold">تكلفة الوحدة</th>
                      <th className="p-3 text-start font-semibold">المرجع</th>
                      <th className="p-3 text-start font-semibold">ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mvRows.map(m => (
                      <tr key={m.id} className="border-t transition-colors hover:bg-cream-100">
                        <td className="p-3 text-muted-foreground">{dateTime(m.date)}</td>
                        <td className="p-3 font-semibold">{m.product?.name ?? '—'}</td>
                        <td className="p-3">
                          <Badge variant={m.qtyMilli < 0 ? 'outline' : 'secondary'}>{MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</Badge>
                        </td>
                        <td className={cn('p-3 font-bold tabular-nums', m.qtyMilli > 0 ? 'text-ok-600' : m.qtyMilli < 0 ? 'text-destructive' : '')}>
                          {m.qtyMilli > 0 ? `+${fmtQty(m.qtyMilli)}` : m.qtyMilli < 0 ? `−${fmtQty(Math.abs(m.qtyMilli))}` : '0'} {m.product?.baseUnit ?? ''}
                        </td>
                        <td className="p-3 tabular-nums text-muted-foreground">{m.unitCostMinor !== null && m.unitCostMinor !== undefined ? fmtMoney(m.unitCostMinor) : '—'}</td>
                        <td className="p-3 text-xs text-muted-foreground">{m.refType ?? '—'}</td>
                        <td className="p-3 text-xs">{m.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground tabular-nums">
                  المجموع {mvTotal} — صفحة {mvPage} من {mvPages}
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="h-10" disabled={mvPage <= 1} onClick={() => setMvPage(p => p - 1)} aria-label="الصفحة السابقة">السابق</Button>
                  <Button type="button" variant="outline" className="h-10" disabled={mvPage >= mvPages} onClick={() => setMvPage(p => p + 1)} aria-label="الصفحة التالية">التالي</Button>
                </div>
              </div>
            </>
          ) : null}
        </TabsContent>

        {/* ==================== تبويب العمليات ==================== */}
        {anyOps ? (
          <TabsContent value="ops">
            <div className="grid gap-3 sm:grid-cols-3">
              {canOpening ? (
                <button
                  type="button"
                  onClick={() => { resetOpening(); setOpeningOpen(true) }}
                  className="flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-start shadow-sm transition-colors hover:bg-cream-100 focus-visible:ring-2 focus-visible:ring-copper-500"
                >
                  <PackageOpen className="h-6 w-6 text-copper-600" aria-hidden />
                  <span className="font-bold">رصيد افتتاحي</span>
                  <span className="text-xs text-muted-foreground">تسجيل رصيد بداية الموسم لمنتجات بلا حركات سابقة، مع تكلفة وحدة اختيارية.</span>
                </button>
              ) : null}
              {canAdjust ? (
                <button
                  type="button"
                  onClick={() => { resetAdjust(); setAdjustOpen(true) }}
                  className="flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-start shadow-sm transition-colors hover:bg-cream-100 focus-visible:ring-2 focus-visible:ring-copper-500"
                >
                  <ClipboardCheck className="h-6 w-6 text-copper-600" aria-hidden />
                  <span className="font-bold">جرد</span>
                  <span className="text-xs text-muted-foreground">إدخال الكمية الفعلية المعدودة — يُسجل الفرق كحركة تسوية موثقة.</span>
                </button>
              ) : null}
              {canWaste ? (
                <button
                  type="button"
                  onClick={() => { resetWaste(); setWasteOpen(true) }}
                  className="flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-start shadow-sm transition-colors hover:bg-cream-100 focus-visible:ring-2 focus-visible:ring-copper-500"
                >
                  <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
                  <span className="font-bold">إعدام تالف</span>
                  <span className="text-xs text-muted-foreground">إخراج كمية تالفة من المخزون بحركة تلف وهدر مع سبب إلزامي.</span>
                </button>
              ) : null}
            </div>
            {!canAdjust ? (
              <p className="mt-4 rounded-lg border border-copper-500/50 bg-copper-100/40 p-3 text-sm">
                لا تملك صلاحية بعض العمليات — تظهر لك البطاقات المتاحة فقط.
              </p>
            ) : null}
          </TabsContent>
        ) : null}
      </Tabs>

      {/* ===== حوار الرصيد الافتتاحي ===== */}
      <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>رصيد افتتاحي</DialogTitle>
            <DialogDescription>
              للمنتجات التي لم تُسجل لها أي حركات سابقة — لا يمكن تكرار الرصيد الافتتاحي.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>المنتج *</Label>
              <Select value={opProductId || undefined} onValueChange={setOpProductId}>
                <SelectTrigger className="h-10 w-full" aria-label="منتج الرصيد الافتتاحي">
                  <SelectValue placeholder={productsWithoutMovements.length ? 'اختر منتجًا' : 'لا منتجات متاحة'} />
                </SelectTrigger>
                <SelectContent>
                  {productsWithoutMovements.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.baseUnit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {productsWithoutMovements.length === 0 ? (
                <p className="text-xs text-muted-foreground">كل المنتجات النشطة لها حركات سابقة أو لا منتجات — لا يمكن تسجيل افتتاحي.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-qty">الكمية ({products.find(p => p.id === opProductId)?.baseUnit ?? 'الوحدة'}) *</Label>
              <Input id="op-qty" inputMode="decimal" value={opQty} onChange={e => setOpQty(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-cost">تكلفة الوحدة (اختياري)</Label>
              <Input id="op-cost" inputMode="decimal" value={opCost} onChange={e => setOpCost(e.target.value)} className="h-10 tabular-nums" placeholder="تُحدَّث تكلفة المنتج إن أُدخلت" autoComplete="off" />
            </div>
          </div>
          {opError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{opError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setOpeningOpen(false)} disabled={opBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitOpening()} disabled={opBusy || !opProductId}>
              {opBusy ? 'جارٍ التسجيل…' : 'تسجيل الرصيد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار الجرد ===== */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>جرد المخزون</DialogTitle>
            <DialogDescription>
              أدخل الكمية الفعلية المعدودة فعليًا — يُسجل الفرق عن الرصيد الدفتري كحركة تسوية موثقة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>المنتج *</Label>
              <Select value={adProductId || undefined} onValueChange={setAdProductId}>
                <SelectTrigger className="h-10 w-full" aria-label="منتج الجرد"><SelectValue placeholder="اختر منتجًا" /></SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — الدفتري: {fmtQty(p.stockMilli ?? 0)} {p.baseUnit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-counted">الكمية الفعلية المعدودة ({adProduct?.baseUnit ?? 'الوحدة'}) *</Label>
              <Input id="ad-counted" inputMode="decimal" value={adCounted} onChange={e => setAdCounted(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
              {adProduct ? (
                <p className="text-xs text-muted-foreground">الرصيد الدفتري الحالي: <b className="tabular-nums">{fmtQty(adProduct.stockMilli ?? 0)} {adProduct.baseUnit}</b></p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-reason">سبب الجرد *</Label>
              <Textarea id="ad-reason" value={adReason} onChange={e => setAdReason(e.target.value)} rows={2} placeholder="مثال: جرد نهاية الشهر" />
            </div>
          </div>
          {adError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{adError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setAdjustOpen(false)} disabled={adBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitAdjust()} disabled={adBusy || !adProductId || !adReason.trim()}>
              {adBusy ? 'جارٍ التنفيذ…' : 'تنفيذ الجرد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار الإعدام ===== */}
      <Dialog open={wasteOpen} onOpenChange={setWasteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>إعدام تالف</DialogTitle>
            <DialogDescription>
              تُخرج الكمية من المخزون بحركة «تلف وهدر» — لا يمكن التراجع إلا بحركة جرد موثقة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>المنتج *</Label>
              <Select value={waProductId || undefined} onValueChange={setWaProductId}>
                <SelectTrigger className="h-10 w-full" aria-label="منتج الإعدام"><SelectValue placeholder="اختر منتجًا" /></SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — المتاح: {fmtQty(p.stockMilli ?? 0)} {p.baseUnit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-qty">الكمية ({products.find(p => p.id === waProductId)?.baseUnit ?? 'الوحدة'}) *</Label>
              <Input id="wa-qty" inputMode="decimal" value={waQty} onChange={e => setWaQty(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-reason">سبب الإعدام *</Label>
              <Textarea id="wa-reason" value={waReason} onChange={e => setWaReason(e.target.value)} rows={2} placeholder="مثال: عفن دفعة الخبز المسائية" />
            </div>
          </div>
          {waError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{waError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setWasteOpen(false)} disabled={waBusy}>إلغاء</Button>
            <Button type="button" variant="destructive" className="h-10" onClick={() => void submitWaste()} disabled={waBusy || !waProductId || !waReason.trim()}>
              {waBusy ? 'جارٍ التنفيذ…' : 'تنفيذ الإعدام'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

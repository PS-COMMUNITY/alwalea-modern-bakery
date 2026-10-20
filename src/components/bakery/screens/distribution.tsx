'use client'

// =============================================================
// التوزيع والمندوبون — مندوبون وخطوط سير، جولات بعهدة، بيع من العهدة،
// مرتجعات (صالح/تالف)، وتسوية ترحّل المبيعات كفواتير حقيقية
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Customer, Product } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, TableShell,
  money as fmtMoney, qty as fmtQty,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  AlertTriangle, Bus, ChevronsUpDown, Plus, Route, Trash2, Truck, UserRound,
} from 'lucide-react'

type ProductRow = Product & { stockMilli?: number; priceMinor: number }

type Rep = { id: string; name: string; phone: string | null; active: boolean; routes?: { id: string; name: string; active: boolean }[] }
type RouteRow = { id: string; name: string; active: boolean; repId: string | null; rep?: { id: string; name: string; active: boolean } | null }

type TripListItem = {
  id: string
  tripNo: string
  date: string
  status: 'OPEN' | 'SETTLED'
  settledAt: string | null
  notes: string | null
  rep: { id: string; name: string }
  route: { id: string; name: string } | null
  loadedMilli: number
  soldMilli: number
  returnedGoodMilli: number
  returnedDamagedMilli: number
  cashMinor: number
  creditMinor: number
  loadsCount: number
  salesCount: number
  returnsCount: number
}

type TripLoad = { id: string; productId: string; qtyMilli: number; product: { id: string; name: string; baseUnit: string } }
type TripSale = {
  id: string
  productId: string
  qtyMilli: number
  priceMinor: number
  lineTotalMinor: number
  paymentType: 'CASH' | 'CREDIT'
  customerName: string
  product: { id: string; name: string; baseUnit: string }
}
type TripReturn = {
  id: string
  productId: string
  qtyMilli: number
  condition: 'GOOD' | 'DAMAGED'
  note: string | null
  product: { id: string; name: string; baseUnit: string }
}

type TripDetail = {
  trip: TripListItem & { userId: string }
  loads: TripLoad[]
  sales: TripSale[]
  returns: TripReturn[]
  computed: {
    perProduct: { productId: string; productName: string; baseUnit: string; loadedMilli: number; soldMilli: number; returnedGoodMilli: number; returnedDamagedMilli: number; remainingMilli: number }[]
    loadedMilli: number
    soldMilli: number
    returnedGoodMilli: number
    returnedDamagedMilli: number
    remainingMilli: number
    cashCollectedMinor: number
    creditTotalMinor: number
    totalCollectedMinor: number
  }
}

type SettleSummary = {
  tripNo: string
  salesCount: number
  cashCollectedMinor: number
  creditTotalMinor: number
  returnedGoodMilli: number
  returnedDamagedMilli: number
  cashRecordedToShift: boolean
  warning?: string
}

type DraftLoad = { key: number; productId: string; qty: string }
type DraftSaleItem = { key: number; productId: string; qty: string; price: string }

let draftKey = 1
const nextKey = () => draftKey++

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

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 29)
  return fmtISO(d)
}

export function DistributionScreen() {
  const { money, can } = useSession()
  const { toast } = useToast()
  const canManage = can('distribution.manage')

  // ===== المندوبون وخطوط السير =====
  const [reps, setReps] = useState<Rep[]>([])
  const [repsLoading, setRepsLoading] = useState(true)
  const [repsError, setRepsError] = useState('')
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [routesLoading, setRoutesLoading] = useState(true)
  const [routesError, setRoutesError] = useState('')

  const [repDlgOpen, setRepDlgOpen] = useState(false)
  const [editingRep, setEditingRep] = useState<Rep | null>(null)
  const [repForm, setRepForm] = useState({ name: '', phone: '', active: true })
  const [repBusy, setRepBusy] = useState(false)

  const [routeDlgOpen, setRouteDlgOpen] = useState(false)
  const [editingRoute, setEditingRoute] = useState<RouteRow | null>(null)
  const [routeForm, setRouteForm] = useState({ name: '', repId: '', active: true })
  const [routeBusy, setRouteBusy] = useState(false)

  // ===== الجولات =====
  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(fmtISO(new Date()))
  const [fRepId, setFRepId] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [trips, setTrips] = useState<TripListItem[] | null>(null)
  const [tripsLoading, setTripsLoading] = useState(true)
  const [tripsError, setTripsError] = useState('')

  // ===== جولة جديدة =====
  const [newOpen, setNewOpen] = useState(false)
  const [nRepId, setNRepId] = useState('')
  const [nRouteId, setNRouteId] = useState('')
  const [nLoads, setNLoads] = useState<DraftLoad[]>([])
  const [nBusy, setNBusy] = useState(false)
  const [nError, setNError] = useState('')

  // ===== تفاصيل الجولة =====
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  // ===== تسجيل بيع =====
  const [saleOpen, setSaleOpen] = useState(false)
  const [saleItems, setSaleItems] = useState<DraftSaleItem[]>([])
  const [saleType, setSaleType] = useState<'CASH' | 'CREDIT'>('CASH')
  const [custOpen, setCustOpen] = useState(false)
  const [custQuery, setCustQuery] = useState('')
  const [custList, setCustList] = useState<Customer[]>([])
  const [saleCustomer, setSaleCustomer] = useState<Customer | null>(null)
  const [saleBusy, setSaleBusy] = useState(false)
  const [saleError, setSaleError] = useState('')

  // ===== تسجيل مرتجع =====
  const [retOpen, setRetOpen] = useState(false)
  const [retProductId, setRetProductId] = useState('')
  const [retQty, setRetQty] = useState('')
  const [retCondition, setRetCondition] = useState<'GOOD' | 'DAMAGED'>('GOOD')
  const [retNote, setRetNote] = useState('')
  const [retBusy, setRetBusy] = useState(false)
  const [retError, setRetError] = useState('')

  // ===== تسوية =====
  const [settleOpen, setSettleOpen] = useState(false)
  const [settleCash, setSettleCash] = useState('')
  const [settleNotes, setSettleNotes] = useState('')
  const [settleBusy, setSettleBusy] = useState(false)
  const [settleSummary, setSettleSummary] = useState<SettleSummary | null>(null)

  // ===== تحميل البيانات =====
  const loadReps = useCallback(async () => {
    setRepsLoading(true)
    setRepsError('')
    try {
      const res = await api.get<Rep[]>('/api/distribution/reps')
      setReps(res)
    } catch (e) {
      setRepsError(e instanceof ApiError ? e.message : 'تعذر تحميل المندوبين')
    } finally {
      setRepsLoading(false)
    }
  }, [])

  const loadRoutes = useCallback(async () => {
    setRoutesLoading(true)
    setRoutesError('')
    try {
      const res = await api.get<RouteRow[]>('/api/distribution/routes')
      setRoutes(res)
    } catch (e) {
      setRoutesError(e instanceof ApiError ? e.message : 'تعذر تحميل خطوط السير')
    } finally {
      setRoutesLoading(false)
    }
  }, [])

  const loadTrips = useCallback(async () => {
    setTripsLoading(true)
    setTripsError('')
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (fRepId) params.set('repId', fRepId)
      if (fStatus) params.set('status', fStatus)
      const res = await api.get<TripListItem[]>(`/api/distribution/trips?${params.toString()}`)
      setTrips(res)
    } catch (e) {
      setTripsError(e instanceof ApiError ? e.message : 'تعذر تحميل الجولات')
      setTrips(null)
    } finally {
      setTripsLoading(false)
    }
  }, [from, fRepId, fStatus, to])

  useEffect(() => {
    void loadReps()
    void loadRoutes()
  }, [loadReps, loadRoutes])

  useEffect(() => {
    void loadTrips()
  }, [loadTrips])

  // منتجات للمخزون والأسعار الافتراضية
  const [products, setProducts] = useState<ProductRow[]>([])
  const [inventory, setInventory] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [prods, inv] = await Promise.all([
          api.get<{ items: ProductRow[]; total: number }>('/api/products?active=true'),
          api.get<{ items: { productId: string; qtyMilli: number }[]; total: number }>('/api/inventory'),
        ])
        if (!cancelled) {
          setProducts(prods.items)
          setInventory(new Map(inv.items.map(x => [x.productId, x.qtyMilli])))
        }
      } catch {
        // اختياري
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ===== المندوبون =====
  async function submitRep() {
    const name = repForm.name.trim()
    if (!name) return
    setRepBusy(true)
    try {
      if (editingRep) {
        await api.put(`/api/distribution/reps/${editingRep.id}`, {
          name,
          phone: repForm.phone.trim() || null,
          active: repForm.active,
        })
        toast({ title: 'تم حفظ بيانات المندوب' })
      } else {
        await api.post('/api/distribution/reps', { name, phone: repForm.phone.trim() || undefined })
        toast({ title: `تم إضافة المندوب «${name}»` })
      }
      setRepDlgOpen(false)
      void loadReps()
    } catch (e) {
      toast({
        title: 'تعذر حفظ المندوب',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setRepBusy(false)
    }
  }

  // ===== خطوط السير =====
  async function submitRoute() {
    const name = routeForm.name.trim()
    if (!name) return
    setRouteBusy(true)
    try {
      if (editingRoute) {
        await api.put(`/api/distribution/routes/${editingRoute.id}`, {
          name,
          repId: routeForm.repId || null,
          active: routeForm.active,
        })
        toast({ title: 'تم حفظ خط السير' })
      } else {
        await api.post('/api/distribution/routes', { name, repId: routeForm.repId || undefined })
        toast({ title: `تم إضافة خط السير «${name}»` })
      }
      setRouteDlgOpen(false)
      void loadRoutes()
    } catch (e) {
      toast({
        title: 'تعذر حفظ خط السير',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setRouteBusy(false)
    }
  }

  // ===== جولة جديدة =====
  function openNewTrip() {
    setNRepId('')
    setNRouteId('')
    setNLoads([{ key: nextKey(), productId: '', qty: '' }])
    setNError('')
    setNewOpen(true)
  }

  const nLoadsValid = nLoads.map(l => ({ productId: l.productId, qtyMilli: toMilliSafe(l.qty) ?? 0 }))

  async function submitNewTrip() {
    setNError('')
    if (!nRepId) {
      setNError('اختر المندوب')
      return
    }
    const loads = nLoadsValid.filter(l => l.productId && l.qtyMilli > 0)
    if (loads.length === 0) {
      setNError('أضف تحميلة واحدة على الأقل بكمية صحيحة')
      return
    }
    setNBusy(true)
    try {
      const trip = await api.post<TripListItem>('/api/distribution/trips', {
        repId: nRepId,
        routeId: nRouteId || undefined,
        loads,
      })
      toast({ title: `فُتحت الجولة ${trip.tripNo}`, description: 'خرجت التحميلات من المخزون إلى عهدة المندوب (TRIP_OUT).' })
      setNewOpen(false)
      void loadTrips()
    } catch (e) {
      setNError(e instanceof ApiError ? e.message : 'تعذر فتح الجولة')
    } finally {
      setNBusy(false)
    }
  }

  // ===== تفاصيل الجولة =====
  async function openDetail(id: string) {
    setDetailId(id)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    setSettleSummary(null)
    try {
      setDetail(await api.get<TripDetail>(`/api/distribution/trips/${id}`))
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : 'تعذر تحميل الجولة')
    } finally {
      setDetailLoading(false)
    }
  }

  // ===== تسجيل بيع =====
  function openSale() {
    setSaleItems([{ key: nextKey(), productId: '', qty: '', price: '' }])
    setSaleType('CASH')
    setSaleCustomer(null)
    setSaleError('')
    setSaleOpen(true)
  }

  useEffect(() => {
    if (!custOpen) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: Customer[]; total: number }>(`/api/customers?active=true&q=${encodeURIComponent(custQuery.trim())}`)
        if (!cancelled) setCustList(res.items)
      } catch {
        if (!cancelled) setCustList([])
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [custOpen, custQuery])

  async function submitSale() {
    if (!detail) return
    setSaleError('')
    const items = saleItems
      .map(it => {
        const qtyMilli = toMilliSafe(it.qty) ?? 0
        const priceMinor = toMinorSafe(it.price) ?? 0
        return { productId: it.productId, qtyMilli, priceMinor }
      })
      .filter(it => it.productId && it.qtyMilli > 0 && it.priceMinor >= 0)
    if (items.length === 0) {
      setSaleError('أضف بندًا واحدًا على الأقل بمنتج وكمية وسعر صحيحين')
      return
    }
    if (saleType === 'CREDIT' && !saleCustomer) {
      setSaleError('البيع الآجل يتطلب اختيار عميل')
      return
    }
    setSaleBusy(true)
    try {
      await api.post(`/api/distribution/trips/${detail.trip.id}/sales`, {
        items: items.map(it => ({
          ...it,
          paymentType: saleType,
          customerId: saleType === 'CREDIT' ? saleCustomer!.id : undefined,
        })),
      })
      toast({ title: 'تم تسجيل البيع على الجولة', description: 'البيع من العهدة — لا يؤثر على المخزون الآن، ويُرحّل عند التسوية.' })
      setSaleOpen(false)
      await openDetail(detail.trip.id)
      void loadTrips()
    } catch (e) {
      setSaleError(e instanceof ApiError ? e.message : 'تعذر تسجيل البيع')
    } finally {
      setSaleBusy(false)
    }
  }

  // ===== تسجيل مرتجع =====
  function openReturn() {
    setRetProductId('')
    setRetQty('')
    setRetCondition('GOOD')
    setRetNote('')
    setRetError('')
    setRetOpen(true)
  }

  async function submitReturn() {
    if (!detail) return
    setRetError('')
    if (!retProductId) {
      setRetError('اختر المنتج من حمولة الجولة')
      return
    }
    const qtyMilli = toMilliSafe(retQty)
    if (qtyMilli === null || qtyMilli <= 0) {
      setRetError('أدخل كمية صحيحة أكبر من صفر')
      return
    }
    setRetBusy(true)
    try {
      await api.post(`/api/distribution/trips/${detail.trip.id}/returns`, {
        items: [{ productId: retProductId, qtyMilli, condition: retCondition, note: retNote.trim() || undefined }],
      })
      toast({ title: 'تم تسجيل المرتجع', description: retCondition === 'GOOD' ? 'المرتجع الصالح يعود للمخزون عند التسوية.' : 'التالف لا يعود للمخزون — يُوثق عند التسوية.' })
      setRetOpen(false)
      await openDetail(detail.trip.id)
      void loadTrips()
    } catch (e) {
      setRetError(e instanceof ApiError ? e.message : 'تعذر تسجيل المرتجع')
    } finally {
      setRetBusy(false)
    }
  }

  // ===== تسوية الجولة =====
  function openSettle() {
    setSettleCash('')
    setSettleNotes('')
    setSettleOpen(true)
  }

  async function submitSettle() {
    if (!detail) return
    const counted = toMinorSafe(settleCash)
    if (settleCash.trim() !== '' && counted === null) {
      toast({ title: 'النقد المعدود غير صالح', variant: 'destructive' })
      return
    }
    setSettleBusy(true)
    try {
      const res = await api.post<SettleSummary>(`/api/distribution/trips/${detail.trip.id}/settle`, {
        countedCashMinor: counted ?? undefined,
        notes: settleNotes.trim() || undefined,
      })
      setSettleOpen(false)
      setSettleSummary(res)
      toast({
        title: `تمت تسوية الجولة ${res.tripNo}`,
        description: `${res.salesCount} فاتورة مُنشأة — نقد للصندوق ${money(res.cashCollectedMinor)} وآجل للعملاء ${money(res.creditTotalMinor)}${res.warning ? ` — ${res.warning}` : ''}`,
      })
      await openDetail(detail.trip.id)
      void loadTrips()
    } catch (e) {
      toast({
        title: 'تعذر التسوية',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setSettleBusy(false)
    }
  }

  const detailIsOpen = detail?.trip.status === 'OPEN'

  return (
    <div>
      <PageHeader
        title="التوزيع والمندوبون"
        subtitle="جولات التوزيع بعهدة — البيع من العهدة ويُرحّل كفواتير عند التسوية"
        actions={canManage ? (
          <Button type="button" className="h-10" onClick={openNewTrip}>
            <Plus className="h-4 w-4" aria-hidden />
            جولة جديدة
          </Button>
        ) : null}
      />

      <Tabs defaultValue="trips">
        <TabsList className="mb-4 h-11">
          <TabsTrigger value="trips" className="gap-2 px-4">
            <Route className="h-4 w-4" aria-hidden />
            الجولات
          </TabsTrigger>
          <TabsTrigger value="reps" className="gap-2 px-4">
            <Truck className="h-4 w-4" aria-hidden />
            المندوبون وخطوط السير
          </TabsTrigger>
        </TabsList>

        {/* ==================== الجولات ==================== */}
        <TabsContent value="trips">
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="trp-from" className="text-xs">من</Label>
              <Input id="trp-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="trp-to" className="text-xs">إلى</Label>
              <Input id="trp-to" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">المندوب</Label>
              <Select value={fRepId || 'all'} onValueChange={v => setFRepId(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-10 w-44" aria-label="المندوب"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {reps.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الحالة</Label>
              <Select value={fStatus || 'all'} onValueChange={v => setFStatus(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-10 w-36" aria-label="حالة الجولة"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="OPEN">مفتوحة</SelectItem>
                  <SelectItem value="SETTLED">مُسواة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {tripsError ? <ErrorBanner message={tripsError} onRetry={loadTrips} /> : null}

          {tripsLoading && !trips ? (
            <LoadingRows rows={6} />
          ) : trips && trips.length === 0 ? (
            <EmptyState
              title="لا جولات في هذه الفترة"
              hint="افتح جولة جديدة وحمّل المنتجات على عهدة المندوب."
              action={canManage ? (
                <Button type="button" className="mt-2 h-10" onClick={openNewTrip}>
                  <Plus className="h-4 w-4" aria-hidden />
                  جولة جديدة
                </Button>
              ) : undefined}
            />
          ) : trips ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">رقم الجولة</th>
                    <th className="p-3 text-start font-semibold">التاريخ</th>
                    <th className="p-3 text-start font-semibold">المندوب</th>
                    <th className="p-3 text-start font-semibold">خط السير</th>
                    <th className="p-3 text-start font-semibold">محمّل</th>
                    <th className="p-3 text-start font-semibold">مبيع</th>
                    <th className="p-3 text-start font-semibold">نقد</th>
                    <th className="p-3 text-start font-semibold">آجل</th>
                    <th className="p-3 text-start font-semibold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map(t => (
                    <tr
                      key={t.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`تفاصيل الجولة ${t.tripNo}`}
                      onClick={() => void openDetail(t.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openDetail(t.id) } }}
                      className="cursor-pointer border-t transition-colors hover:bg-cream-100 focus-visible:bg-cream-100"
                    >
                      <td className="p-3 font-mono text-xs" dir="ltr">{t.tripNo}</td>
                      <td className="p-3 text-muted-foreground">{dateTime(t.date)}</td>
                      <td className="p-3 font-semibold">{t.rep.name}</td>
                      <td className="p-3">{t.route?.name ?? '—'}</td>
                      <td className="p-3 tabular-nums">{fmtQty(t.loadedMilli)}</td>
                      <td className="p-3 tabular-nums">{fmtQty(t.soldMilli)}</td>
                      <td className="p-3 tabular-nums">{money(t.cashMinor)}</td>
                      <td className="p-3 tabular-nums">{money(t.creditMinor)}</td>
                      <td className="p-3">
                        {t.status === 'OPEN' ? (
                          <Badge className="bg-copper-500 text-white gap-1"><span aria-hidden>◐</span> مفتوحة</Badge>
                        ) : (
                          <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مُسواة</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : null}
        </TabsContent>

        {/* ==================== المندوبون وخطوط السير ==================== */}
        <TabsContent value="reps">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* المندوبون */}
            <section aria-label="المندوبون">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold">المندوبون</h2>
                {canManage ? (
                  <Button type="button" variant="outline" className="h-10" onClick={() => { setEditingRep(null); setRepForm({ name: '', phone: '', active: true }); setRepDlgOpen(true) }}>
                    <Plus className="h-4 w-4" aria-hidden />
                    مندوب جديد
                  </Button>
                ) : null}
              </div>
              {repsError ? <ErrorBanner message={repsError} onRetry={loadReps} /> : null}
              {repsLoading ? (
                <LoadingRows rows={3} />
              ) : reps.length === 0 ? (
                <EmptyState title="لا مندوبين بعد" hint="أضف مندوبًا لبدء جولات التوزيع." />
              ) : (
                <TableShell>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-cream-200">
                      <tr>
                        <th className="p-3 text-start font-semibold">الاسم</th>
                        <th className="p-3 text-start font-semibold">الهاتف</th>
                        <th className="p-3 text-start font-semibold">خطوطه</th>
                        <th className="p-3 text-start font-semibold">الحالة</th>
                        {canManage ? <th className="p-3 text-start font-semibold">إجراءات</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {reps.map(r => (
                        <tr key={r.id} className="border-t transition-colors hover:bg-cream-100">
                          <td className="p-3 font-semibold">{r.name}</td>
                          <td className="p-3 tabular-nums" dir="ltr">{r.phone ?? '—'}</td>
                          <td className="p-3 text-xs">{(r.routes ?? []).filter(x => x.active).map(x => x.name).join('، ') || '—'}</td>
                          <td className="p-3">
                            {r.active ? (
                              <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مفعّل</Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1"><span aria-hidden>⏸</span> معطّل</Badge>
                            )}
                          </td>
                          {canManage ? (
                            <td className="p-3">
                              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => { setEditingRep(r); setRepForm({ name: r.name, phone: r.phone ?? '', active: r.active }); setRepDlgOpen(true) }} aria-label={`تعديل ${r.name}`}>
                                تعديل
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </section>

            {/* خطوط السير */}
            <section aria-label="خطوط السير">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold">خطوط السير</h2>
                {canManage ? (
                  <Button type="button" variant="outline" className="h-10" onClick={() => { setEditingRoute(null); setRouteForm({ name: '', repId: '', active: true }); setRouteDlgOpen(true) }}>
                    <Plus className="h-4 w-4" aria-hidden />
                    خط جديد
                  </Button>
                ) : null}
              </div>
              {routesError ? <ErrorBanner message={routesError} onRetry={loadRoutes} /> : null}
              {routesLoading ? (
                <LoadingRows rows={3} />
              ) : routes.length === 0 ? (
                <EmptyState title="لا خطوط سير بعد" hint="خط السير يجمّع مناطق المندوب (مثال: الصباح — الشمال)." />
              ) : (
                <TableShell>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-cream-200">
                      <tr>
                        <th className="p-3 text-start font-semibold">الاسم</th>
                        <th className="p-3 text-start font-semibold">المندوب</th>
                        <th className="p-3 text-start font-semibold">الحالة</th>
                        {canManage ? <th className="p-3 text-start font-semibold">إجراءات</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {routes.map(rt => (
                        <tr key={rt.id} className="border-t transition-colors hover:bg-cream-100">
                          <td className="p-3 font-semibold">{rt.name}</td>
                          <td className="p-3">{rt.rep?.name ?? '—'}</td>
                          <td className="p-3">
                            {rt.active ? (
                              <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مفعّل</Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1"><span aria-hidden>⏸</span> معطّل</Badge>
                            )}
                          </td>
                          {canManage ? (
                            <td className="p-3">
                              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => { setEditingRoute(rt); setRouteForm({ name: rt.name, repId: rt.repId ?? '', active: rt.active }); setRouteDlgOpen(true) }} aria-label={`تعديل ${rt.name}`}>
                                تعديل
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </section>
          </div>
        </TabsContent>
      </Tabs>

      {/* ===== حوار مندوب ===== */}
      <Dialog open={repDlgOpen} onOpenChange={setRepDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingRep ? 'تعديل مندوب' : 'مندوب جديد'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rep-name">الاسم *</Label>
              <Input id="rep-name" value={repForm.name} onChange={e => setRepForm(f => ({ ...f, name: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-phone">الهاتف</Label>
              <Input id="rep-phone" value={repForm.phone} onChange={e => setRepForm(f => ({ ...f, phone: e.target.value }))} className="h-10" dir="ltr" autoComplete="off" />
            </div>
            {editingRep ? (
              <div className="flex items-center gap-2">
                <Switch id="rep-active" checked={repForm.active} onCheckedChange={v => setRepForm(f => ({ ...f, active: v }))} />
                <Label htmlFor="rep-active">مفعّل</Label>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setRepDlgOpen(false)} disabled={repBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitRep()} disabled={repBusy || !repForm.name.trim()}>
              {repBusy ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار خط سير ===== */}
      <Dialog open={routeDlgOpen} onOpenChange={setRouteDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingRoute ? 'تعديل خط السير' : 'خط سير جديد'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="route-name">الاسم *</Label>
              <Input id="route-name" value={routeForm.name} onChange={e => setRouteForm(f => ({ ...f, name: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>المندوب (اختياري)</Label>
              <Select value={routeForm.repId || '__none__'} onValueChange={v => setRouteForm(f => ({ ...f, repId: v === '__none__' ? '' : v }))}>
                <SelectTrigger className="h-10 w-full" aria-label="المندوب"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">بدون مندوب</SelectItem>
                  {reps.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editingRoute ? (
              <div className="flex items-center gap-2">
                <Switch id="route-active" checked={routeForm.active} onCheckedChange={v => setRouteForm(f => ({ ...f, active: v }))} />
                <Label htmlFor="route-active">مفعّل</Label>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setRouteDlgOpen(false)} disabled={routeBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitRoute()} disabled={routeBusy || !routeForm.name.trim()}>
              {routeBusy ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== جولة جديدة ===== */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>جولة توزيع جديدة</DialogTitle>
            <DialogDescription>
              التحميلات تخرج من المخزون إلى عهدة المندوب — يحتاج المندوب قفلها بمرتجعات قبل التسوية.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>المندوب *</Label>
                <Select value={nRepId || undefined} onValueChange={setNRepId}>
                  <SelectTrigger className="h-10 w-full" aria-label="المندوب"><SelectValue placeholder="اختر مندوبًا" /></SelectTrigger>
                  <SelectContent>
                    {reps.filter(r => r.active).map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>خط السير (اختياري)</Label>
                <Select value={nRouteId || '__none__'} onValueChange={v => setNRouteId(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-10 w-full" aria-label="خط السير"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">بدون خط</SelectItem>
                    {routes.filter(rt => rt.active).map(rt => (
                      <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold">التحميلات *</Label>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setNLoads(v => [...v, { key: nextKey(), productId: '', qty: '' }])}>
                  <Plus className="h-4 w-4" aria-hidden />
                  أضف تحميلة
                </Button>
              </div>
              {nLoads.map((l, idx) => {
                const qty = toMilliSafe(l.qty) ?? 0
                const avail = inventory.get(l.productId) ?? 0
                const insufficient = !!l.productId && qty > avail
                return (
                  <div key={l.key} className="grid grid-cols-2 items-end gap-2 rounded-xl border bg-cream-100/40 p-2.5 sm:grid-cols-[1fr_130px_40px]">
                    <div className="col-span-2 space-y-1 sm:col-span-1">
                      <Label className="text-xs">المنتج {idx + 1}</Label>
                      <Select value={l.productId || undefined} onValueChange={v => setNLoads(list => list.map(x => x.key === l.key ? { ...x, productId: v } : x))}>
                        <SelectTrigger className="h-10 w-full" aria-label="منتج التحميلة"><SelectValue placeholder="اختر منتجًا" /></SelectTrigger>
                        <SelectContent>
                          {products.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name} — المتاح: {fmtQty(inventory.get(p.id) ?? 0)} {p.baseUnit}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">الكمية</Label>
                      <Input inputMode="decimal" value={l.qty} onChange={e => setNLoads(list => list.map(x => x.key === l.key ? { ...x, qty: e.target.value } : x))} className="h-10 tabular-nums" autoComplete="off" aria-label="كمية التحميلة" />
                      {insufficient ? (
                        <p className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" aria-hidden />المتاح {fmtQty(avail)} فقط — سيرفض الخادم</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-10 text-destructive hover:text-destructive"
                      onClick={() => setNLoads(list => list.filter(x => x.key !== l.key))}
                      disabled={nLoads.length <= 1}
                      aria-label="إزالة التحميلة"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>

          {nError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{nError}</p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setNewOpen(false)} disabled={nBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitNewTrip()} disabled={nBusy || !nRepId}>
              {nBusy ? 'جارٍ الفتح…' : 'فتح الجولة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تفاصيل الجولة ===== */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Route className="h-5 w-5 text-copper-600" aria-hidden />
              جولة <span className="font-mono text-sm" dir="ltr">{detail?.trip.tripNo ?? '…'}</span>
              {detail ? (
                detail.trip.status === 'OPEN'
                  ? <Badge className="bg-copper-500 text-white">مفتوحة</Badge>
                  : <Badge className="bg-ok-600 text-white">مُسواة</Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `${dateTime(detail.trip.date)} — ${detail.trip.rep.name}${detail.trip.route ? ` — ${detail.trip.route.name}` : ''}${detail.trip.settledAt ? ` — سُوّت ${dateTime(detail.trip.settledAt)}` : ''}`
                : 'جارٍ التحميل…'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? <LoadingRows rows={4} /> : null}
          {detailError ? <ErrorBanner message={detailError} onRetry={detailId ? () => void openDetail(detailId) : undefined} /> : null}

          {detail ? (
            <div className="space-y-4">
              {/* ملخص */}
              <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cream-100/60 p-3 text-sm sm:grid-cols-4">
                <div><span className="block text-xs text-muted-foreground">المحمّل</span><b className="tabular-nums">{fmtQty(detail.computed.loadedMilli)}</b></div>
                <div><span className="block text-xs text-muted-foreground">المبيع</span><b className="tabular-nums">{fmtQty(detail.computed.soldMilli)}</b></div>
                <div><span className="block text-xs text-muted-foreground">نقد محصّل</span><b className="tabular-nums">{money(detail.computed.cashCollectedMinor)}</b></div>
                <div><span className="block text-xs text-muted-foreground">آجل للعملاء</span><b className="tabular-nums">{money(detail.computed.creditTotalMinor)}</b></div>
              </div>

              {/* جدول المطابقة لكل منتج */}
              <div className="overflow-hidden rounded-xl border">
                <div className="nice-scroll max-h-56 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-cream-200">
                      <tr>
                        <th className="p-2.5 text-start font-semibold">المنتج</th>
                        <th className="p-2.5 text-start font-semibold">محمّل</th>
                        <th className="p-2.5 text-start font-semibold">مبيع</th>
                        <th className="p-2.5 text-start font-semibold">مرتجع صالح</th>
                        <th className="p-2.5 text-start font-semibold">تالف</th>
                        <th className="p-2.5 text-start font-semibold">متبقي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.computed.perProduct.map(r => (
                        <tr key={r.productId} className="border-t">
                          <td className="p-2.5 font-semibold">{r.productName}</td>
                          <td className="p-2.5 tabular-nums">{fmtQty(r.loadedMilli)}</td>
                          <td className="p-2.5 tabular-nums">{fmtQty(r.soldMilli)}</td>
                          <td className="p-2.5 tabular-nums text-ok-600">{fmtQty(r.returnedGoodMilli)}</td>
                          <td className="p-2.5 tabular-nums text-destructive">{fmtQty(r.returnedDamagedMilli)}</td>
                          <td className={cn('p-2.5 font-bold tabular-nums', r.remainingMilli > 0 ? 'text-destructive' : '')}>{fmtQty(r.remainingMilli)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {detail.computed.remainingMilli > 0 && detailIsOpen ? (
                <p className="flex items-center gap-2 rounded-lg border border-copper-500/50 bg-copper-100/40 p-2.5 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  توجد كميات متبقية ({fmtQty(detail.computed.remainingMilli)}) — سجّلها كلها كمرتجعات قبل التسوية.
                </p>
              ) : null}

              {/* المبيعات المسجلة */}
              <div>
                <h3 className="mb-2 text-sm font-bold">المبيعات المسجلة ({detail.sales.length})</h3>
                {detail.sales.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا مبيعات بعد.</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border">
                    <div className="nice-scroll max-h-44 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-cream-200">
                          <tr>
                            <th className="p-2.5 text-start font-semibold">المنتج</th>
                            <th className="p-2.5 text-start font-semibold">الكمية</th>
                            <th className="p-2.5 text-start font-semibold">السعر</th>
                            <th className="p-2.5 text-start font-semibold">العميل</th>
                            <th className="p-2.5 text-start font-semibold">النوع</th>
                            <th className="p-2.5 text-start font-semibold">الإجمالي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.sales.map(s => (
                            <tr key={s.id} className="border-t">
                              <td className="p-2.5">{s.product.name}</td>
                              <td className="p-2.5 tabular-nums">{fmtQty(s.qtyMilli)} {s.product.baseUnit}</td>
                              <td className="p-2.5 tabular-nums">{money(s.priceMinor)}</td>
                              <td className="p-2.5 text-xs">{s.customerName}</td>
                              <td className="p-2.5">
                                <Badge variant={s.paymentType === 'CASH' ? 'secondary' : 'outline'}>{s.paymentType === 'CASH' ? 'نقدي' : 'آجل'}</Badge>
                              </td>
                              <td className="p-2.5 font-semibold tabular-nums">{money(s.lineTotalMinor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* المرتجعات */}
              <div>
                <h3 className="mb-2 text-sm font-bold">المرتجعات ({detail.returns.length})</h3>
                {detail.returns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا مرتجعات بعد.</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border">
                    <div className="nice-scroll max-h-44 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-cream-200">
                          <tr>
                            <th className="p-2.5 text-start font-semibold">المنتج</th>
                            <th className="p-2.5 text-start font-semibold">الكمية</th>
                            <th className="p-2.5 text-start font-semibold">الحالة</th>
                            <th className="p-2.5 text-start font-semibold">ملاحظة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.returns.map(rt => (
                            <tr key={rt.id} className="border-t">
                              <td className="p-2.5">{rt.product.name}</td>
                              <td className="p-2.5 tabular-nums">{fmtQty(rt.qtyMilli)} {rt.product.baseUnit}</td>
                              <td className="p-2.5">
                                {rt.condition === 'GOOD'
                                  ? <Badge variant="secondary">صالح</Badge>
                                  : <Badge variant="outline" className="border-destructive/50 text-destructive">تالف</Badge>}
                              </td>
                              <td className="p-2.5 text-xs">{rt.note ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* أزرار العمليات على الجولة المفتوحة */}
              {detailIsOpen && canManage ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" className="h-10" onClick={openSale}>تسجيل بيع</Button>
                  <Button type="button" variant="outline" className="h-10" onClick={openReturn}>تسجيل مرتجع</Button>
                  <Button type="button" className="h-10" onClick={openSettle}>تسوية الجولة</Button>
                </div>
              ) : null}
              {!detailIsOpen ? (
                <p className="rounded-lg border bg-cream-100/60 p-2.5 text-xs text-muted-foreground">الجولة مُسواة — قراءة فقط.</p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" onClick={() => setDetailOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تسجيل بيع ===== */}
      <Dialog open={saleOpen} onOpenChange={setSaleOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تسجيل بيع من عهدة الجولة</DialogTitle>
            <DialogDescription>البيع من العهدة — لا يؤثر على المخزون الآن، ويُرحّل كفواتير حقيقية عند التسوية.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold">البنود *</Label>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setSaleItems(v => [...v, { key: nextKey(), productId: '', qty: '', price: '' }])}>
                  <Plus className="h-4 w-4" aria-hidden />
                  أضف سطر
                </Button>
              </div>
              {saleItems.map((it, idx) => {
                const loads = detail?.loads ?? []
                const chosenLoad = loads.find(l => l.productId === it.productId)
                return (
                  <div key={it.key} className="grid grid-cols-2 items-end gap-2 rounded-xl border bg-cream-100/40 p-2.5 sm:grid-cols-[1fr_100px_110px_40px]">
                    <div className="col-span-2 space-y-1 sm:col-span-1">
                      <Label className="text-xs">المنتج {idx + 1} (من الحمولة)</Label>
                      <Select value={it.productId || undefined} onValueChange={v => {
                        const prod = products.find(p => p.id === v)
                        setSaleItems(list => list.map(x => x.key === it.key ? { ...x, productId: v, price: x.price || (prod ? (prod.priceMinor / 100).toString() : '') } : x))
                      }}>
                        <SelectTrigger className="h-10 w-full" aria-label="منتج البيع"><SelectValue placeholder="اختر من الحمولة" /></SelectTrigger>
                        <SelectContent>
                          {loads.map(l => (
                            <SelectItem key={l.productId} value={l.productId}>
                              {l.product.name} — في العهدة: {fmtQty(l.qtyMilli)} {l.product.baseUnit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">الكمية</Label>
                      <Input inputMode="decimal" value={it.qty} onChange={e => setSaleItems(list => list.map(x => x.key === it.key ? { ...x, qty: e.target.value } : x))} className="h-10 tabular-nums" autoComplete="off" aria-label="كمية البيع" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">السعر</Label>
                      <Input inputMode="decimal" value={it.price} onChange={e => setSaleItems(list => list.map(x => x.key === it.key ? { ...x, price: e.target.value } : x))} className="h-10 tabular-nums" autoComplete="off" aria-label="سعر البيع" />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-10 text-destructive hover:text-destructive"
                      onClick={() => setSaleItems(list => list.filter(x => x.key !== it.key))}
                      disabled={saleItems.length <= 1}
                      aria-label="إزالة السطر"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                    {chosenLoad ? (
                      <p className="col-span-2 -mt-1 text-xs text-muted-foreground sm:col-span-4">
                        في العهدة من هذا المنتج: {fmtQty(chosenLoad.qtyMilli)} — بِع ضمنه أو سجّل الكميات الزائدة كمرتجع.
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {/* نوع الدفع والعميل */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>نوع الدفع</Label>
                <Select value={saleType} onValueChange={v => setSaleType(v === 'CREDIT' ? 'CREDIT' : 'CASH')}>
                  <SelectTrigger className="h-10 w-full" aria-label="نوع الدفع"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">نقدي (يُجمع في عهدة الجولة)</SelectItem>
                    <SelectItem value="CREDIT">آجل (يتطلب عميلًا)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>العميل {saleType === 'CREDIT' ? '*' : '(اختياري)'}</Label>
                <Popover open={custOpen} onOpenChange={setCustOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={custOpen}
                      className="h-10 w-full justify-between"
                    >
                      <span className="truncate">{saleCustomer ? saleCustomer.name : 'اختر عميلًا…'}</span>
                      <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="بحث بالاسم أو الهاتف…" />
                      <CommandList>
                        <CommandEmpty>لا نتائج</CommandEmpty>
                        <CommandGroup>
                          {saleType === 'CASH' ? (
                            <CommandItem onSelect={() => { setSaleCustomer(null); setCustOpen(false) }}>
                              <UserRound className="me-2 h-4 w-4" aria-hidden />
                              عميل نقدي (بدون)
                            </CommandItem>
                          ) : null}
                          {custList.map(c => (
                            <CommandItem key={c.id} onSelect={() => { setSaleCustomer(c); setCustOpen(false) }}>
                              <UserRound className="me-2 h-4 w-4" aria-hidden />
                              {c.name}
                              {c.phone ? <span className="ms-auto text-xs text-muted-foreground" dir="ltr">{c.phone}</span> : null}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="rounded-xl border bg-cocoa-900 p-3 text-cream-100">
              <span className="block text-xs text-copper-300">إجمالي البيع</span>
              <b className="text-lg tabular-nums">
                {fmtMoney(saleItems.reduce((s, it) => s + Math.round(((toMilliSafe(it.qty) ?? 0) * (toMinorSafe(it.price) ?? 0)) / 1000), 0))}
              </b>
            </div>
          </div>

          {saleError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{saleError}</p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setSaleOpen(false)} disabled={saleBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitSale()} disabled={saleBusy}>
              {saleBusy ? 'جارٍ التسجيل…' : 'تسجيل البيع'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تسجيل مرتجع ===== */}
      <Dialog open={retOpen} onOpenChange={setRetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تسجيل مرتجع</DialogTitle>
            <DialogDescription>
              الصالح يعود للمخزون عند التسوية، والتالف يُوثق بلا عودة. كل المتبقي يجب أن يُسجل مرتجعات قبل التسوية.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>المنتج (من الحمولة) *</Label>
              <Select value={retProductId || undefined} onValueChange={setRetProductId}>
                <SelectTrigger className="h-10 w-full" aria-label="منتج المرتجع"><SelectValue placeholder="اختر منتجًا" /></SelectTrigger>
                <SelectContent>
                  {(detail?.loads ?? []).map(l => (
                    <SelectItem key={l.productId} value={l.productId}>{l.product.name} ({l.product.baseUnit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ret-qty">الكمية *</Label>
              <Input id="ret-qty" inputMode="decimal" value={retQty} onChange={e => setRetQty(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>حالة المرتجع *</Label>
              <Select value={retCondition} onValueChange={v => setRetCondition(v === 'DAMAGED' ? 'DAMAGED' : 'GOOD')}>
                <SelectTrigger className="h-10 w-full" aria-label="حالة المرتجع"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GOOD">صالح — يعود للمخزون</SelectItem>
                  <SelectItem value="DAMAGED">تالف — لا يعود (يُوثق)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ret-note">ملاحظة (اختياري)</Label>
              <Input id="ret-note" value={retNote} onChange={e => setRetNote(e.target.value)} className="h-10" autoComplete="off" />
            </div>
          </div>
          {retError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{retError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setRetOpen(false)} disabled={retBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitReturn()} disabled={retBusy || !retProductId}>
              {retBusy ? 'جارٍ التسجيل…' : 'تسجيل المرتجع'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تسوية الجولة ===== */}
      <AlertDialog open={settleOpen} onOpenChange={v => { if (!v) setSettleOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تسوية الجولة — لا يمكن التراجع</AlertDialogTitle>
            <AlertDialogDescription>
              تُرحّل كل المبيعات كفواتير حقيقية (النقد للصندوق، الآجل على دفاتر العملاء)، ويرجع المرتجع الصالح للمخزون.
              يجب تسجيل كل الكميات المتبقية كمرتجعات أولًا.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="settle-cash">النقد المعدود (اختياري — للمطابقة)</Label>
              <Input id="settle-cash" inputMode="decimal" value={settleCash} onChange={e => setSettleCash(e.target.value)} className="h-10 tabular-nums" placeholder="0.00" autoComplete="off" />
              <p className="text-xs text-muted-foreground">المتوقع في العهدة نقدًا: {money(detail?.computed.cashCollectedMinor ?? 0)}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle-notes">ملاحظات التسوية (اختياري)</Label>
              <Textarea id="settle-notes" value={settleNotes} onChange={e => setSettleNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10">رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="h-10"
              disabled={settleBusy}
              onClick={e => { e.preventDefault(); void submitSettle() }}
            >
              {settleBusy ? 'جارٍ التسوية…' : 'تأكيد التسوية'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== ملخص ما بعد التسوية ===== */}
      <Dialog open={!!settleSummary} onOpenChange={v => { if (!v) setSettleSummary(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bus className="h-5 w-5 text-copper-600" aria-hidden />
              تمت تسوية الجولة {settleSummary?.tripNo}
            </DialogTitle>
            <DialogDescription>هذا ملخص ما رُحّل تلقائيًا:</DialogDescription>
          </DialogHeader>
          {settleSummary ? (
            <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cream-100/60 p-3 text-sm">
              <div><span className="block text-xs text-muted-foreground">فواتير مُنشأة</span><b className="tabular-nums">{settleSummary.salesCount}</b></div>
              <div><span className="block text-xs text-muted-foreground">نقد للصندوق</span><b className="tabular-nums">{money(settleSummary.cashCollectedMinor)}</b></div>
              <div><span className="block text-xs text-muted-foreground">آجل للعملاء</span><b className="tabular-nums">{money(settleSummary.creditTotalMinor)}</b></div>
              <div><span className="block text-xs text-muted-foreground">مرتجع صالح للمخزون</span><b className="tabular-nums">{fmtQty(settleSummary.returnedGoodMilli)}</b></div>
              <div><span className="block text-xs text-muted-foreground">مرتجع تالف (موثق بلا عودة)</span><b className="tabular-nums">{fmtQty(settleSummary.returnedDamagedMilli)}</b></div>
              <div><span className="block text-xs text-muted-foreground">حركة صندوق للنقد</span><b>{settleSummary.cashRecordedToShift ? 'سُجلت على الوردية' : 'لا وردية مفتوحة'}</b></div>
            </div>
          ) : null}
          {settleSummary?.warning ? (
            <p className="rounded-lg border border-copper-500/50 bg-copper-100/40 p-2 text-sm">{settleSummary.warning}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" className="h-10" onClick={() => setSettleSummary(null)}>تم</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

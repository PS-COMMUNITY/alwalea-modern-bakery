'use client'

// =============================================================
// المشتريات — فاتورة شراء ديناميكية (بنود + دفعات)، قائمة بفلاتر وترقيم،
// تفاصيل، دفعة على الفاتورة، إلغاء بعكس الآثار
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Product, Purchase, Supplier } from '@/lib/bakery/types'
import { PAYMENT_METHOD_LABELS } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, StatusBadge, TableShell,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { ClipboardList, Plus, Trash2 } from 'lucide-react'

type PurchaseRow = Purchase & { _count?: { items: number } }

type PurchaseItemRow = {
  id: string
  productId: string
  productName: string
  qtyMilli: number
  costMinor: number
  lineTotalMinor: number
}

type PurchasePaymentRow = {
  id: string
  method: string
  amountMinor: number
  date: string
  note?: string | null
}

type PurchaseDetail = Purchase & {
  items: PurchaseItemRow[]
  payments: PurchasePaymentRow[]
  note?: string | null
  voidReason?: string | null
  voidedAt?: string | null
  user?: { id: string; displayName?: string | null; username?: string | null } | null
}

type ListResponse = { items: PurchaseRow[]; total: number; page: number; pageSize: number }
type ProductRow = Product & { stockMilli?: number }

const PAGE_SIZE = 20

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
/** إجمالي السطر بنفس صيغة الـ API: Math.round(qtyMilli × costMinor / 1000) */
function lineTotal(qtyMilli: number, costMinor: number): number {
  return Math.round((qtyMilli * costMinor) / 1000)
}

type DraftItem = { key: number; productId: string; qty: string; cost: string }
type DraftPayment = { key: number; method: string; amount: string }

let draftKey = 1
const nextKey = () => draftKey++

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

export function PurchasesScreen() {
  const { settings, money, can } = useSession()
  const { toast } = useToast()
  const canManage = can('purchases.manage')
  const canPay = can('suppliers.pay')
  const canCancel = can('purchases.cancel')

  // ===== الفلاتر والقائمة =====
  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(fmtISO(new Date()))
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<PurchaseRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ===== فاتورة شراء جديدة =====
  const [formOpen, setFormOpen] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [fSupplierId, setFSupplierId] = useState('')
  const [fItems, setFItems] = useState<DraftItem[]>([])
  const [fDiscount, setFDiscount] = useState('')
  const [fPayments, setFPayments] = useState<DraftPayment[]>([])
  const [fNote, setFNote] = useState('')
  const [fBusy, setFBusy] = useState(false)
  const [fError, setFError] = useState('')

  // ===== التفاصيل =====
  const [detail, setDetail] = useState<PurchaseDetail | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  // ===== دفعة على الفاتورة =====
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')
  const [payBusy, setPayBusy] = useState(false)

  // ===== الإلغاء =====
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1) }, 250)
    return () => clearTimeout(t)
  }, [qInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (q) params.set('q', q)
      if (status) params.set('status', status)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))
      const res = await api.get<ListResponse>(`/api/purchases?${params.toString()}`)
      setRows(res.items)
      setTotal(res.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذر تحميل الفواتير')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [from, page, q, status, to])

  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ===== بيانات النموذج =====
  async function openForm() {
    setFError('')
    setFSupplierId('')
    setFItems([{ key: nextKey(), productId: '', qty: '', cost: '' }])
    setFDiscount('')
    setFPayments([])
    setFNote('')
    setFormOpen(true)
    try {
      const [sup, prods] = await Promise.all([
        api.get<{ items: Supplier[]; total: number }>('/api/suppliers?active=true'),
        api.get<{ items: ProductRow[]; total: number }>('/api/products?active=true'),
      ])
      setSuppliers(sup.items)
      setProducts(prods.items)
    } catch (e) {
      setFError(e instanceof ApiError ? e.message : 'تعذر تحميل الموردين والمنتجات')
    }
  }

  const fSubtotal = fItems.reduce((sum, it) => {
    const qty = toMilliSafe(it.qty) ?? 0
    const cost = toMinorSafe(it.cost) ?? 0
    return sum + lineTotal(qty, cost)
  }, 0)
  const fDiscountMinor = Math.min(toMinorSafe(fDiscount) ?? 0, fSubtotal)
  const fTotal = fSubtotal - fDiscountMinor
  const fPaid = fPayments.reduce((s, p) => s + (toMinorSafe(p.amount) ?? 0), 0)
  const fRemaining = fTotal - fPaid

  async function submitForm() {
    setFError('')
    if (!fSupplierId) {
      setFError('اختر المورد')
      return
    }
    const items = fItems
      .map(it => ({ productId: it.productId, qtyMilli: toMilliSafe(it.qty), costMinor: toMinorSafe(it.cost) }))
      .filter((it): it is { productId: string; qtyMilli: number; costMinor: number } => !!it.productId && it.qtyMilli !== null && it.qtyMilli > 0 && it.costMinor !== null)
    if (items.length === 0) {
      setFError('أضف بندًا واحدًا على الأقل بكمية وتكلفة صحيحتين')
      return
    }
    const seen = new Set<string>()
    for (const it of items) {
      if (seen.has(it.productId)) {
        setFError('لديك بندان لنفس المنتج — ادمجهما في بند واحد')
        return
      }
      seen.add(it.productId)
    }
    if (fPaid > fTotal) {
      setFError('المدفوع أكبر من الإجمالي — عدّل الدفعات أو الخصم')
      return
    }
    setFBusy(true)
    try {
      const created = await api.post<PurchaseDetail>('/api/purchases', {
        supplierId: fSupplierId,
        items,
        payments: fPayments
          .map(p => ({ method: p.method, amountMinor: toMinorSafe(p.amount) ?? 0 }))
          .filter(p => p.amountMinor > 0),
        discountMinor: fDiscountMinor > 0 ? fDiscountMinor : undefined,
        clientRef: `pur-${Date.now()}`,
        note: fNote.trim() || undefined,
      })
      toast({ title: `تم ترحيل فاتورة الشراء ${created.invoiceNo}`, description: `الإجمالي ${money(created.totalMinor)} — دخل المخزون ودُوّن في دفتر المورد.` })
      setFormOpen(false)
      setPage(1)
      void load()
    } catch (e) {
      setFError(e instanceof ApiError ? e.message : 'تعذر ترحيل الفاتورة')
    } finally {
      setFBusy(false)
    }
  }

  // ===== التفاصيل =====
  async function openDetail(id: string) {
    setDetailId(id)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    setPayAmount('')
    setPayMethod('CASH')
    try {
      setDetail(await api.get<PurchaseDetail>(`/api/purchases/${id}`))
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : 'تعذر تحميل الفاتورة')
    } finally {
      setDetailLoading(false)
    }
  }

  const detailRemaining = detail ? detail.totalMinor - detail.paidMinor : 0

  async function submitPayment() {
    if (!detail) return
    const amount = toMinorSafe(payAmount)
    if (amount === null || amount <= 0) {
      toast({ title: 'أدخل مبلغًا صحيحًا أكبر من صفر', variant: 'destructive' })
      return
    }
    if (amount > detailRemaining) {
      toast({ title: `المبلغ يتجاوز المتبقي على الفاتورة (${money(detailRemaining)})`, variant: 'destructive' })
      return
    }
    setPayBusy(true)
    try {
      await api.post(`/api/purchases/${detail.id}/payments`, { method: payMethod, amountMinor: amount })
      toast({ title: 'تم تسجيل الدفعة على الفاتورة' })
      setPayAmount('')
      await openDetail(detail.id)
      void load()
    } catch (e) {
      toast({
        title: 'تعذر تسجيل الدفعة',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setPayBusy(false)
    }
  }

  async function cancelPurchase() {
    if (!detail) return
    if (!cancelReason.trim()) return
    setCancelBusy(true)
    try {
      await api.post(`/api/purchases/${detail.id}/cancel`, { reason: cancelReason.trim() })
      toast({ title: `تم إلغاء فاتورة الشراء ${detail.invoiceNo}`, description: 'خرجت الكميات من المخزون وعُكس دفتر المورد.' })
      setCancelOpen(false)
      setCancelReason('')
      setDetailOpen(false)
      void load()
    } catch (e) {
      toast({
        title: 'تعذر إلغاء الفاتورة',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setCancelBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="المشتريات"
        subtitle="فواتير شراء المواد والبضائع — كل فاتورة تُرحّل مرة واحدة بآثارها كاملة"
        actions={canManage ? (
          <Button type="button" className="h-10" onClick={() => void openForm()}>
            <Plus className="h-4 w-4" aria-hidden />
            فاتورة شراء جديدة
          </Button>
        ) : null}
      />

      {/* الفلاتر */}
      <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="فلاتر المشتريات">
        <div className="space-y-1">
          <Label htmlFor="pur-from" className="text-xs">من</Label>
          <Input id="pur-from" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} className="h-10" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pur-to" className="text-xs">إلى</Label>
          <Input id="pur-to" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }} className="h-10" />
        </div>
        <div className="min-w-44 flex-1 space-y-1">
          <Label htmlFor="pur-q" className="text-xs">بحث (رقم فاتورة / اسم مورد)</Label>
          <Input id="pur-q" value={qInput} onChange={e => setQInput(e.target.value)} placeholder="P-… أو اسم المورد" className="h-10" autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">الحالة</Label>
          <Select value={status || 'all'} onValueChange={v => { setStatus(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="h-10 w-36" aria-label="حالة الفاتورة"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="COMPLETED">مكتملة</SelectItem>
              <SelectItem value="CANCELLED">ملغاة</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}

      {loading && !rows ? (
        <LoadingRows rows={6} />
      ) : rows && rows.length === 0 ? (
        <EmptyState
          title="لا فواتير شراء في هذه الفترة"
          hint="عدّل الفلاتر أو سجّل فاتورة شراء جديدة."
          action={canManage ? (
            <Button type="button" className="mt-2 h-10" onClick={() => void openForm()}>
              <Plus className="h-4 w-4" aria-hidden />
              فاتورة شراء جديدة
            </Button>
          ) : undefined}
        />
      ) : rows ? (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-cream-200">
                <tr>
                  <th className="p-3 text-start font-semibold">رقم الفاتورة</th>
                  <th className="p-3 text-start font-semibold">التاريخ</th>
                  <th className="p-3 text-start font-semibold">المورد</th>
                  <th className="p-3 text-start font-semibold">البنود</th>
                  <th className="p-3 text-start font-semibold">الإجمالي</th>
                  <th className="p-3 text-start font-semibold">المدفوع</th>
                  <th className="p-3 text-start font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr
                    key={p.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`تفاصيل فاتورة الشراء ${p.invoiceNo}`}
                    onClick={() => void openDetail(p.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openDetail(p.id) } }}
                    className="cursor-pointer border-t transition-colors hover:bg-cream-100 focus-visible:bg-cream-100"
                  >
                    <td className="p-3 font-mono text-xs" dir="ltr">{p.invoiceNo}</td>
                    <td className="p-3 text-muted-foreground">{dateTime(p.date)}</td>
                    <td className="p-3 font-semibold">{p.supplierName}</td>
                    <td className="p-3 tabular-nums">{p._count?.items ?? '—'}</td>
                    <td className="p-3 font-semibold tabular-nums">{money(p.totalMinor)}</td>
                    <td className="p-3 tabular-nums">{money(p.paidMinor)}</td>
                    <td className="p-3"><StatusBadge status={p.status} paymentStatus={p.paymentStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">
              المجموع {total} — صفحة {page} من {pages}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-10" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="الصفحة السابقة">السابق</Button>
              <Button type="button" variant="outline" className="h-10" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="الصفحة التالية">التالي</Button>
            </div>
          </div>
        </>
      ) : null}

      {/* ===== فاتورة شراء جديدة ===== */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>فاتورة شراء جديدة</DialogTitle>
            <DialogDescription>
              تدخل البنود للمخزون وتُقيّد في دفتر المورد — الأموال بالأغورة والكميات بالألفية تلقائيًا.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>المورد *</Label>
                <Select value={fSupplierId || undefined} onValueChange={setFSupplierId}>
                  <SelectTrigger className="h-10 w-full" aria-label="المورد"><SelectValue placeholder="اختر المورد" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pur-note">ملاحظة (اختياري)</Label>
                <Input id="pur-note" value={fNote} onChange={e => setFNote(e.target.value)} className="h-10" autoComplete="off" />
              </div>
            </div>

            {/* البنود */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold">بنود الفاتورة *</Label>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setFItems(v => [...v, { key: nextKey(), productId: '', qty: '', cost: '' }])}>
                  <Plus className="h-4 w-4" aria-hidden />
                  أضف سطر
                </Button>
              </div>
              <div className="space-y-2">
                {fItems.map((it, idx) => {
                  const qty = toMilliSafe(it.qty) ?? 0
                  const cost = toMinorSafe(it.cost) ?? 0
                  const lt = lineTotal(qty, cost)
                  const chosen = products.find(p => p.id === it.productId)
                  return (
                    <div key={it.key} className="grid grid-cols-2 items-end gap-2 rounded-xl border bg-cream-100/40 p-2.5 sm:grid-cols-[1fr_110px_120px_120px_40px]">
                      <div className="col-span-2 space-y-1 sm:col-span-1">
                        <Label className="text-xs">المنتج {idx + 1}</Label>
                        <Select value={it.productId || undefined} onValueChange={v => {
                          const p = products.find(x => x.id === v)
                          setFItems(list => list.map(x => x.key === it.key ? { ...x, productId: v, cost: x.cost || (p ? (p.costMinor / 100).toString() : '') } : x))
                        }}>
                          <SelectTrigger className="h-10 w-full" aria-label="منتج البند"><SelectValue placeholder="اختر منتجًا" /></SelectTrigger>
                          <SelectContent>
                            {products.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.name} ({p.baseUnit})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">الكمية ({chosen?.baseUnit ?? '—'})</Label>
                        <Input inputMode="decimal" value={it.qty} onChange={e => setFItems(list => list.map(x => x.key === it.key ? { ...x, qty: e.target.value } : x))} className="h-10 tabular-nums" autoComplete="off" aria-label="كمية البند" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">تكلفة الوحدة</Label>
                        <Input inputMode="decimal" value={it.cost} onChange={e => setFItems(list => list.map(x => x.key === it.key ? { ...x, cost: e.target.value } : x))} className="h-10 tabular-nums" autoComplete="off" aria-label="تكلفة الوحدة" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">إجمالي السطر</Label>
                        <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold tabular-nums">{money(lt)}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 text-destructive hover:text-destructive"
                        onClick={() => setFItems(list => list.filter(x => x.key !== it.key))}
                        disabled={fItems.length <= 1}
                        aria-label="إزالة السطر"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* الخصم */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pur-disc">خصم الفاتورة ({settings.currencySymbol} — اختياري)</Label>
                <Input id="pur-disc" inputMode="decimal" value={fDiscount} onChange={e => setFDiscount(e.target.value)} className="h-10 tabular-nums" placeholder="0.00" autoComplete="off" />
              </div>
            </div>

            {/* الدفعات */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold">المدفوعات (اختياري — نقدي/بطاقة/حوالة/شيك)</Label>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setFPayments(v => [...v, { key: nextKey(), method: 'CASH', amount: '' }])}>
                  <Plus className="h-4 w-4" aria-hidden />
                  أضف دفعة
                </Button>
              </div>
              {fPayments.length === 0 ? (
                <p className="text-xs text-muted-foreground">بلا دفعات = فاتورة آجلة بالكامل تُقيّد على المورد.</p>
              ) : (
                <div className="space-y-2">
                  {fPayments.map(p => (
                    <div key={p.key} className="grid grid-cols-2 items-end gap-2 rounded-xl border bg-cream-100/40 p-2.5 sm:grid-cols-[160px_1fr_40px]">
                      <div className="space-y-1">
                        <Label className="text-xs">الطريقة</Label>
                        <Select value={p.method} onValueChange={v => setFPayments(list => list.map(x => x.key === p.key ? { ...x, method: v } : x))}>
                          <SelectTrigger className="h-10 w-full" aria-label="طريقة الدفع"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">المبلغ</Label>
                        <Input inputMode="decimal" value={p.amount} onChange={e => setFPayments(list => list.map(x => x.key === p.key ? { ...x, amount: e.target.value } : x))} className="h-10 tabular-nums" autoComplete="off" aria-label="مبلغ الدفعة" />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 text-destructive hover:text-destructive"
                        onClick={() => setFPayments(list => list.filter(x => x.key !== p.key))}
                        aria-label="إزالة الدفعة"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* الإجماليات */}
            <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cocoa-900 p-3 text-cream-100 sm:grid-cols-4">
              <div><span className="block text-xs text-copper-300">مجموع البنود</span><b className="tabular-nums">{money(fSubtotal)}</b></div>
              <div><span className="block text-xs text-copper-300">الخصم</span><b className="tabular-nums">−{money(fDiscountMinor)}</b></div>
              <div><span className="block text-xs text-copper-300">الإجمالي</span><b className="tabular-nums">{money(fTotal)}</b></div>
              <div>
                <span className="block text-xs text-copper-300">المتبقي</span>
                <b className={cn('tabular-nums', fRemaining < 0 && 'text-destructive')}>{money(fRemaining)}</b>
              </div>
            </div>
          </div>

          {fError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{fError}</p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setFormOpen(false)} disabled={fBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitForm()} disabled={fBusy || !fSupplierId || fItems.length === 0}>
              {fBusy ? 'جارٍ الترحيل…' : 'ترحيل الفاتورة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تفاصيل الفاتورة ===== */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <ClipboardList className="h-5 w-5 text-copper-600" aria-hidden />
              فاتورة شراء <span className="font-mono text-sm" dir="ltr">{detail?.invoiceNo ?? '…'}</span>
              {detail ? <StatusBadge status={detail.status} paymentStatus={detail.paymentStatus} /> : null}
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `${dateTime(detail.date)} — المورد: ${detail.supplierName}${detail.user ? ` — سجلها: ${detail.user.displayName ?? detail.user.username}` : ''}`
                : 'جارٍ التحميل…'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? <LoadingRows rows={4} /> : null}
          {detailError ? <ErrorBanner message={detailError} onRetry={detailId ? () => void openDetail(detailId) : undefined} /> : null}

          {detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cream-100/60 p-3 text-sm sm:grid-cols-4">
                <div><span className="block text-xs text-muted-foreground">المجموع</span><b className="tabular-nums">{money(detail.subtotalMinor)}</b></div>
                <div><span className="block text-xs text-muted-foreground">الخصم</span><b className="tabular-nums">{money(detail.discountMinor)}</b></div>
                <div><span className="block text-xs text-muted-foreground">الإجمالي</span><b className="tabular-nums">{money(detail.totalMinor)}</b></div>
                <div><span className="block text-xs text-muted-foreground">المدفوع</span><b className="tabular-nums">{money(detail.paidMinor)}</b></div>
                {detail.voidedAt ? (
                  <div className="col-span-2 text-destructive sm:col-span-4">
                    <span className="block text-xs">سبب الإلغاء ({dateTime(detail.voidedAt)})</span>
                    <b className="text-sm">{detail.voidReason ?? '—'}</b>
                  </div>
                ) : null}
                {detail.note ? <div className="col-span-2 text-muted-foreground sm:col-span-4"><span className="block text-xs">ملاحظة</span>{detail.note}</div> : null}
              </div>

              {/* البنود */}
              <div className="overflow-hidden rounded-xl border">
                <div className="nice-scroll max-h-56 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-cream-200">
                      <tr>
                        <th className="p-2.5 text-start font-semibold">البند</th>
                        <th className="p-2.5 text-start font-semibold">الكمية</th>
                        <th className="p-2.5 text-start font-semibold">تكلفة الوحدة</th>
                        <th className="p-2.5 text-start font-semibold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map(it => (
                        <tr key={it.id} className="border-t">
                          <td className="p-2.5 font-semibold">{it.productName}</td>
                          <td className="p-2.5 tabular-nums">{it.qtyMilli / 1000}</td>
                          <td className="p-2.5 tabular-nums">{money(it.costMinor)}</td>
                          <td className="p-2.5 font-semibold tabular-nums">{money(it.lineTotalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* المدفوعات */}
              <div>
                <h3 className="mb-2 text-sm font-bold">المدفوعات</h3>
                {detail.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا دفعات — فاتورة آجلة بالكامل.</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-cream-200">
                        <tr>
                          <th className="p-2.5 text-start font-semibold">التاريخ</th>
                          <th className="p-2.5 text-start font-semibold">الطريقة</th>
                          <th className="p-2.5 text-start font-semibold">المبلغ</th>
                          <th className="p-2.5 text-start font-semibold">ملاحظة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.payments.map(p => (
                          <tr key={p.id} className="border-t">
                            <td className="p-2.5 text-muted-foreground">{dateTime(p.date)}</td>
                            <td className="p-2.5"><Badge variant="secondary">{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</Badge></td>
                            <td className="p-2.5 font-semibold tabular-nums">{money(p.amountMinor)}</td>
                            <td className="p-2.5 text-xs">{p.note ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* دفعة على الفاتورة */}
              {detail.status === 'COMPLETED' && canPay && detailRemaining > 0 ? (
                <div className="rounded-xl border bg-cream-100/40 p-3">
                  <h3 className="mb-2 text-sm font-bold">دفع دفعة على الفاتورة</h3>
                  <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                    <div className="space-y-1">
                      <Label htmlFor="purpay-amount" className="text-xs">المبلغ (المتبقي {money(detailRemaining)})</Label>
                      <Input id="purpay-amount" inputMode="decimal" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="h-10 tabular-nums" placeholder="0.00" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">الطريقة</Label>
                      <Select value={payMethod} onValueChange={setPayMethod}>
                        <SelectTrigger className="h-10 w-full" aria-label="طريقة الدفع"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button type="button" className="h-10" onClick={() => void submitPayment()} disabled={payBusy}>
                        {payBusy ? 'جارٍ التسجيل…' : 'تسجيل الدفعة'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {detail.status === 'COMPLETED' && canCancel ? (
                <div className="flex justify-end">
                  <Button type="button" variant="destructive" className="h-10" onClick={() => { setCancelReason(''); setCancelOpen(true) }}>
                    إلغاء الفاتورة
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" onClick={() => setDetailOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد الإلغاء ===== */}
      <AlertDialog open={cancelOpen} onOpenChange={v => { if (!v) setCancelOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء فاتورة الشراء؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيخرج محتوى الفاتورة من المخزون ويُعكس دفتر المورد داخل معاملة واحدة موثقة في سجل التدقيق. لا يمكن التراجع إلا بفاتورة جديدة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pur-cancel-reason">سبب الإلغاء (إلزامي) *</Label>
            <Textarea id="pur-cancel-reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} placeholder="مثال: خطأ في الكميات — الفاتورة الصحيحة P-…" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10">رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="h-10 bg-destructive text-white hover:bg-destructive/90"
              disabled={cancelBusy || !cancelReason.trim()}
              onClick={e => { e.preventDefault(); void cancelPurchase() }}
            >
              {cancelBusy ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

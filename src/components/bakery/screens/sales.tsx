'use client'

// =============================================================
// المبيعات والفواتير — قائمة بفلاتر وترقيم، تفاصيل، إعادة طباعة، إلغاء
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Sale, SaleItem } from '@/lib/bakery/types'
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
import { Receipt, type ReceiptData } from '@/components/bakery/screens/pos'
import { ChevronLeft, ChevronRight, Printer, ReceiptText, XCircle } from 'lucide-react'

type SaleListItem = Sale & { _count?: { items: number } }
type DetailUser = { id: string; displayName?: string | null; username?: string | null }

type SalePaymentRow = {
  id: string
  method: string
  amountMinor: number
  date: string
  note?: string | null
}

type SaleDetail = Sale & {
  items: SaleItem[]
  payments: SalePaymentRow[]
  user?: DetailUser | null
  voidReason?: string | null
  voidedAt?: string | null
}

type ListResponse = { items: SaleListItem[]; total: number; page: number; pageSize: number }

const PAGE_SIZE = 20

function fmtISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  return fmtISO(d)
}

function saleToReceipt(s: SaleDetail, cashierName: string): ReceiptData {
  return {
    invoiceNo: s.invoiceNo,
    date: s.date,
    cashierName,
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
    reprint: true,
  }
}

export function SalesScreen() {
  const { money, can } = useSession()
  const { toast } = useToast()

  // ===== الفلاتر =====
  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(fmtISO(new Date()))
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')

  // ===== القائمة =====
  const [rows, setRows] = useState<SaleListItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ===== التفاصيل =====
  const [detail, setDetail] = useState<SaleDetail | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  // ===== الإلغاء =====
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)

  // ===== إعادة الطباعة =====
  const [printOpen, setPrintOpen] = useState(false)

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
      const res = await api.get<ListResponse>(`/api/sales?${params.toString()}`)
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

  async function openDetail(id: string) {
    setDetailId(id)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    try {
      setDetail(await api.get<SaleDetail>(`/api/sales/${id}`))
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : 'تعذر تحميل الفاتورة')
    } finally {
      setDetailLoading(false)
    }
  }

  async function cancelSale() {
    if (!detail) return
    if (!cancelReason.trim()) return
    setCancelBusy(true)
    try {
      await api.post(`/api/sales/${detail.id}/cancel`, { reason: cancelReason.trim() })
      toast({ title: `تم إلغاء الفاتورة ${detail.invoiceNo}`, description: 'عُكس المخزون والدفاتر والنقدية تلقائيًا.' })
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
      <PageHeader title="المبيعات والفواتير" subtitle="كل فواتير البيع — من نقطة البيع ومن جولات التوزيع" />

      {/* الفلاتر */}
      <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="فلاتر الفواتير">
        <div className="space-y-1">
          <Label htmlFor="sales-from" className="text-xs">من</Label>
          <Input id="sales-from" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} className="h-10" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sales-to" className="text-xs">إلى</Label>
          <Input id="sales-to" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }} className="h-10" />
        </div>
        <div className="min-w-44 flex-1 space-y-1">
          <Label htmlFor="sales-q" className="text-xs">بحث (رقم فاتورة / اسم عميل)</Label>
          <Input id="sales-q" value={qInput} onChange={e => setQInput(e.target.value)} placeholder="S-… أو اسم العميل" className="h-10" autoComplete="off" />
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
        <EmptyState title="لا فواتير في هذه الفترة" hint="عدّل الفلاتر أو سجّل فاتورة جديدة من نقطة البيع." />
      ) : rows ? (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-cream-200">
                <tr>
                  <th className="p-3 text-start font-semibold">رقم الفاتورة</th>
                  <th className="p-3 text-start font-semibold">التاريخ</th>
                  <th className="p-3 text-start font-semibold">العميل</th>
                  <th className="p-3 text-start font-semibold">المصدر</th>
                  <th className="p-3 text-start font-semibold">الإجمالي</th>
                  <th className="p-3 text-start font-semibold">المدفوع</th>
                  <th className="p-3 text-start font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`تفاصيل الفاتورة ${s.invoiceNo}`}
                    onClick={() => void openDetail(s.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openDetail(s.id) } }}
                    className="cursor-pointer border-t transition-colors hover:bg-cream-100 focus-visible:bg-cream-100"
                  >
                    <td className="p-3 font-mono text-xs" dir="ltr">{s.invoiceNo}</td>
                    <td className="p-3 text-muted-foreground">{dateTime(s.date)}</td>
                    <td className="p-3">{s.customerName}</td>
                    <td className="p-3">
                      <Badge variant={s.source === 'POS' ? 'secondary' : 'outline'}>{s.source === 'POS' ? 'نقطة بيع' : 'توزيع'}</Badge>
                    </td>
                    <td className="p-3 font-semibold tabular-nums">{money(s.totalMinor)}</td>
                    <td className="p-3 tabular-nums">{money(s.paidMinor)}</td>
                    <td className="p-3"><StatusBadge status={s.status} paymentStatus={s.paymentStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>

          {/* ترقيم الصفحات */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">
              المجموع {total} — صفحة {page} من {pages}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-10" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="الصفحة السابقة">
                <ChevronRight className="h-4 w-4" aria-hidden />
                السابق
              </Button>
              <Button type="button" variant="outline" className="h-10" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="الصفحة التالية">
                التالي
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {/* ===== حوار التفاصيل ===== */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <ReceiptText className="h-5 w-5 text-copper-600" aria-hidden />
              فاتورة <span className="font-mono text-sm" dir="ltr">{detail?.invoiceNo ?? '…'}</span>
              {detail ? <StatusBadge status={detail.status} paymentStatus={detail.paymentStatus} /> : null}
            </DialogTitle>
            <DialogDescription>
              {detail ? `${dateTime(detail.date)} — الكاشير: ${detail.user?.displayName ?? detail.user?.username ?? '—'}` : 'جارٍ التحميل…'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? <LoadingRows rows={4} /> : null}
          {detailError ? <ErrorBanner message={detailError} onRetry={detailId ? () => void openDetail(detailId) : undefined} /> : null}

          {detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cream-100/60 p-3 text-sm sm:grid-cols-4">
                <div><span className="block text-xs text-muted-foreground">العميل</span><b>{detail.customerName}</b></div>
                <div><span className="block text-xs text-muted-foreground">الخصم</span><b className="tabular-nums">{money(detail.discountMinor)}</b></div>
                {detail.taxMinor > 0 ? (
                  <div><span className="block text-xs text-muted-foreground">الضريبة</span><b className="tabular-nums">{money(detail.taxMinor)}</b></div>
                ) : null}
                <div><span className="block text-xs text-muted-foreground">الإجمالي</span><b className="tabular-nums">{money(detail.totalMinor)}</b></div>
                <div><span className="block text-xs text-muted-foreground">المدفوع</span><b className="tabular-nums">{money(detail.paidMinor)}</b></div>
                <div><span className="block text-xs text-muted-foreground">الآجل</span><b className="tabular-nums">{money(detail.creditMinor)}</b></div>
                {detail.voidedAt ? (
                  <div className="col-span-2 text-destructive">
                    <span className="block text-xs">سبب الإلغاء</span>
                    <b className="text-sm">{detail.voidReason ?? '—'}</b>
                  </div>
                ) : null}
              </div>

              {/* البنود */}
              <div className="overflow-hidden rounded-xl border">
                <div className="nice-scroll max-h-56 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-cream-200">
                      <tr>
                        <th className="p-2.5 text-start font-semibold">البند</th>
                        <th className="p-2.5 text-start font-semibold">الكمية</th>
                        <th className="p-2.5 text-start font-semibold">السعر</th>
                        <th className="p-2.5 text-start font-semibold">خصم</th>
                        <th className="p-2.5 text-start font-semibold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.items ?? []).map(it => (
                        <tr key={it.id} className="border-t">
                          <td className="p-2.5">{it.productName}</td>
                          <td className="p-2.5 tabular-nums">{it.qtyMilli / 1000}</td>
                          <td className="p-2.5 tabular-nums">{money(it.priceMinor)}</td>
                          <td className="p-2.5 tabular-nums">{it.discountMinor > 0 ? money(it.discountMinor) : '—'}</td>
                          <td className="p-2.5 font-semibold tabular-nums">{money(it.lineTotalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* المدفوعات */}
              {(detail.payments ?? []).length > 0 ? (
                <div>
                  <h3 className="mb-2 text-sm font-bold">المدفوعات</h3>
                  <ul className="space-y-1.5">
                    {(detail.payments ?? []).map(p => (
                      <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                        <span className="flex items-center gap-2">
                          <Badge variant="secondary">{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</Badge>
                          <span className="text-xs text-muted-foreground">{dateTime(p.date)}</span>
                          {p.note ? <span className="text-xs text-muted-foreground">— {p.note}</span> : null}
                        </span>
                        <b className="tabular-nums">{money(p.amountMinor)}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">لا مدفوعات مسجلة (بيع آجل كامل).</p>
              )}
            </div>
          ) : null}

          <DialogFooter className="flex-wrap gap-2">
            {detail && detail.status === 'COMPLETED' && can('sales.cancel') ? (
              <Button
                type="button"
                variant="destructive"
                className="h-10"
                onClick={() => { setCancelReason(''); setCancelOpen(true) }}
              >
                <XCircle className="h-4 w-4" aria-hidden />
                إلغاء الفاتورة
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="h-10" onClick={() => setPrintOpen(true)} disabled={!detail}>
              <Printer className="h-4 w-4" aria-hidden />
              طباعة نسخة
            </Button>
            <Button type="button" className="h-10" onClick={() => setDetailOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد الإلغاء ===== */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء الفاتورة {detail?.invoiceNo}</AlertDialogTitle>
            <AlertDialogDescription>
              سيُعكس أثر الفاتورة تلقائيًا: إرجاع المخزون، عكس قيد دفتر العميل، وإرجاع النقدية إلى الوردية. لا يمكن التراجع عن ذلك.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">سبب الإلغاء (إلزامي)</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="مثال: خطأ في إدخال البنود / طلب العميل…"
              rows={3}
            />
            {!cancelReason.trim() ? <p className="text-xs text-destructive">اكتب سبب الإلغاء لتفعيل زر التأكيد.</p> : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10">رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="h-10 bg-destructive text-white hover:bg-destructive/90"
              disabled={!cancelReason.trim() || cancelBusy}
              onClick={e => { e.preventDefault(); void cancelSale() }}
            >
              {cancelBusy ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== إعادة الطباعة ===== */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>إعادة طباعة الإيصال</DialogTitle>
            <DialogDescription>ستظهر علامة «نسخة إعادة طباعة» أعلى الإيصال.</DialogDescription>
          </DialogHeader>
          <div className="nice-scroll max-h-[55vh] overflow-y-auto rounded-lg border bg-white p-2">
            {detail ? <Receipt data={saleToReceipt(detail, detail.user?.displayName ?? detail.user?.username ?? '—')} /> : null}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setPrintOpen(false)}>إغلاق</Button>
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

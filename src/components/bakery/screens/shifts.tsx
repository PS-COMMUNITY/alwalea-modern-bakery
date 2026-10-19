'use client'

// =============================================================
// الخزينة والورديات — حالة الوردية الحالية، حركات الصندوق، سجل الورديات
// =============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, TableShell,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Landmark, LockKeyhole, PlayCircle, Wallet } from 'lucide-react'

type ShiftUser = { id: string; displayName?: string | null; username?: string | null } | null

type ShiftRow = {
  id: string
  openedAt: string
  closedAt: string | null
  openingCashMinor: number
  expectedCashMinor: number | null
  countedCashMinor: number | null
  differenceMinor: number | null
  status: 'OPEN' | 'CLOSED'
  notes: string | null
  user?: ShiftUser
  closedBy?: ShiftUser
}

type CashMovement = {
  id: string
  date: string
  type: string
  amountMinor: number
  note: string | null
  refType: string | null
}

type CurrentResponse = {
  shift: ShiftRow | null
  expectedCashMinor: number
  movementsTotalMinor: number
  movementsCount?: number
  byType?: Record<string, number>
}

type ShiftDetailResponse = {
  shift: ShiftRow
  movements: CashMovement[]
  movementsTotalMinor: number
  expectedCashMinor: number
  differenceMinor: number | null
  byType: Record<string, { totalMinor: number; count: number }>
}

const CASH_TYPE_LABELS: Record<string, string> = {
  OPENING_CASH: 'افتتاحي',
  SALE_CASH: 'مبيعات نقدية',
  CUSTOMER_PAYMENT: 'تحصيل عميل',
  PURCHASE_PAYMENT: 'دفعة مورد',
  EXPENSE: 'مصروف',
  TRIP_CASH_IN: 'نقد جولة',
  ADJUSTMENT: 'تسوية',
  DRAWER_OUT: 'سحب من الدرج',
  DEPOSIT: 'إيداع',
}

function toMinorSafe(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function signedMoney(minor: number, fmt: (m: number) => string): string {
  if (minor > 0) return `+${fmt(minor)}`
  if (minor < 0) return `−${fmt(Math.abs(minor))}`
  return fmt(0)
}

export function ShiftsScreen() {
  const { settings, money, can } = useSession()
  const { toast } = useToast()
  const canView = can('shifts.view')
  const canUse = can('shifts.use')
  const canClose = can('shifts.close')

  // ===== الوردية الحالية =====
  const [current, setCurrent] = useState<CurrentResponse | null>(null)
  const [currentLoading, setCurrentLoading] = useState(true)
  const [currentError, setCurrentError] = useState('')

  // ===== فتح وردية =====
  const [openDlg, setOpenDlg] = useState(false)
  const [openingCash, setOpeningCash] = useState('0')
  const [openBusy, setOpenBusy] = useState(false)
  const [openError, setOpenError] = useState('')

  // ===== إغلاق وردية =====
  const [closeDlg, setCloseDlg] = useState(false)
  const [countedCash, setCountedCash] = useState('')
  const [closeNotes, setCloseNotes] = useState('')
  const [closeBusy, setCloseBusy] = useState(false)
  const [closeError, setCloseError] = useState('')

  // ===== حركات الوردية الحالية =====
  const [currentDetail, setCurrentDetail] = useState<ShiftDetailResponse | null>(null)

  // ===== سجل الورديات =====
  const [history, setHistory] = useState<ShiftRow[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')

  // ===== تفاصيل وردية سابقة =====
  const [detail, setDetail] = useState<ShiftDetailResponse | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  const loadCurrent = useCallback(async () => {
    if (!canView) {
      setCurrentLoading(false)
      return
    }
    setCurrentLoading(true)
    setCurrentError('')
    try {
      const res = await api.get<CurrentResponse>('/api/shifts/current')
      setCurrent(res)
      if (res.shift) {
        try {
          setCurrentDetail(await api.get<ShiftDetailResponse>(`/api/shifts/${res.shift.id}`))
        } catch {
          setCurrentDetail(null)
        }
      } else {
        setCurrentDetail(null)
      }
    } catch (e) {
      setCurrentError(e instanceof ApiError ? e.message : 'تعذر تحميل حالة الوردية')
      setCurrent(null)
    } finally {
      setCurrentLoading(false)
    }
  }, [canView])

  const loadHistory = useCallback(async () => {
    if (!canView) {
      setHistoryLoading(false)
      return
    }
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const res = await api.get<ShiftRow[]>('/api/shifts')
      setHistory(res.filter(s => s.status === 'CLOSED'))
    } catch (e) {
      setHistoryError(e instanceof ApiError ? e.message : 'تعذر تحميل سجل الورديات')
      setHistory(null)
    } finally {
      setHistoryLoading(false)
    }
  }, [canView])

  useEffect(() => {
    void loadCurrent()
    void loadHistory()
  }, [loadCurrent, loadHistory])

  const openShift = current?.shift ?? null

  // ===== فتح وردية =====
  async function submitOpen() {
    setOpenError('')
    const cash = toMinorSafe(openingCash)
    if (cash === null) {
      setOpenError('أدخل نقدية افتتاح صحيحة (0 أو أكثر)')
      return
    }
    setOpenBusy(true)
    try {
      await api.post('/api/shifts/open', { openingCashMinor: cash })
      toast({ title: 'فُتحت الوردية', description: `النقدية الافتتاحية: ${money(cash)}` })
      setOpenDlg(false)
      setOpeningCash('0')
      void loadCurrent()
      void loadHistory()
    } catch (e) {
      setOpenError(e instanceof ApiError ? e.message : 'تعذر فتح الوردية')
    } finally {
      setOpenBusy(false)
    }
  }

  // ===== إغلاق وردية =====
  const countedMinor = toMinorSafe(countedCash) ?? 0
  const expectedMinor = current?.expectedCashMinor ?? 0
  const diffMinor = countedMinor - expectedMinor

  async function submitClose() {
    setCloseError('')
    if (countedCash.trim() === '' || toMinorSafe(countedCash) === null) {
      setCloseError('أدخل النقد المعدود (0 أو أكثر)')
      return
    }
    setCloseBusy(true)
    try {
      const closed = await api.post<ShiftRow>('/api/shifts/close', {
        countedCashMinor: countedMinor,
        notes: closeNotes.trim() || undefined,
      })
      const d = closed.differenceMinor ?? 0
      toast({
        title: 'أُغلقت الوردية',
        description: d === 0
          ? 'مطابقة تامة — لا فرق.'
          : `الفرق ${signedMoney(d, money)} ${d > 0 ? '(زيادة عن المتوقع)' : '(عجز عن المتوقع)'}`,
      })
      setCloseDlg(false)
      setCountedCash('')
      setCloseNotes('')
      void loadCurrent()
      void loadHistory()
    } catch (e) {
      setCloseError(e instanceof ApiError ? e.message : 'تعذر إغلاق الوردية')
    } finally {
      setCloseBusy(false)
    }
  }

  // ===== تفاصيل وردية سابقة =====
  async function openDetail(id: string) {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    try {
      setDetail(await api.get<ShiftDetailResponse>(`/api/shifts/${id}`))
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : 'تعذر تحميل الوردية')
    } finally {
      setDetailLoading(false)
    }
  }

  const movementsTable = (movements: CashMovement[]) => (
    <div className="overflow-hidden rounded-xl border">
      <div className="nice-scroll max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-cream-200">
            <tr>
              <th className="p-2.5 text-start font-semibold">الوقت</th>
              <th className="p-2.5 text-start font-semibold">النوع</th>
              <th className="p-2.5 text-start font-semibold">المبلغ</th>
              <th className="p-2.5 text-start font-semibold">ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {movements.map(m => (
              <tr key={m.id} className="border-t">
                <td className="p-2.5 text-muted-foreground">{dateTime(m.date)}</td>
                <td className="p-2.5">
                  <Badge variant="secondary">{CASH_TYPE_LABELS[m.type] ?? m.type}</Badge>
                </td>
                <td className={cn('p-2.5 font-semibold tabular-nums', m.amountMinor > 0 ? 'text-ok-600' : m.amountMinor < 0 ? 'text-destructive' : '')}>
                  {signedMoney(m.amountMinor, money)}
                </td>
                <td className="p-2.5 text-xs">{m.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  const summaryByType = useMemo(() => {
    if (!currentDetail) return []
    return Object.entries(currentDetail.byType).map(([type, v]) => ({ type, ...v }))
  }, [currentDetail])

  return (
    <div>
      <PageHeader title="الخزينة والورديات" subtitle="نقد الصندوق يُتتبع عبر حركات موقعة — كل وردية تُقفل بمطابقة" />

      {currentError ? <ErrorBanner message={currentError} onRetry={loadCurrent} /> : null}

      {currentLoading && canView ? (
        <LoadingRows rows={3} />
      ) : canView ? (
        <>
          {/* ===== حالة الوردية الحالية ===== */}
          {openShift ? (
            <div className="mb-6 rounded-xl border border-ok-600/40 bg-ok-100/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-ok-600 text-white" aria-hidden>
                    <Wallet className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2 font-bold">
                      وردية مفتوحة
                      <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>●</span> OPEN</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      فُتحت {dateTime(openShift.openedAt)} — بواسطة {openShift.user?.displayName ?? openShift.user?.username ?? '—'}
                    </div>
                  </div>
                </div>
                {canClose ? (
                  <Button type="button" className="h-10" onClick={() => { setCountedCash(''); setCloseNotes(''); setCloseError(''); setCloseDlg(true) }}>
                    <LockKeyhole className="h-4 w-4" aria-hidden />
                    إغلاق الوردية
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border bg-card p-3">
                  <span className="block text-xs text-muted-foreground">الرصيد الافتتاحي</span>
                  <b className="tabular-nums">{money(openShift.openingCashMinor)}</b>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <span className="block text-xs text-muted-foreground">مجموع الحركات</span>
                  <b className={cn('tabular-nums', (current?.movementsTotalMinor ?? 0) < 0 && 'text-destructive')}>
                    {signedMoney(current?.movementsTotalMinor ?? 0, money)}
                  </b>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <span className="block text-xs text-muted-foreground">عدد الحركات</span>
                  <b className="tabular-nums">{currentDetail?.movements.length ?? current?.movementsCount ?? 0}</b>
                </div>
                <div className="rounded-lg border-2 border-ok-600/50 bg-card p-3">
                  <span className="block text-xs text-muted-foreground">النقد المتوقع في الدرج</span>
                  <b className="text-lg tabular-nums text-ok-700">{money(current?.expectedCashMinor ?? 0)}</b>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
                  <Landmark className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-bold">لا وردية مفتوحة</div>
                  <div className="text-sm text-muted-foreground">افتح وردية ليتتبع النقد (مبيعات، تحصيلات، مصروفات، جولات).</div>
                </div>
              </div>
              {canUse ? (
                <Button type="button" className="h-10" onClick={() => { setOpeningCash('0'); setOpenError(''); setOpenDlg(true) }}>
                  <PlayCircle className="h-4 w-4" aria-hidden />
                  فتح وردية
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">فتح الوردية يتطلب صلاحية shifts.use</span>
              )}
            </div>
          )}

          {/* ===== حركات الوردية الحالية ===== */}
          {openShift ? (
            <section className="mb-8" aria-label="حركات الوردية الحالية">
              <h2 className="mb-3 text-lg font-bold">حركات الوردية الحالية</h2>
              {summaryByType.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {summaryByType.map(t => (
                    <Badge key={t.type} variant="outline" className="gap-1.5 py-1.5">
                      {CASH_TYPE_LABELS[t.type] ?? t.type}
                      <b className={cn('tabular-nums', t.totalMinor > 0 ? 'text-ok-600' : t.totalMinor < 0 ? 'text-destructive' : '')}>
                        {signedMoney(t.totalMinor, money)}
                      </b>
                      <span className="text-muted-foreground">({t.count})</span>
                    </Badge>
                  ))}
                </div>
              ) : null}
              {currentDetail && currentDetail.movements.length > 0 ? (
                movementsTable(currentDetail.movements)
              ) : (
                <EmptyState title="لا حركات نقدية بعد" hint="ستظهر مبيعات النقد والتحصيلات والمصروفات هنا فور حدوثها." />
              )}
            </section>
          ) : null}

          {/* ===== سجل الورديات السابقة ===== */}
          <section aria-label="سجل الورديات">
            <h2 className="mb-3 text-lg font-bold">سجل الورديات السابقة</h2>
            {historyError ? <ErrorBanner message={historyError} onRetry={loadHistory} /> : null}
            {historyLoading ? (
              <LoadingRows rows={4} />
            ) : history && history.length === 0 ? (
              <EmptyState title="لا ورديات مغلقة بعد" hint="ستظهر الورديات هنا بعد إغلاقها مع فرق الجرد." />
            ) : history ? (
              <TableShell>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-cream-200">
                    <tr>
                      <th className="p-3 text-start font-semibold">فُتحت</th>
                      <th className="p-3 text-start font-semibold">أُغلقت</th>
                      <th className="p-3 text-start font-semibold">افتتاحي</th>
                      <th className="p-3 text-start font-semibold">متوقع</th>
                      <th className="p-3 text-start font-semibold">معدود</th>
                      <th className="p-3 text-start font-semibold">الفرق</th>
                      <th className="p-3 text-start font-semibold">الحالة</th>
                      <th className="p-3 text-start font-semibold">أغلقها</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(s => {
                      const d = s.differenceMinor ?? 0
                      return (
                        <tr
                          key={s.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`تفاصيل الوردية التي فُتحت ${dateTime(s.openedAt)}`}
                          onClick={() => void openDetail(s.id)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openDetail(s.id) } }}
                          className="cursor-pointer border-t transition-colors hover:bg-cream-100 focus-visible:bg-cream-100"
                        >
                          <td className="p-3 text-muted-foreground">{dateTime(s.openedAt)}</td>
                          <td className="p-3 text-muted-foreground">{s.closedAt ? dateTime(s.closedAt) : '—'}</td>
                          <td className="p-3 tabular-nums">{money(s.openingCashMinor)}</td>
                          <td className="p-3 tabular-nums">{s.expectedCashMinor !== null ? money(s.expectedCashMinor) : '—'}</td>
                          <td className="p-3 tabular-nums">{s.countedCashMinor !== null ? money(s.countedCashMinor) : '—'}</td>
                          <td className={cn('p-3 font-bold tabular-nums', d > 0 ? 'text-ok-600' : d < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                            {signedMoney(d, money)}
                            <span className="ms-1 text-xs font-normal">{d > 0 ? 'زيادة' : d < 0 ? 'عجز' : 'مطابق'}</span>
                          </td>
                          <td className="p-3">
                            <Badge variant="outline">مغلقة</Badge>
                          </td>
                          <td className="p-3">{s.closedBy?.displayName ?? s.closedBy?.username ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TableShell>
            ) : null}
          </section>
        </>
      ) : null}

      {/* ===== فتح وردية ===== */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>فتح وردية جديدة</DialogTitle>
            <DialogDescription>أدخل النقدية الموجودة في الدرج عند بداية الوردية.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="shift-open-cash">النقدية الافتتاحية ({settings.currencySymbol})</Label>
            <Input id="shift-open-cash" inputMode="decimal" value={openingCash} onChange={e => setOpeningCash(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
          </div>
          {openError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{openError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setOpenDlg(false)} disabled={openBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitOpen()} disabled={openBusy}>
              {openBusy ? 'جارٍ الفتح…' : 'فتح الوردية'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== إغلاق وردية ===== */}
      <Dialog open={closeDlg} onOpenChange={setCloseDlg}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إغلاق الوردية</DialogTitle>
            <DialogDescription>أدخل النقد المعدود فعليًا في الدرج — يُحسب الفرق عن المتوقع مباشرة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border bg-cream-100/60 p-3 text-sm">
              <div className="flex justify-between"><span>النقد المتوقع</span><b className="tabular-nums">{money(expectedMinor)}</b></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shift-counted">النقد المعدود *</Label>
              <Input id="shift-counted" inputMode="decimal" value={countedCash} onChange={e => setCountedCash(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
            </div>
            {countedCash.trim() !== '' && toMinorSafe(countedCash) !== null ? (
              <div
                className={cn(
                  'rounded-lg border p-3 text-sm font-bold',
                  diffMinor === 0 && 'border-ok-600/40 bg-ok-100/50 text-ok-700',
                  diffMinor > 0 && 'border-ok-600/40 bg-ok-100/50 text-ok-700',
                  diffMinor < 0 && 'border-destructive/40 bg-destructive/5 text-destructive',
                )}
                role="status"
              >
                الفرق: {signedMoney(diffMinor, money)}
                <span className="ms-2 text-xs font-normal">
                  {diffMinor === 0 ? 'مطابقة تامة' : diffMinor > 0 ? 'زيادة عن المتوقع' : 'عجز عن المتوقع'}
                </span>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="shift-close-notes">ملاحظات (اختياري)</Label>
              <Textarea id="shift-close-notes" value={closeNotes} onChange={e => setCloseNotes(e.target.value)} rows={2} />
            </div>
          </div>
          {closeError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{closeError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setCloseDlg(false)} disabled={closeBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitClose()} disabled={closeBusy || countedCash.trim() === ''}>
              {closeBusy ? 'جارٍ الإغلاق…' : 'إغلاق الوردية'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تفاصيل وردية سابقة ===== */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-copper-600" aria-hidden />
              وردية سابقة
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `فُتحت ${dateTime(detail.shift.openedAt)}${detail.shift.closedAt ? ` — أُغلقت ${dateTime(detail.shift.closedAt)}` : ''} بواسطة ${detail.shift.user?.displayName ?? detail.shift.user?.username ?? '—'}`
                : 'جارٍ التحميل…'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? <LoadingRows rows={4} /> : null}
          {detailError ? <ErrorBanner message={detailError} /> : null}

          {detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cream-100/60 p-3 text-sm sm:grid-cols-4">
                <div><span className="block text-xs text-muted-foreground">الافتتاحي</span><b className="tabular-nums">{money(detail.shift.openingCashMinor)}</b></div>
                <div><span className="block text-xs text-muted-foreground">المتوقع</span><b className="tabular-nums">{money(detail.expectedCashMinor)}</b></div>
                <div><span className="block text-xs text-muted-foreground">المعدود</span><b className="tabular-nums">{detail.shift.countedCashMinor !== null ? money(detail.shift.countedCashMinor) : '—'}</b></div>
                <div>
                  <span className="block text-xs text-muted-foreground">الفرق</span>
                  <b className={cn('tabular-nums', (detail.differenceMinor ?? 0) > 0 && 'text-ok-600', (detail.differenceMinor ?? 0) < 0 && 'text-destructive')}>
                    {signedMoney(detail.differenceMinor ?? 0, money)}
                  </b>
                </div>
                {detail.shift.closedBy ? (
                  <div className="col-span-2"><span className="block text-xs text-muted-foreground">أغلقها</span><b>{detail.shift.closedBy.displayName ?? detail.shift.closedBy.username}</b></div>
                ) : null}
                {detail.shift.notes ? (
                  <div className="col-span-2 text-muted-foreground sm:col-span-4"><span className="block text-xs">ملاحظات الإغلاق</span>{detail.shift.notes}</div>
                ) : null}
              </div>

              {detail.movements.length > 0 ? movementsTable(detail.movements) : <EmptyState title="لا حركات نقدية" hint="وردية بلا أي حركات نقدية." />}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" onClick={() => setDetailOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

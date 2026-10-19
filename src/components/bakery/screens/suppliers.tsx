'use client'

// =============================================================
// الموردون — قائمة، ملف مورد (بيانات/كشف حساب)، تسجيل دفعات للمورد
// =============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Supplier } from '@/lib/bakery/types'
import { PAYMENT_METHOD_LABELS } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, TableShell,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { BookOpen, HandCoins, Plus, Save, Search, Truck, UserRound } from 'lucide-react'

type SupplierRow = Supplier

type LedgerRow = {
  id: string
  date: string
  type: string
  refType: string | null
  amountMinor: number
  note: string | null
  balanceMinor: number
}

type StatementResponse = {
  supplier: { id: string; name: string; phone: string | null }
  openingBalanceMinor: number
  entries: LedgerRow[]
  closingBalanceMinor: number
}

type PaymentResponse = { payment: { id: string }; dueMinorBefore: number; dueMinorAfter: number; warning?: string }

const ENTRY_TYPE_LABELS: Record<string, string> = {
  INVOICE: 'فاتورة شراء',
  PAYMENT: 'دفعة',
  ADJUSTMENT: 'تسوية',
  OPENING: 'افتتاحي',
}

type DataForm = { name: string; phone: string; address: string; notes: string; active: boolean }
const EMPTY_DATA: DataForm = { name: '', phone: '', address: '', notes: '', active: true }

function fmtISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formFromSupplier(s: Supplier): DataForm {
  return { name: s.name, phone: s.phone ?? '', address: s.address ?? '', notes: s.notes ?? '', active: s.active }
}

function toMinorSafe(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function SuppliersScreen() {
  const { settings, money, can } = useSession()
  const { toast } = useToast()
  const canManage = can('suppliers.manage')
  const canPay = can('suppliers.pay')

  // ===== القائمة =====
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [rows, setRows] = useState<SupplierRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ===== ملف المورد =====
  const [profile, setProfile] = useState<SupplierRow | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [tab, setTab] = useState('data')
  const [dataForm, setDataForm] = useState<DataForm>(EMPTY_DATA)
  const [dataBusy, setDataBusy] = useState(false)
  const [dataError, setDataError] = useState('')

  // ===== كشف الحساب (بداية الشهر الحالي افتراضيًا) =====
  const monthStart = useMemo(() => fmtISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), [])
  const [stmtFrom, setStmtFrom] = useState(monthStart)
  const [stmtTo, setStmtTo] = useState(fmtISO(new Date()))
  const [stmt, setStmt] = useState<StatementResponse | null>(null)
  const [stmtLoading, setStmtLoading] = useState(false)
  const [stmtError, setStmtError] = useState('')
  const [stmtVersion, setStmtVersion] = useState(0)

  // ===== دفعة للمورد =====
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')
  const [payNote, setPayNote] = useState('')
  const [payBusy, setPayBusy] = useState(false)

  // ===== مورد جديد =====
  const [newOpen, setNewOpen] = useState(false)
  const [newForm, setNewForm] = useState<DataForm>(EMPTY_DATA)
  const [newBusy, setNewBusy] = useState(false)
  const [newError, setNewError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 250)
    return () => clearTimeout(t)
  }, [qInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (activeFilter) params.set('active', activeFilter)
      const res = await api.get<{ items: SupplierRow[]; total: number }>(`/api/suppliers?${params.toString()}`)
      setRows(res.items)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذر تحميل الموردين')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [activeFilter, q])

  useEffect(() => {
    void load()
  }, [load])

  function openProfile(s: SupplierRow) {
    setProfile(s)
    setDataForm(formFromSupplier(s))
    setTab('data')
    setStmt(null)
    setStmtError('')
    setPayAmount('')
    setPayNote('')
    setPayMethod('CASH')
    setProfileOpen(true)
  }

  // ===== كشف الحساب =====
  const profileId = profile?.id ?? null
  useEffect(() => {
    if (!profileOpen || !profileId || tab !== 'statement') return
    let cancelled = false
    setStmtLoading(true)
    setStmtError('')
    void (async () => {
      try {
        const params = new URLSearchParams()
        if (stmtFrom) params.set('from', stmtFrom)
        if (stmtTo) params.set('to', stmtTo)
        const res = await api.get<StatementResponse>(`/api/suppliers/${profileId}/statement?${params.toString()}`)
        if (!cancelled) setStmt(res)
      } catch (e) {
        if (!cancelled) {
          setStmt(null)
          setStmtError(e instanceof ApiError ? e.message : 'تعذر تحميل كشف الحساب')
        }
      } finally {
        if (!cancelled) setStmtLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [profileOpen, profileId, stmtFrom, stmtTo, stmtVersion, tab])

  // ===== حفظ بيانات المورد =====
  async function saveData() {
    if (!profile) return
    setDataError('')
    const name = dataForm.name.trim()
    if (!name) {
      setDataError('اسم المورد مطلوب')
      return
    }
    setDataBusy(true)
    try {
      const updated = await api.put<Supplier>(`/api/suppliers/${profile.id}`, {
        name,
        phone: dataForm.phone.trim() || null,
        address: dataForm.address.trim() || null,
        notes: dataForm.notes.trim() || null,
        active: dataForm.active,
      })
      setProfile(p => (p ? { ...p, ...updated } : p))
      toast({ title: 'تم حفظ بيانات المورد' })
      void load()
    } catch (e) {
      setDataError(e instanceof ApiError ? e.message : 'تعذر حفظ البيانات')
    } finally {
      setDataBusy(false)
    }
  }

  // ===== تسجيل دفعة للمورد =====
  async function submitPayment() {
    if (!profile) return
    const amount = toMinorSafe(payAmount)
    if (amount === null || amount <= 0) {
      toast({ title: 'أدخل مبلغًا صحيحًا أكبر من صفر', variant: 'destructive' })
      return
    }
    setPayBusy(true)
    try {
      const res = await api.post<PaymentResponse>(`/api/suppliers/${profile.id}/payments`, {
        amountMinor: amount,
        method: payMethod,
        note: payNote.trim() || undefined,
      })
      toast({
        title: 'تم تسجيل الدفعة للمورد',
        description: res.warning ?? `المستحق للمورد الآن: ${money(res.dueMinorAfter)}`,
      })
      setProfile(p => (p ? { ...p, dueMinor: res.dueMinorAfter } : p))
      setPayAmount('')
      setPayNote('')
      setStmtVersion(v => v + 1)
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

  // ===== مورد جديد =====
  async function submitNew() {
    setNewError('')
    const name = newForm.name.trim()
    if (!name) {
      setNewError('اسم المورد مطلوب')
      return
    }
    setNewBusy(true)
    try {
      const created = await api.post<Supplier>('/api/suppliers', {
        name,
        phone: newForm.phone.trim() || null,
        address: newForm.address.trim() || null,
        notes: newForm.notes.trim() || null,
      })
      toast({ title: `تم إضافة المورد «${created.name}»` })
      setNewOpen(false)
      setNewForm(EMPTY_DATA)
      void load()
    } catch (e) {
      setNewError(e instanceof ApiError ? e.message : 'تعذر إضافة المورد')
    } finally {
      setNewBusy(false)
    }
  }

  function dueCell(dueMinor: number | undefined) {
    if (dueMinor === undefined) return <span className="text-muted-foreground">—</span>
    if (dueMinor > 0) return <span className="font-bold tabular-nums text-destructive">{money(dueMinor)}</span>
    if (dueMinor < 0) {
      return (
        <span className="font-bold tabular-nums text-ok-600">
          {money(Math.abs(dueMinor))} <span className="text-xs font-normal">(سلف/دفع زائد)</span>
        </span>
      )
    }
    return <span className="tabular-nums text-muted-foreground">{money(0)}</span>
  }

  return (
    <div>
      <PageHeader
        title="الموردون"
        subtitle="ملفات الموردين والمستحقات وكشوف الحسابات — اضغط على صف لفتح الملف"
        actions={
          canManage ? (
            <Button type="button" className="h-10" onClick={() => { setNewForm(EMPTY_DATA); setNewError(''); setNewOpen(true) }}>
              <Plus className="h-4 w-4" aria-hidden />
              مورد جديد
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="فلاتر الموردين">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            placeholder="بحث بالاسم أو الهاتف…"
            className="h-10 ps-9"
            aria-label="بحث في الموردين"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">الحالة</Label>
          <Select value={activeFilter || 'all'} onValueChange={v => setActiveFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-10 w-32" aria-label="حالة المورد"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="true">مفعّل</SelectItem>
              <SelectItem value="false">معطّل</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}

      {loading && !rows ? (
        <LoadingRows rows={6} />
      ) : rows && rows.length === 0 ? (
        <EmptyState
          title="لا موردون مطابقون"
          hint="أضف موردًا لبدء تسجيل فواتير الشراء وتتبع المستحقات."
          action={canManage ? (
            <Button type="button" className="mt-2 h-10" onClick={() => { setNewForm(EMPTY_DATA); setNewError(''); setNewOpen(true) }}>
              <Plus className="h-4 w-4" aria-hidden />
              مورد جديد
            </Button>
          ) : undefined}
        />
      ) : rows ? (
        <TableShell>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-cream-200">
              <tr>
                <th className="p-3 text-start font-semibold">الاسم</th>
                <th className="p-3 text-start font-semibold">الهاتف</th>
                <th className="p-3 text-start font-semibold">الرصيد المستحق</th>
                <th className="p-3 text-start font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr
                  key={s.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`فتح ملف المورد ${s.name}`}
                  onClick={() => openProfile(s)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(s) } }}
                  className="cursor-pointer border-t transition-colors hover:bg-cream-100 focus-visible:bg-cream-100"
                >
                  <td className="p-3 font-semibold">{s.name}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{s.phone ?? '—'}</td>
                  <td className="p-3">{dueCell(s.dueMinor)}</td>
                  <td className="p-3">
                    {s.active ? (
                      <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مفعّل</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1"><span aria-hidden>⏸</span> معطّل</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      ) : null}

      {/* ===== ملف المورد ===== */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Truck className="h-5 w-5 text-copper-600" aria-hidden />
              {profile?.name ?? '…'}
            </DialogTitle>
            <DialogDescription>
              المستحق للمورد (علينا):{' '}
              <b className="tabular-nums">{dueCell(profile?.dueMinor)}</b>
            </DialogDescription>
          </DialogHeader>

          {profile ? (
            <Tabs value={tab} onValueChange={setTab} className="overflow-hidden">
              <TabsList className="w-full flex-wrap h-auto">
                <TabsTrigger value="data" className="gap-1.5"><UserRound className="h-4 w-4" aria-hidden />البيانات</TabsTrigger>
                <TabsTrigger value="statement" className="gap-1.5"><BookOpen className="h-4 w-4" aria-hidden />كشف الحساب</TabsTrigger>
                {canPay ? (
                  <TabsTrigger value="payment" className="gap-1.5"><HandCoins className="h-4 w-4" aria-hidden />تسجيل دفعة للمورد</TabsTrigger>
                ) : null}
              </TabsList>

              {/* ===== البيانات ===== */}
              <TabsContent value="data" className="mt-3 max-h-[52vh] overflow-y-auto pe-1 nice-scroll">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="s-name">الاسم *</Label>
                    <Input id="s-name" value={dataForm.name} onChange={e => setDataForm(f => ({ ...f, name: e.target.value }))} disabled={!canManage} className="h-10" autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="s-phone">الهاتف</Label>
                    <Input id="s-phone" value={dataForm.phone} onChange={e => setDataForm(f => ({ ...f, phone: e.target.value }))} disabled={!canManage} className="h-10" dir="ltr" autoComplete="off" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="s-address">العنوان</Label>
                    <Input id="s-address" value={dataForm.address} onChange={e => setDataForm(f => ({ ...f, address: e.target.value }))} disabled={!canManage} className="h-10" autoComplete="off" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="s-notes">ملاحظات</Label>
                    <Input id="s-notes" value={dataForm.notes} onChange={e => setDataForm(f => ({ ...f, notes: e.target.value }))} disabled={!canManage} className="h-10" autoComplete="off" />
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <Switch id="s-active" checked={dataForm.active} onCheckedChange={v => setDataForm(f => ({ ...f, active: v }))} />
                      <Label htmlFor="s-active">مورد مفعّل</Label>
                    </div>
                  ) : null}
                </div>

                {dataError ? (
                  <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{dataError}</p>
                ) : null}

                {canManage ? (
                  <div className="mt-4 flex justify-end">
                    <Button type="button" className="h-10" onClick={() => void saveData()} disabled={dataBusy || !dataForm.name.trim()}>
                      <Save className="h-4 w-4" aria-hidden />
                      {dataBusy ? 'جارٍ الحفظ…' : 'حفظ البيانات'}
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">لديك صلاحية عرض فقط — التعديل يتطلب صلاحية إدارة الموردين.</p>
                )}
              </TabsContent>

              {/* ===== كشف الحساب ===== */}
              <TabsContent value="statement" className="mt-3">
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="sstmt-from" className="text-xs">من</Label>
                    <Input id="sstmt-from" type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sstmt-to" className="text-xs">إلى</Label>
                    <Input id="sstmt-to" type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)} className="h-9" />
                  </div>
                </div>

                {stmtLoading ? <LoadingRows rows={4} /> : null}
                {stmtError ? <ErrorBanner message={stmtError} /> : null}

                {stmt && !stmtLoading ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cream-100/60 p-3 text-sm">
                      <div>
                        <span className="block text-xs text-muted-foreground">رصيد افتتاحي</span>
                        <b className="tabular-nums">{money(stmt.openingBalanceMinor)}</b>
                      </div>
                      <div>
                        <span className="block text-xs text-muted-foreground">الرصيد الختامي (المستحق للمورد)</span>
                        <b className={cn('tabular-nums', stmt.closingBalanceMinor > 0 && 'text-destructive', stmt.closingBalanceMinor < 0 && 'text-ok-600')}>
                          {money(stmt.closingBalanceMinor)}
                        </b>
                      </div>
                    </div>

                    {stmt.entries.length === 0 ? (
                      <EmptyState title="لا حركات في هذه الفترة" hint="عدّل الفترة أو سجّل فاتورة شراء/دفعة للمورد." />
                    ) : (
                      <div className="overflow-hidden rounded-xl border">
                        <div className="nice-scroll max-h-64 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-cream-200">
                              <tr>
                                <th className="p-2.5 text-start font-semibold">التاريخ</th>
                                <th className="p-2.5 text-start font-semibold">النوع</th>
                                <th className="p-2.5 text-start font-semibold">المرجع</th>
                                <th className="p-2.5 text-start font-semibold">المبلغ</th>
                                <th className="p-2.5 text-start font-semibold">الرصيد المتجمع</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stmt.entries.map(e => (
                                <tr key={e.id} className="border-t">
                                  <td className="p-2.5 text-muted-foreground">{dateTime(e.date)}</td>
                                  <td className="p-2.5">
                                    <Badge variant={e.type === 'PAYMENT' ? 'secondary' : 'outline'}>{ENTRY_TYPE_LABELS[e.type] ?? e.type}</Badge>
                                  </td>
                                  <td className="p-2.5 text-xs">{e.note ?? e.refType ?? '—'}</td>
                                  <td className={cn('p-2.5 font-semibold tabular-nums', e.amountMinor > 0 ? 'text-destructive' : 'text-ok-600')}>
                                    {e.amountMinor > 0 ? '+' : ''}{money(e.amountMinor)}
                                  </td>
                                  <td className="p-2.5 tabular-nums">{money(e.balanceMinor)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">المبالغ الموجبة تزيد ما ندين به للمورد والسالبة (دفعات) تنقصه.</p>
                  </div>
                ) : null}
              </TabsContent>

              {/* ===== تسجيل دفعة للمورد ===== */}
              {canPay ? (
                <TabsContent value="payment" className="mt-3 max-h-[52vh] overflow-y-auto pe-1 nice-scroll">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="spay-amount">المبلغ ({settings.currencySymbol}) *</Label>
                      <Input id="spay-amount" inputMode="decimal" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="h-10 tabular-nums" placeholder="0.00" autoComplete="off" />
                    </div>
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
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="spay-note">ملاحظة (اختياري)</Label>
                      <Input id="spay-note" value={payNote} onChange={e => setPayNote(e.target.value)} className="h-10" autoComplete="off" />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    الدفعة النقدية تُصرف من الصندوق على الوردية المفتوحة — ودفع أكبر من المستحق مسموح مع تحذير (يُسجل كسلفة للمورد).
                  </p>
                  <div className="mt-4 flex justify-end">
                    <Button type="button" className="h-10" onClick={() => void submitPayment()} disabled={payBusy}>
                      <HandCoins className="h-4 w-4" aria-hidden />
                      {payBusy ? 'جارٍ التسجيل…' : 'تسجيل الدفعة'}
                    </Button>
                  </div>
                </TabsContent>
              ) : null}
            </Tabs>
          ) : (
            <LoadingRows rows={3} />
          )}

          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" onClick={() => setProfileOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== مورد جديد ===== */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>مورد جديد</DialogTitle>
            <DialogDescription>سجّل بيانات المورد لتمكين فواتير الشراء وتتبع المستحقات.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ns-name">الاسم *</Label>
              <Input id="ns-name" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ns-phone">الهاتف</Label>
              <Input id="ns-phone" value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} className="h-10" dir="ltr" autoComplete="off" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ns-address">العنوان</Label>
              <Input id="ns-address" value={newForm.address} onChange={e => setNewForm(f => ({ ...f, address: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ns-notes">ملاحظات</Label>
              <Input id="ns-notes" value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
          </div>

          {newError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{newError}</p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setNewOpen(false)} disabled={newBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitNew()} disabled={newBusy || !newForm.name.trim()}>
              {newBusy ? 'جارٍ الإضافة…' : 'إضافة المورد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

// =============================================================
// العملاء والديون — قائمة، ملف عميل (بيانات/كشف حساب)، دفعات، تسويات إدارية
// =============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Customer } from '@/lib/bakery/types'
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
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { BookOpen, Contact, HandCoins, Plus, Save, Scale, Search, UserRound } from 'lucide-react'

type CustomerRow = Customer

type LedgerRow = {
  id: string
  date: string
  type: string
  refType: string | null
  refId?: string | null
  amountMinor: number
  note: string | null
  balanceMinor: number
}

type StatementResponse = {
  customer: { id: string; name: string; phone: string | null }
  openingBalanceMinor: number
  entries: LedgerRow[]
  closingBalanceMinor: number
}

type PaymentResponse = { payment: { id: string }; debtMinorBefore: number; debtMinorAfter: number; warning?: string }
type AdjustmentResponse = { entry: { id: string }; debtMinorBefore: number; debtMinorAfter: number }

const ENTRY_TYPE_LABELS: Record<string, string> = {
  INVOICE: 'فاتورة',
  PAYMENT: 'دفعة',
  ADJUSTMENT: 'تسوية',
  RETURN: 'مردود',
  OPENING: 'افتتاحي',
}

type DataForm = {
  name: string
  phone: string
  address: string
  notes: string
  creditLimit: string
  defaultPriceType: string
  active: boolean
}

const EMPTY_DATA: DataForm = { name: '', phone: '', address: '', notes: '', creditLimit: '', defaultPriceType: 'RETAIL', active: true }

function fmtISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formFromCustomer(c: Customer): DataForm {
  return {
    name: c.name,
    phone: c.phone ?? '',
    address: c.address ?? '',
    notes: c.notes ?? '',
    creditLimit: c.creditLimitMinor !== null && c.creditLimitMinor !== undefined ? (c.creditLimitMinor / 100).toString() : '',
    defaultPriceType: c.defaultPriceType,
    active: c.active,
  }
}

function toMinorSafe(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}
function toSignedMinorSafe(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n === 0) return null
  return Math.round(n * 100)
}

export function CustomersScreen() {
  const { settings, money, can, user } = useSession()
  const { toast } = useToast()
  const canManage = can('customers.manage')
  const canCollect = can('customers.collect')
  const isOwner = user.role === 'OWNER'

  // ===== القائمة =====
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [rows, setRows] = useState<CustomerRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ===== ملف العميل =====
  const [profile, setProfile] = useState<CustomerRow | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [tab, setTab] = useState('data')
  const [dataForm, setDataForm] = useState<DataForm>(EMPTY_DATA)
  const [dataBusy, setDataBusy] = useState(false)
  const [dataError, setDataError] = useState('')

  // ===== كشف الحساب (بداية الشهر الحالي افتراضيًا) =====
  const monthStart = useMemo(() => {
    const d = new Date()
    return fmtISO(new Date(d.getFullYear(), d.getMonth(), 1))
  }, [])
  const [stmtFrom, setStmtFrom] = useState(monthStart)
  const [stmtTo, setStmtTo] = useState(fmtISO(new Date()))
  const [stmt, setStmt] = useState<StatementResponse | null>(null)
  const [stmtLoading, setStmtLoading] = useState(false)
  const [stmtError, setStmtError] = useState('')
  const [stmtVersion, setStmtVersion] = useState(0)

  // ===== دفعة جديدة =====
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')
  const [payNote, setPayNote] = useState('')
  const [payBusy, setPayBusy] = useState(false)

  // ===== تسوية إدارية =====
  const [adjAmount, setAdjAmount] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjBusy, setAdjBusy] = useState(false)

  // ===== عميل جديد =====
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
      const res = await api.get<{ items: CustomerRow[]; total: number }>(`/api/customers?${params.toString()}`)
      setRows(res.items)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذر تحميل العملاء')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [activeFilter, q])

  useEffect(() => {
    void load()
  }, [load])

  function openProfile(c: CustomerRow) {
    setProfile(c)
    setDataForm(formFromCustomer(c))
    setTab('data')
    setStmt(null)
    setStmtError('')
    setPayAmount('')
    setPayNote('')
    setPayMethod('CASH')
    setAdjAmount('')
    setAdjReason('')
    setProfileOpen(true)
  }

  // ===== كشف الحساب (يُحمّل عند فتح التبويب أو تغيير الفترة) =====
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
        const res = await api.get<StatementResponse>(`/api/customers/${profileId}/statement?${params.toString()}`)
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

  // ===== حفظ بيانات العميل =====
  async function saveData() {
    if (!profile) return
    setDataError('')
    const name = dataForm.name.trim()
    if (!name) {
      setDataError('اسم العميل مطلوب')
      return
    }
    const limit = toMinorSafe(dataForm.creditLimit)
    if (limit === null && dataForm.creditLimit.trim() !== '') {
      setDataError('حد الائتمان غير صالح')
      return
    }
    setDataBusy(true)
    try {
      const updated = await api.put<Customer>(`/api/customers/${profile.id}`, {
        name,
        phone: dataForm.phone.trim() || null,
        address: dataForm.address.trim() || null,
        notes: dataForm.notes.trim() || null,
        creditLimitMinor: limit,
        defaultPriceType: dataForm.defaultPriceType,
        active: dataForm.active,
      })
      setProfile({ ...profile, ...updated })
      toast({ title: 'تم حفظ بيانات العميل' })
      void load()
    } catch (e) {
      setDataError(e instanceof ApiError ? e.message : 'تعذر حفظ البيانات')
    } finally {
      setDataBusy(false)
    }
  }

  // ===== تسجيل دفعة =====
  async function submitPayment() {
    if (!profile) return
    const amount = toMinorSafe(payAmount)
    if (amount === null || amount <= 0) {
      toast({ title: 'أدخل مبلغًا صحيحًا أكبر من صفر', variant: 'destructive' })
      return
    }
    setPayBusy(true)
    try {
      const res = await api.post<PaymentResponse>(`/api/customers/${profile.id}/payments`, {
        amountMinor: amount,
        method: payMethod,
        note: payNote.trim() || undefined,
      })
      toast({
        title: 'تم تسجيل الدفعة',
        description: res.warning ?? `دين العميل الآن: ${money(res.debtMinorAfter)}`,
      })
      setProfile(p => (p ? { ...p, debtMinor: res.debtMinorAfter } : p))
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

  // ===== تسوية إدارية =====
  async function submitAdjustment() {
    if (!profile) return
    const amount = toSignedMinorSafe(adjAmount)
    if (amount === null) {
      toast({ title: 'أدخل مبلغًا صحيحًا لا يساوي صفر', description: 'موجب يزيد الدين وسالب ينقصه.', variant: 'destructive' })
      return
    }
    if (!adjReason.trim()) {
      toast({ title: 'سبب التسوية إلزامي', variant: 'destructive' })
      return
    }
    setAdjBusy(true)
    try {
      const res = await api.post<AdjustmentResponse>(`/api/customers/${profile.id}/adjustments`, {
        amountMinor: amount,
        reason: adjReason.trim(),
      })
      toast({ title: 'تم تسجيل التسوية', description: `دين العميل الآن: ${money(res.debtMinorAfter)}` })
      setProfile(p => (p ? { ...p, debtMinor: res.debtMinorAfter } : p))
      setAdjAmount('')
      setAdjReason('')
      setStmtVersion(v => v + 1)
      void load()
    } catch (e) {
      toast({
        title: 'تعذر تسجيل التسوية',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setAdjBusy(false)
    }
  }

  // ===== عميل جديد =====
  async function submitNew() {
    setNewError('')
    const name = newForm.name.trim()
    if (!name) {
      setNewError('اسم العميل مطلوب')
      return
    }
    const limit = toMinorSafe(newForm.creditLimit)
    if (limit === null && newForm.creditLimit.trim() !== '') {
      setNewError('حد الائتمان غير صالح')
      return
    }
    setNewBusy(true)
    try {
      const created = await api.post<Customer>('/api/customers', {
        name,
        phone: newForm.phone.trim() || null,
        address: newForm.address.trim() || null,
        notes: newForm.notes.trim() || null,
        creditLimitMinor: limit,
        defaultPriceType: newForm.defaultPriceType,
      })
      toast({ title: `تم إضافة العميل «${created.name}»` })
      setNewOpen(false)
      setNewForm(EMPTY_DATA)
      void load()
    } catch (e) {
      setNewError(e instanceof ApiError ? e.message : 'تعذر إضافة العميل')
    } finally {
      setNewBusy(false)
    }
  }

  function debtCell(debtMinor: number | undefined) {
    if (debtMinor === undefined) return <span className="text-muted-foreground">—</span>
    if (debtMinor > 0) return <span className="font-bold tabular-nums text-destructive">{money(debtMinor)}</span>
    if (debtMinor < 0) {
      return (
        <span className="font-bold tabular-nums text-ok-600">
          {money(Math.abs(debtMinor))} <span className="text-xs font-normal">(دفع مقدَّم)</span>
        </span>
      )
    }
    return <span className="tabular-nums text-muted-foreground">{money(0)}</span>
  }

  return (
    <div>
      <PageHeader
        title="العملاء والديون"
        subtitle="ملفات العملاء، كشوف الحسابات، والتحصيل — اضغط على صف لفتح الملف"
        actions={
          canManage ? (
            <Button type="button" className="h-10" onClick={() => { setNewForm(EMPTY_DATA); setNewError(''); setNewOpen(true) }}>
              <Plus className="h-4 w-4" aria-hidden />
              عميل جديد
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="فلاتر العملاء">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            placeholder="بحث بالاسم أو الهاتف…"
            className="h-10 ps-9"
            aria-label="بحث في العملاء"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">الحالة</Label>
          <Select value={activeFilter || 'all'} onValueChange={v => setActiveFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-10 w-32" aria-label="حالة العميل"><SelectValue /></SelectTrigger>
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
          title="لا عملاء مطابقون"
          hint="أضف عميلًا جديدًا لتبدأ تسجيل البيع الآجل والتحصيلات."
          action={canManage ? (
            <Button type="button" className="mt-2 h-10" onClick={() => { setNewForm(EMPTY_DATA); setNewError(''); setNewOpen(true) }}>
              <Plus className="h-4 w-4" aria-hidden />
              عميل جديد
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
                <th className="p-3 text-start font-semibold">نوع السعر</th>
                <th className="p-3 text-start font-semibold">الرصيد / الدين</th>
                <th className="p-3 text-start font-semibold">الحد الائتماني</th>
                <th className="p-3 text-start font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr
                  key={c.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`فتح ملف العميل ${c.name}`}
                  onClick={() => openProfile(c)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(c) } }}
                  className="cursor-pointer border-t transition-colors hover:bg-cream-100 focus-visible:bg-cream-100"
                >
                  <td className="p-3 font-semibold">{c.name}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{c.phone ?? '—'}</td>
                  <td className="p-3">
                    <Badge variant={c.defaultPriceType === 'WHOLESALE' ? 'secondary' : 'outline'}>
                      {c.defaultPriceType === 'WHOLESALE' ? 'جملة' : 'تجزئة'}
                    </Badge>
                  </td>
                  <td className="p-3">{debtCell(c.debtMinor)}</td>
                  <td className="p-3 tabular-nums">{c.creditLimitMinor !== null && c.creditLimitMinor !== undefined ? money(c.creditLimitMinor) : 'بلا حد'}</td>
                  <td className="p-3">
                    {c.active ? (
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

      {/* ===== ملف العميل ===== */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <UserRound className="h-5 w-5 text-copper-600" aria-hidden />
              {profile?.name ?? '…'}
              {profile ? (
                <Badge variant={profile.defaultPriceType === 'WHOLESALE' ? 'secondary' : 'outline'}>
                  {profile.defaultPriceType === 'WHOLESALE' ? 'جملة' : 'تجزئة'}
                </Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              الدين الحالي:{' '}
              <b className="tabular-nums">{debtCell(profile?.debtMinor)}</b>
              {' '}— الحد الائتماني:{' '}
              <b className="tabular-nums">{profile?.creditLimitMinor != null ? money(profile.creditLimitMinor) : 'بلا حد'}</b>
            </DialogDescription>
          </DialogHeader>

          {profile ? (
            <Tabs value={tab} onValueChange={setTab} className="overflow-hidden">
              <TabsList className="w-full flex-wrap h-auto">
                <TabsTrigger value="data" className="gap-1.5"><Contact className="h-4 w-4" aria-hidden />البيانات</TabsTrigger>
                <TabsTrigger value="statement" className="gap-1.5"><BookOpen className="h-4 w-4" aria-hidden />كشف الحساب</TabsTrigger>
                {canCollect ? (
                  <TabsTrigger value="payment" className="gap-1.5"><HandCoins className="h-4 w-4" aria-hidden />تسجيل دفعة</TabsTrigger>
                ) : null}
                {isOwner ? (
                  <TabsTrigger value="adjust" className="gap-1.5"><Scale className="h-4 w-4" aria-hidden />تسوية إدارية</TabsTrigger>
                ) : null}
              </TabsList>

              {/* ===== البيانات ===== */}
              <TabsContent value="data" className="mt-3 max-h-[52vh] overflow-y-auto pe-1 nice-scroll">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="c-name">الاسم *</Label>
                    <Input id="c-name" value={dataForm.name} onChange={e => setDataForm(f => ({ ...f, name: e.target.value }))} disabled={!canManage} className="h-10" autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-phone">الهاتف</Label>
                    <Input id="c-phone" value={dataForm.phone} onChange={e => setDataForm(f => ({ ...f, phone: e.target.value }))} disabled={!canManage} className="h-10" dir="ltr" autoComplete="off" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="c-address">العنوان</Label>
                    <Input id="c-address" value={dataForm.address} onChange={e => setDataForm(f => ({ ...f, address: e.target.value }))} disabled={!canManage} className="h-10" autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="c-limit">الحد الائتماني ({settings.currencySymbol} — فارغ = بلا حد)</Label>
                    <Input
                      id="c-limit"
                      inputMode="decimal"
                      value={dataForm.creditLimit}
                      onChange={e => setDataForm(f => ({ ...f, creditLimit: e.target.value }))}
                      disabled={!canManage}
                      className="h-10 tabular-nums"
                      placeholder="بلا حد"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>نوع السعر الافتراضي</Label>
                    <Select value={dataForm.defaultPriceType} onValueChange={v => setDataForm(f => ({ ...f, defaultPriceType: v }))} disabled={!canManage}>
                      <SelectTrigger className="h-10 w-full" aria-label="نوع السعر"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RETAIL">تجزئة</SelectItem>
                        <SelectItem value="WHOLESALE">جملة</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="c-notes">ملاحظات</Label>
                    <Textarea id="c-notes" value={dataForm.notes} onChange={e => setDataForm(f => ({ ...f, notes: e.target.value }))} disabled={!canManage} rows={2} />
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <Switch id="c-active" checked={dataForm.active} onCheckedChange={v => setDataForm(f => ({ ...f, active: v }))} />
                      <Label htmlFor="c-active">عميل مفعّل</Label>
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
                  <p className="mt-3 text-xs text-muted-foreground">لديك صلاحية عرض فقط — التعديل يتطلب صلاحية إدارة العملاء.</p>
                )}
              </TabsContent>

              {/* ===== كشف الحساب ===== */}
              <TabsContent value="statement" className="mt-3">
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="stmt-from" className="text-xs">من</Label>
                    <Input id="stmt-from" type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="stmt-to" className="text-xs">إلى</Label>
                    <Input id="stmt-to" type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)} className="h-9" />
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
                        <span className="block text-xs text-muted-foreground">الرصيد الختامي (الدين)</span>
                        <b className={cn('tabular-nums', stmt.closingBalanceMinor > 0 && 'text-destructive', stmt.closingBalanceMinor < 0 && 'text-ok-600')}>
                          {money(stmt.closingBalanceMinor)}
                        </b>
                      </div>
                    </div>

                    {stmt.entries.length === 0 ? (
                      <EmptyState title="لا حركات في هذه الفترة" hint="عدّل الفترة أو سجّل فاتورة/دفعة للعميل." />
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
                    <p className="text-xs text-muted-foreground">المبالغ الموجبة تزيد الدين والسالبة تنقصه (دفعات/مرتجعات).</p>
                  </div>
                ) : null}
              </TabsContent>

              {/* ===== تسجيل دفعة ===== */}
              {canCollect ? (
                <TabsContent value="payment" className="mt-3 max-h-[52vh] overflow-y-auto pe-1 nice-scroll">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pay-amount">المبلغ ({settings.currencySymbol}) *</Label>
                      <Input id="pay-amount" inputMode="decimal" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="h-10 tabular-nums" placeholder="0.00" autoComplete="off" />
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
                      <Label htmlFor="pay-note">ملاحظة (اختياري)</Label>
                      <Input id="pay-note" value={payNote} onChange={e => setPayNote(e.target.value)} className="h-10" autoComplete="off" />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    دفع أكبر من الدين مسموح — سيظهر كرصيد مقدَّم للعميل مع تحذير.
                  </p>
                  <div className="mt-4 flex justify-end">
                    <Button type="button" className="h-10" onClick={() => void submitPayment()} disabled={payBusy}>
                      <HandCoins className="h-4 w-4" aria-hidden />
                      {payBusy ? 'جارٍ التسجيل…' : 'تسجيل الدفعة'}
                    </Button>
                  </div>
                </TabsContent>
              ) : null}

              {/* ===== تسوية إدارية ===== */}
              {isOwner ? (
                <TabsContent value="adjust" className="mt-3 max-h-[52vh] overflow-y-auto pe-1 nice-scroll">
                  <p className="mb-3 rounded-lg border border-copper-500/50 bg-copper-100/40 p-2 text-xs leading-relaxed">
                    التسوية الإدارية تُقيّد مباشرة في دفتر العميل — موجب يزيد الدين وسالب ينقصه. استخدمها لتصحيح فروقات موثقة فقط.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="adj-amount">المبلغ الموقّع ({settings.currencySymbol}) *</Label>
                      <Input id="adj-amount" inputMode="decimal" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} className="h-10 tabular-nums" placeholder="+50 أو −50" autoComplete="off" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="adj-reason">سبب التسوية (إلزامي) *</Label>
                      <Input id="adj-reason" value={adjReason} onChange={e => setAdjReason(e.target.value)} className="h-10" autoComplete="off" />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button type="button" className="h-10" onClick={() => void submitAdjustment()} disabled={adjBusy || !adjReason.trim()}>
                      <Scale className="h-4 w-4" aria-hidden />
                      {adjBusy ? 'جارٍ التسجيل…' : 'تسجيل التسوية'}
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

      {/* ===== عميل جديد ===== */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>عميل جديد</DialogTitle>
            <DialogDescription>سجّل بيانات العميل لتمكين البيع الآجل والتحصيلات.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-name">الاسم *</Label>
              <Input id="nc-name" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-phone">الهاتف</Label>
              <Input id="nc-phone" value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} className="h-10" dir="ltr" autoComplete="off" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nc-address">العنوان</Label>
              <Input id="nc-address" value={newForm.address} onChange={e => setNewForm(f => ({ ...f, address: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-limit">الحد الائتماني (فارغ = بلا حد)</Label>
              <Input id="nc-limit" inputMode="decimal" value={newForm.creditLimit} onChange={e => setNewForm(f => ({ ...f, creditLimit: e.target.value }))} className="h-10 tabular-nums" placeholder="بلا حد" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>نوع السعر الافتراضي</Label>
              <Select value={newForm.defaultPriceType} onValueChange={v => setNewForm(f => ({ ...f, defaultPriceType: v }))}>
                <SelectTrigger className="h-10 w-full" aria-label="نوع السعر"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RETAIL">تجزئة</SelectItem>
                  <SelectItem value="WHOLESALE">جملة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nc-notes">ملاحظات</Label>
              <Textarea id="nc-notes" value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>

          {newError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{newError}</p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setNewOpen(false)} disabled={newBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitNew()} disabled={newBusy || !newForm.name.trim()}>
              {newBusy ? 'جارٍ الإضافة…' : 'إضافة العميل'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

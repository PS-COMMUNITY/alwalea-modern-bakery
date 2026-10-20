'use client'

// =============================================================
// المصروفات — فلاتر وتصنيفات، تسجيل مصروف، إدارة تصنيفات، إلغاء (مالك فقط)
// ملاحظة: GET /api/expenses يعيد مصفوفة مباشرة — المجاميع تُحسب محليًا
// =============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import { PAYMENT_METHOD_LABELS } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  dateOnly, dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, StatCard, TableShell,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Plus, Tags, Wallet, XCircle } from 'lucide-react'

type ExpenseCategory = { id: string; name: string; active: boolean; _count?: { expenses: number } }

type ExpenseRow = {
  id: string
  date: string
  categoryId: string
  category: { id: string; name: string }
  amountMinor: number
  method: string
  beneficiary: string | null
  note: string | null
  status: 'COMPLETED' | 'CANCELLED'
  voidReason?: string | null
  voidedAt?: string | null
}

function toMinorSafe(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function fmtISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ExpensesScreen() {
  const { settings, money, can, user } = useSession()
  const { toast } = useToast()
  const canManage = can('expenses.manage')
  const isOwner = user.role === 'OWNER'

  // ===== الفلاتر والقائمة =====
  const monthStart = useMemo(() => fmtISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(fmtISO(new Date()))
  const [categoryId, setCategoryId] = useState('')
  const [rows, setRows] = useState<ExpenseRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ===== التصنيفات =====
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [catName, setCatName] = useState('')
  const [catBusy, setCatBusy] = useState(false)

  // ===== مصروف جديد =====
  const [newOpen, setNewOpen] = useState(false)
  const [nCategoryId, setNCategoryId] = useState('')
  const [nAmount, setNAmount] = useState('')
  const [nMethod, setNMethod] = useState('CASH')
  const [nBeneficiary, setNBeneficiary] = useState('')
  const [nNote, setNNote] = useState('')
  const [nDate, setNDate] = useState(fmtISO(new Date()))
  const [nBusy, setNBusy] = useState(false)
  const [nError, setNError] = useState('')

  // ===== إلغاء مصروف =====
  const [cancelTarget, setCancelTarget] = useState<ExpenseRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)

  const loadCategories = useCallback(async () => {
    try {
      const res = await api.get<ExpenseCategory[]>('/api/expenses/categories')
      setCategories(res)
    } catch {
      // التصنيفات تُحمّل لاحقًا عند الحاجة
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (categoryId) params.set('categoryId', categoryId)
      const res = await api.get<ExpenseRow[]>(`/api/expenses?${params.toString()}`)
      setRows(res)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذر تحميل المصروفات')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [categoryId, from, to])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  const completed = useMemo(() => (rows ?? []).filter(x => x.status === 'COMPLETED'), [rows])
  const totalMinor = completed.reduce((s, x) => s + x.amountMinor, 0)
  const activeCategories = categories.filter(c => c.active)

  // ===== مصروف جديد =====
  async function submitNew() {
    setNError('')
    if (!nCategoryId) {
      setNError('اختر تصنيف المصروف')
      return
    }
    const amount = toMinorSafe(nAmount)
    if (amount === null || amount <= 0) {
      setNError('أدخل مبلغًا صحيحًا أكبر من صفر')
      return
    }
    setNBusy(true)
    try {
      await api.post<ExpenseRow>('/api/expenses', {
        categoryId: nCategoryId,
        amountMinor: amount,
        method: nMethod,
        beneficiary: nBeneficiary.trim() || undefined,
        note: nNote.trim() || undefined,
        date: nDate || undefined,
      })
      toast({
        title: 'تم تسجيل المصروف',
        description: nMethod === 'CASH' ? 'صُرف من الصندوق على الوردية المفتوحة إن وجدت.' : undefined,
      })
      setNewOpen(false)
      setNAmount('')
      setNBeneficiary('')
      setNNote('')
      void load()
    } catch (e) {
      setNError(e instanceof ApiError ? e.message : 'تعذر تسجيل المصروف')
    } finally {
      setNBusy(false)
    }
  }

  // ===== تصنيف جديد =====
  async function submitCategory() {
    const name = catName.trim()
    if (!name) return
    setCatBusy(true)
    try {
      await api.post('/api/expenses/categories', { name })
      toast({ title: `تم إضافة التصنيف «${name}»` })
      setCatName('')
      void loadCategories()
    } catch (e) {
      toast({
        title: 'تعذر إضافة التصنيف',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setCatBusy(false)
    }
  }

  // ===== إلغاء مصروف =====
  async function cancelExpense() {
    if (!cancelTarget) return
    if (!cancelReason.trim()) return
    setCancelBusy(true)
    try {
      await api.post(`/api/expenses/${cancelTarget.id}/cancel`, { reason: cancelReason.trim() })
      toast({ title: 'تم إلغاء المصروف', description: 'عُدّت قيمته للصندوق إن كان نقديًا له حركة أصلية.' })
      setCancelTarget(null)
      setCancelReason('')
      void load()
    } catch (e) {
      toast({
        title: 'تعذر إلغاء المصروف',
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
        title="المصروفات"
        subtitle="المصروفات النقدية وغير النقدية بتصنيفاتها — كل مصروف موثق في سجل التدقيق"
        actions={canManage ? (
          <Button type="button" className="h-10" onClick={() => { setNError(''); setNewOpen(true) }}>
            <Plus className="h-4 w-4" aria-hidden />
            مصروف جديد
          </Button>
        ) : null}
      />

      <Tabs defaultValue="list">
        <TabsList className="mb-4 h-11">
          <TabsTrigger value="list" className="gap-2 px-4">
            <Wallet className="h-4 w-4" aria-hidden />
            المصروفات
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2 px-4">
            <Tags className="h-4 w-4" aria-hidden />
            التصنيفات
          </TabsTrigger>
        </TabsList>

        {/* ==================== قائمة المصروفات ==================== */}
        <TabsContent value="list">
          {/* الملخص */}
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard title="إجمالي المصروفات (المكتملة)" value={money(totalMinor)} icon={<Wallet className="h-4 w-4" aria-hidden />} tone="accent" />
            <StatCard title="عدد المصروفات" value={String(completed.length)} />
            <StatCard title="الملغاة في الفترة" value={String((rows ?? []).length - completed.length)} />
          </div>

          {/* الفلاتر */}
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="exp-from" className="text-xs">من</Label>
              <Input id="exp-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exp-to" className="text-xs">إلى</Label>
              <Input id="exp-to" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">التصنيف</Label>
              <Select value={categoryId || 'all'} onValueChange={v => setCategoryId(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-10 w-44" aria-label="تصنيف المصروف"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل التصنيفات</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? <ErrorBanner message={error} onRetry={load} /> : null}

          {loading && !rows ? (
            <LoadingRows rows={6} />
          ) : rows && rows.length === 0 ? (
            <EmptyState
              title="لا مصروفات في هذه الفترة"
              hint="عدّل الفلاتر أو سجّل مصروفًا جديدًا."
              action={canManage ? (
                <Button type="button" className="mt-2 h-10" onClick={() => { setNError(''); setNewOpen(true) }}>
                  <Plus className="h-4 w-4" aria-hidden />
                  مصروف جديد
                </Button>
              ) : undefined}
            />
          ) : rows ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">التاريخ</th>
                    <th className="p-3 text-start font-semibold">التصنيف</th>
                    <th className="p-3 text-start font-semibold">المبلغ</th>
                    <th className="p-3 text-start font-semibold">الطريقة</th>
                    <th className="p-3 text-start font-semibold">المستفيد / الجهة</th>
                    <th className="p-3 text-start font-semibold">ملاحظة</th>
                    <th className="p-3 text-start font-semibold">الحالة</th>
                    {isOwner ? <th className="p-3 text-start font-semibold">إجراءات</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(x => (
                    <tr key={x.id} className={cn('border-t transition-colors hover:bg-cream-100', x.status === 'CANCELLED' && 'opacity-60')}>
                      <td className="p-3 text-muted-foreground">{dateOnly(x.date)}</td>
                      <td className="p-3 font-semibold">{x.category?.name ?? '—'}</td>
                      <td className="p-3 font-bold tabular-nums">{money(x.amountMinor)}</td>
                      <td className="p-3">
                        <Badge variant="secondary">{PAYMENT_METHOD_LABELS[x.method] ?? x.method}</Badge>
                      </td>
                      <td className="p-3">{x.beneficiary ?? '—'}</td>
                      <td className="p-3 text-xs">{x.note ?? '—'}</td>
                      <td className="p-3">
                        {x.status === 'COMPLETED' ? (
                          <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مكتمل</Badge>
                        ) : (
                          <Badge variant="outline" className="border-destructive/50 text-destructive gap-1"><span aria-hidden>✕</span> ملغى</Badge>
                        )}
                      </td>
                      {isOwner ? (
                        <td className="p-3">
                          {x.status === 'COMPLETED' ? (
                            <Button type="button" variant="ghost" size="sm" className="h-9 text-destructive hover:text-destructive" onClick={() => { setCancelTarget(x); setCancelReason('') }}>
                              <XCircle className="h-4 w-4" aria-hidden />
                              إلغاء
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">{x.voidedAt ? `أُلغي ${dateTime(x.voidedAt)}` : '—'}</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : null}
        </TabsContent>

        {/* ==================== التصنيفات ==================== */}
        <TabsContent value="categories">
          {canManage ? (
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <div className="min-w-52 flex-1 space-y-1">
                <Label htmlFor="exp-cat-name">اسم تصنيف جديد</Label>
                <Input id="exp-cat-name" value={catName} onChange={e => setCatName(e.target.value)} placeholder="مثال: وقود ومواصلات" className="h-10" autoComplete="off" />
              </div>
              <Button type="button" className="h-10" onClick={() => void submitCategory()} disabled={catBusy || !catName.trim()}>
                <Plus className="h-4 w-4" aria-hidden />
                إضافة تصنيف
              </Button>
            </div>
          ) : null}

          {categories.length === 0 ? (
            <EmptyState title="لا تصنيفات بعد" hint="أنشئ تصنيفات (إيجار، كهرباء، وقود، رواتب…) لتنظيم المصروفات." />
          ) : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">الاسم</th>
                    <th className="p-3 text-start font-semibold">عدد المصروفات</th>
                    <th className="p-3 text-start font-semibold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c.id} className="border-t transition-colors hover:bg-cream-100">
                      <td className="p-3 font-semibold">{c.name}</td>
                      <td className="p-3 tabular-nums">{c._count?.expenses ?? 0}</td>
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
          )}
        </TabsContent>
      </Tabs>

      {/* ===== مصروف جديد ===== */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>مصروف جديد</DialogTitle>
            <DialogDescription>
              المصروف النقدي يُصرف من الصندوق على الوردية المفتوحة — غير النقدي يُوثق بلا حركة صندوق.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>التصنيف *</Label>
              <Select value={nCategoryId || undefined} onValueChange={setNCategoryId}>
                <SelectTrigger className="h-10 w-full" aria-label="تصنيف المصروف"><SelectValue placeholder="اختر تصنيفًا" /></SelectTrigger>
                <SelectContent>
                  {activeCategories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeCategories.length === 0 ? (
                <p className="text-xs text-destructive">لا تصنيفات مفعّلة — أضف تصنيفًا من تبويب التصنيفات أولًا.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-amount">المبلغ ({settings.currencySymbol}) *</Label>
              <Input id="exp-amount" inputMode="decimal" value={nAmount} onChange={e => setNAmount(e.target.value)} className="h-10 tabular-nums" placeholder="0.00" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>طريقة الدفع</Label>
              <Select value={nMethod} onValueChange={setNMethod}>
                <SelectTrigger className="h-10 w-full" aria-label="طريقة الدفع"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-date">التاريخ</Label>
              <Input id="exp-date" type="date" value={nDate} onChange={e => setNDate(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="exp-beneficiary">المستفيد / الجهة</Label>
              <Input id="exp-beneficiary" value={nBeneficiary} onChange={e => setNBeneficiary(e.target.value)} className="h-10" placeholder="مثال: شركة الكهرباء" autoComplete="off" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="exp-note">سبب / ملاحظة</Label>
              <Textarea id="exp-note" value={nNote} onChange={e => setNNote(e.target.value)} rows={2} />
            </div>
          </div>
          {nError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{nError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setNewOpen(false)} disabled={nBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitNew()} disabled={nBusy || !nCategoryId}>
              {nBusy ? 'جارٍ التسجيل…' : 'تسجيل المصروف'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد إلغاء المصروف ===== */}
      <AlertDialog open={!!cancelTarget} onOpenChange={v => { if (!v) setCancelTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء المصروف؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيصبح المصروف ملغى بلا حذف — وإن كان نقديًا له حركة صندوق أصلية فسُجل حركة عكسية تعيد قيمته. الإلغاء متاح للمالك فقط وموثق في سجل التدقيق.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="exp-cancel-reason">سبب الإلغاء (إلزامي) *</Label>
            <Textarea id="exp-cancel-reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10">رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="h-10 bg-destructive text-white hover:bg-destructive/90"
              disabled={cancelBusy || !cancelReason.trim()}
              onClick={e => { e.preventDefault(); void cancelExpense() }}
            >
              {cancelBusy ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

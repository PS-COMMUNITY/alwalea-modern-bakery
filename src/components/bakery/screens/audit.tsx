'use client'

// =============================================================
// سجل التدقيق — للقراءة فقط، فلاتر (فترة/إجراء/مستخدم) وترقيم،
// تفاصيل JSON تُحلل بأمان وتُعرض كأزواج مفتاح/قيمة
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, TableShell,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Info, ScrollText, ShieldCheck } from 'lucide-react'

type AuditRow = {
  id: string
  date: string
  userId: string | null
  username: string | null
  action: string
  entityType: string | null
  entityId: string | null
  details: string | null
}

type ListResponse = { items: AuditRow[]; total: number; page: number; pageSize: number; pages: number }

const PAGE_SIZE = 30

/** الإجراءات بالعربية — تغطي كل ما يكتبه الخادم */
const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'دخول',
  LOGIN_FAILED: 'فشل دخول',
  LOGOUT: 'خروج',
  SETUP: 'إعداد النظام',
  SALE: 'فاتورة بيع',
  SALE_CANCEL: 'إلغاء بيع',
  PURCHASE: 'فاتورة شراء',
  PURCHASE_CANCEL: 'إلغاء شراء',
  PRODUCTION: 'إنتاج',
  PRODUCTION_CANCEL: 'إلغاء إنتاج',
  RECIPE_CREATE: 'إنشاء وصفة',
  RECIPE_UPDATE: 'تعديل وصفة',
  TRIP: 'جولة توزيع',
  TRIP_SALE: 'بيع جولة',
  TRIP_SETTLE: 'تسوية جولة',
  EXPENSE: 'مصروف',
  EXPENSE_CANCEL: 'إلغاء مصروف',
  EXPENSE_CATEGORY_CREATE: 'تصنيف مصروف',
  STOCK_ADJUST: 'جرد',
  WASTE: 'إعدام تالف',
  OPENING: 'رصيد افتتاحي',
  PAYMENT: 'دفعة',
  ADJUSTMENT: 'تسوية',
  SHIFT_OPEN: 'فتح وردية',
  SHIFT_CLOSE: 'إغلاق وردية',
  USER_CREATE: 'إنشاء مستخدم',
  USER_UPDATE: 'تعديل مستخدم',
  PRICE_UPDATE: 'تعديل سعر',
  SETTINGS_UPDATE: 'تعديل الإعدادات',
  BACKUP: 'نسخة احتياطية',
  RESTORE: 'استعادة',
  IMPORT: 'استيراد',
  EXPORT: 'تصدير',
}

/** إجراءات الفلتر — القائمة الأساسية الموثقة في المواصفة */
const FILTER_ACTIONS: { value: string; label: string }[] = [
  { value: 'LOGIN', label: 'دخول' },
  { value: 'LOGIN_FAILED', label: 'فشل دخول' },
  { value: 'SALE', label: 'فاتورة بيع' },
  { value: 'SALE_CANCEL', label: 'إلغاء بيع' },
  { value: 'PURCHASE', label: 'فاتورة شراء' },
  { value: 'PURCHASE_CANCEL', label: 'إلغاء شراء' },
  { value: 'PRODUCTION', label: 'إنتاج' },
  { value: 'TRIP', label: 'جولة' },
  { value: 'TRIP_SETTLE', label: 'تسوية جولة' },
  { value: 'EXPENSE', label: 'مصروف' },
  { value: 'STOCK_ADJUST', label: 'جرد' },
  { value: 'OPENING', label: 'افتتاحي' },
  { value: 'PAYMENT', label: 'دفعة' },
  { value: 'USER_CREATE', label: 'مستخدمون (إنشاء)' },
  { value: 'USER_UPDATE', label: 'مستخدمون (تعديل)' },
  { value: 'PRICE_UPDATE', label: 'تعديل سعر' },
  { value: 'SETTINGS_UPDATE', label: 'إعدادات' },
  { value: 'BACKUP', label: 'نسخة احتياطية' },
  { value: 'RESTORE', label: 'استعادة' },
  { value: 'IMPORT', label: 'استيراد' },
  { value: 'EXPORT', label: 'تصدير' },
]

const LABEL_KEYS: Record<string, string> = {
  invoiceNo: 'رقم الفاتورة', totalMinor: 'الإجمالي (أغورة)', paidMinor: 'المدفوع (أغورة)',
  amountMinor: 'المبلغ (أغورة)', countedCashMinor: 'النقد المعدود (أغورة)',
  openingCashMinor: 'الافتتاحي (أغورة)', expectedCashMinor: 'المتوقع (أغورة)',
  differenceMinor: 'الفرق (أغورة)', supplierName: 'المورد', customerName: 'العميل',
  productName: 'المنتج', categoryName: 'التصنيف', method: 'الطريقة', reason: 'السبب',
  newUsername: 'مستخدم جديد', role: 'الدور', batchNo: 'رقم الدفعة', tripNo: 'رقم الجولة',
  countedMilli: 'المعدود (ألفية)', currentMilli: 'الدفتري (ألفية)', diffMilli: 'الفرق (ألفية)',
}

function fmtISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** تحليل تفاصيل JSON بأمان — يعيد أزواجًا للعرض أو null */
function parseDetails(raw: string | null): [string, string][] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const out: [string, string][] = []
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const val = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
      out.push([LABEL_KEYS[k] ?? k, val])
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

function actionTone(action: string): string {
  if (action.endsWith('_CANCEL') || action === 'LOGIN_FAILED' || action === 'WASTE') {
    return 'border-destructive/50 bg-destructive/10 text-destructive'
  }
  if (action === 'LOGIN' || action === 'SETUP') {
    return 'border-ok-600/50 bg-ok-100 text-ok-700'
  }
  return 'border-copper-500/50 bg-copper-100 text-copper-700'
}

export function AuditScreen() {
  const { can } = useSession()
  const canView = can('audit.view')

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [action, setAction] = useState('')
  const [userId, setUserId] = useState('')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (action) params.set('action', action)
      if (userId.trim()) params.set('userId', userId.trim())
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))
      const res = await api.get<ListResponse>(`/api/audit?${params.toString()}`)
      setRows(res.items)
      setTotal(res.total)
      setPages(res.pages ?? Math.max(1, Math.ceil(res.total / PAGE_SIZE)))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذر تحميل سجل التدقيق')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [action, canView, from, page, to, userId])

  useEffect(() => {
    void load()
  }, [load])

  if (!canView) {
    return (
      <div>
        <PageHeader title="سجل التدقيق" subtitle="سجل موثق لكل العمليات الحساسة" />
        <EmptyState title="لا صلاحية عرض" hint="سجل التدقيق متاح لمن يملك صلاحية audit.view (المالك والمحاسب والمدير)." />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="سجل التدقيق"
        subtitle="كل عملية حساسة موثقة هنا بمستخدمها وتفاصيلها — بدون أسرار أبدًا"
      />

      {/* تنبيه القراءة فقط */}
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-ok-600/40 bg-ok-100/50 p-3 text-sm" role="note">
        <ShieldCheck className="h-5 w-5 shrink-0 text-ok-700" aria-hidden />
        <span className="font-semibold text-ok-700">سجل التدقيق للقراءة فقط — لا يمكن تعديله من أي واجهة.</span>
      </div>

      {/* الفلاتر */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="aud-from" className="text-xs">من</Label>
          <Input id="aud-from" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} className="h-10" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="aud-to" className="text-xs">إلى</Label>
          <Input id="aud-to" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }} className="h-10" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">الإجراء</Label>
          <Select value={action || 'all'} onValueChange={v => { setAction(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="h-10 w-44" aria-label="نوع الإجراء"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الإجراءات</SelectItem>
              {FILTER_ACTIONS.map(a => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-44 flex-1 space-y-1">
          <Label htmlFor="aud-user" className="text-xs">معرف المستخدم (اختياري)</Label>
          <Input id="aud-user" value={userId} onChange={e => { setUserId(e.target.value); setPage(1) }} placeholder="معرف المستخدم أو اتركه فارغًا" className="h-10" dir="ltr" autoComplete="off" />
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}

      {loading && !rows ? (
        <LoadingRows rows={7} />
      ) : rows && rows.length === 0 ? (
        <EmptyState title="لا سجلات مطابقة" hint="عدّل الفلاتر — السجل يبدأ من أول عملية في النظام." />
      ) : rows ? (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-cream-200">
                <tr>
                  <th className="p-3 text-start font-semibold">الوقت</th>
                  <th className="p-3 text-start font-semibold">المستخدم</th>
                  <th className="p-3 text-start font-semibold">الإجراء</th>
                  <th className="p-3 text-start font-semibold">الكيان</th>
                  <th className="p-3 text-start font-semibold">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const details = parseDetails(r.details)
                  return (
                    <tr key={r.id} className="border-t align-top transition-colors hover:bg-cream-100">
                      <td className="p-3 whitespace-nowrap text-muted-foreground">{dateTime(r.date)}</td>
                      <td className="p-3 font-semibold">{r.username ?? '—'}</td>
                      <td className="p-3">
                        <Badge variant="outline" className={cn('gap-1 whitespace-nowrap', actionTone(r.action))}>
                          {ACTION_LABELS[r.action] ?? r.action}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {r.entityType ?? '—'}
                        {r.entityId ? <span className="block font-mono text-[10px] text-muted-foreground" dir="ltr">{r.entityId.slice(0, 12)}…</span> : null}
                      </td>
                      <td className="p-3 max-w-72">
                        {details ? (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="flex max-w-full items-center gap-1 text-start text-xs text-muted-foreground underline decoration-dotted underline-offset-4"
                                  aria-label="عرض تفاصيل السجل"
                                >
                                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  <span className="truncate">
                                    {details.slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(' • ')}
                                  </span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-80">
                                <div className="space-y-1 text-xs">
                                  {details.map(([k, v]) => (
                                    <div key={k} className="flex gap-2">
                                      <span className="shrink-0 font-bold">{k}:</span>
                                      <span className="break-all" dir="auto">{v}</span>
                                    </div>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableShell>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
              <ScrollText className="h-4 w-4" aria-hidden />
              المجموع {total} — صفحة {page} من {pages}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-10" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="الصفحة السابقة">السابق</Button>
              <Button type="button" variant="outline" className="h-10" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="الصفحة التالية">التالي</Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

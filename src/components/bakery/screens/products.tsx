'use client'

// =============================================================
// المنتجات والتصنيفات — بحث وفلاتر، إضافة/تعديل، تعطيل/تفعيل (لا حذف نهائي)
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Category, Product } from '@/lib/bakery/types'
import { PRODUCT_TYPE_LABELS } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  EmptyState, ErrorBanner, LoadingRows, PageHeader, TableShell,
  qty as fmtQty,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { FolderPlus, Package, Pencil, Plus, Power, Search, Tags } from 'lucide-react'

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

const UNIT_OPTIONS = ['كغ', 'لتر', 'قطعة', 'عبوة', 'كيس']
const OTHER_UNIT = '__other__'

type ProductForm = {
  name: string
  code: string
  barcode: string
  categoryId: string
  type: string
  unitChoice: string
  unitCustom: string
  trackStock: boolean
  price: string
  wholesalePrice: string
  cost: string
  minStock: string
}

const EMPTY_FORM: ProductForm = {
  name: '', code: '', barcode: '', categoryId: '', type: 'FINISHED',
  unitChoice: 'قطعة', unitCustom: '', trackStock: true,
  price: '', wholesalePrice: '', cost: '', minStock: '0',
}

type CatForm = { name: string; active: boolean }

/** المنتج كما يعيده GET /api/products (يحمل رصيد المخزون الحالي) */
type ProductRow = Product & { stockMilli?: number }

export function ProductsScreen() {
  const { settings, money, can } = useSession()
  const { toast } = useToast()
  const canManage = can('products.manage')
  const canManageCats = can('categories.manage')

  // ===== فلاتر المنتجات =====
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [activeFilter, setActiveFilter] = useState('')

  const [rows, setRows] = useState<ProductRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState<Category[]>([])

  // ===== نموذج المنتج =====
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')

  // ===== تعطيل/تفعيل =====
  const [toggleTarget, setToggleTarget] = useState<Product | null>(null)
  const [toggleBusy, setToggleBusy] = useState(false)

  // ===== التصنيفات =====
  const [catDlgOpen, setCatDlgOpen] = useState(false)
  const [catEditing, setCatEditing] = useState<Category | null>(null)
  const [catForm, setCatForm] = useState<CatForm>({ name: '', active: true })
  const [catBusy, setCatBusy] = useState(false)
  const [catsLoading, setCatsLoading] = useState(false)
  const [catsError, setCatsError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 250)
    return () => clearTimeout(t)
  }, [qInput])

  const loadCategories = useCallback(async () => {
    setCatsLoading(true)
    setCatsError('')
    try {
      const res = await api.get<{ items: Category[]; total: number }>('/api/categories')
      setCategories(res.items)
    } catch (e) {
      setCatsError(e instanceof ApiError ? e.message : 'تعذر تحميل التصنيفات')
    } finally {
      setCatsLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (type) params.set('type', type)
      if (categoryId) params.set('categoryId', categoryId)
      if (activeFilter) params.set('active', activeFilter)
      const res = await api.get<{ items: ProductRow[]; total: number }>(`/api/products?${params.toString()}`)
      setRows(res.items)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذر تحميل المنتجات')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [activeFilter, categoryId, q, type])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  // ===== فتح النموذج =====
  async function openEdit(p: Product) {
    setEditingId(p.id)
    setFormError('')
    setFormOpen(true)
    try {
      const full = await api.get<{ product: Product; stockMilli: number }>(`/api/products/${p.id}`)
      const prod = full.product
      const isKnown = UNIT_OPTIONS.includes(prod.baseUnit)
      setForm({
        name: prod.name,
        code: prod.code ?? '',
        barcode: prod.barcode ?? '',
        categoryId: prod.categoryId ?? '',
        type: prod.type,
        unitChoice: isKnown ? prod.baseUnit : OTHER_UNIT,
        unitCustom: isKnown ? '' : prod.baseUnit,
        trackStock: prod.trackStock,
        price: (prod.priceMinor / 100).toString(),
        wholesalePrice: prod.wholesalePriceMinor !== null ? (prod.wholesalePriceMinor / 100).toString() : '',
        cost: (prod.costMinor / 100).toString(),
        minStock: fmtQty(prod.minStockMilli),
      })
    } catch (e) {
      toast({
        title: 'تعذر تحميل بيانات المنتج',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
      setFormOpen(false)
    }
  }

  function openNew() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setFormOpen(true)
  }

  async function submitForm() {
    setFormError('')
    const name = form.name.trim()
    if (!name) {
      setFormError('اسم المنتج مطلوب')
      return
    }
    const price = toMinorSafe(form.price)
    if (price === null) {
      setFormError('أدخل سعر بيع صحيحًا')
      return
    }
    const unit = form.unitChoice === OTHER_UNIT ? form.unitCustom.trim() : form.unitChoice
    if (!unit) {
      setFormError('أدخل وحدة القياس')
      return
    }
    const body: Record<string, unknown> = {
      name,
      code: form.code.trim() || null,
      barcode: form.barcode.trim() || null,
      categoryId: form.categoryId || null,
      type: form.type,
      baseUnit: unit,
      trackStock: form.trackStock,
      priceMinor: price,
      wholesalePriceMinor: toMinorSafe(form.wholesalePrice),
      costMinor: toMinorSafe(form.cost) ?? 0,
      minStockMilli: toMilliSafe(form.minStock) ?? 0,
    }

    setFormBusy(true)
    try {
      if (editingId) {
        await api.put(`/api/products/${editingId}`, body)
        toast({ title: 'تم حفظ تعديلات المنتج' })
      } else {
        await api.post('/api/products', body)
        toast({ title: `تم إضافة المنتج «${name}»` })
      }
      setFormOpen(false)
      void load()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'تعذر حفظ المنتج')
    } finally {
      setFormBusy(false)
    }
  }

  async function toggleActive() {
    if (!toggleTarget) return
    setToggleBusy(true)
    try {
      await api.put(`/api/products/${toggleTarget.id}`, { active: !toggleTarget.active })
      toast({ title: toggleTarget.active ? `تم تعطيل «${toggleTarget.name}»` : `تم تفعيل «${toggleTarget.name}»` })
      setToggleTarget(null)
      void load()
    } catch (e) {
      toast({
        title: 'تعذر تغيير حالة المنتج',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setToggleBusy(false)
    }
  }

  // ===== التصنيفات =====
  function openCatNew() {
    setCatEditing(null)
    setCatForm({ name: '', active: true })
    setCatDlgOpen(true)
  }
  function openCatEdit(c: Category) {
    setCatEditing(c)
    setCatForm({ name: c.name, active: c.active })
    setCatDlgOpen(true)
  }

  async function submitCat() {
    const name = catForm.name.trim()
    if (!name) return
    setCatBusy(true)
    try {
      if (catEditing) {
        await api.put(`/api/categories/${catEditing.id}`, { name, active: catForm.active })
        toast({ title: 'تم حفظ التصنيف' })
      } else {
        await api.post('/api/categories', { name })
        toast({ title: `تم إضافة التصنيف «${name}»` })
      }
      setCatDlgOpen(false)
      void loadCategories()
    } catch (e) {
      toast({
        title: 'تعذر حفظ التصنيف',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setCatBusy(false)
    }
  }

  const isLow = (p: ProductRow) => p.trackStock && (p.stockMilli ?? 0) <= Math.max(p.minStockMilli, 0)

  return (
    <div>
      <PageHeader title="المنتجات والتصنيفات" subtitle="كتالوج المنتجات وتصنيفاتها — لا حذف نهائي، التعطيل فقط" />

      <Tabs defaultValue="products">
        <TabsList className="mb-4 h-11">
          <TabsTrigger value="products" className="gap-2 px-4">
            <Package className="h-4 w-4" aria-hidden />
            المنتجات
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2 px-4">
            <Tags className="h-4 w-4" aria-hidden />
            التصنيفات
          </TabsTrigger>
        </TabsList>

        {/* ==================== تبويب المنتجات ==================== */}
        <TabsContent value="products">
          <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="فلاتر المنتجات">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={qInput}
                onChange={e => setQInput(e.target.value)}
                placeholder="بحث بالاسم أو الكود أو الباركود…"
                className="h-10 ps-9"
                aria-label="بحث في المنتجات"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">النوع</Label>
              <Select value={type || 'all'} onValueChange={v => setType(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-10 w-36" aria-label="نوع المنتج"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {Object.entries(PRODUCT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">التصنيف</Label>
              <Select value={categoryId || 'all'} onValueChange={v => setCategoryId(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-10 w-40" aria-label="التصنيف"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الحالة</Label>
              <Select value={activeFilter || 'all'} onValueChange={v => setActiveFilter(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-10 w-32" aria-label="حالة المنتج"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="true">مفعّل</SelectItem>
                  <SelectItem value="false">معطّل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canManage ? (
              <Button type="button" className="h-10" onClick={openNew}>
                <Plus className="h-4 w-4" aria-hidden />
                منتج جديد
              </Button>
            ) : null}
          </div>

          {error ? <ErrorBanner message={error} onRetry={load} /> : null}

          {loading && !rows ? (
            <LoadingRows rows={6} />
          ) : rows && rows.length === 0 ? (
            <EmptyState
              title="لا منتجات مطابقة"
              hint="عدّل الفلاتر أو أضف منتجًا جديدًا لتبدأ البيع."
              action={canManage ? (
                <Button type="button" className="mt-2 h-10" onClick={openNew}>
                  <Plus className="h-4 w-4" aria-hidden />
                  منتج جديد
                </Button>
              ) : undefined}
            />
          ) : rows ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">الاسم</th>
                    <th className="p-3 text-start font-semibold">الكود</th>
                    <th className="p-3 text-start font-semibold">التصنيف</th>
                    <th className="p-3 text-start font-semibold">النوع</th>
                    <th className="p-3 text-start font-semibold">الوحدة</th>
                    <th className="p-3 text-start font-semibold">سعر البيع</th>
                    <th className="p-3 text-start font-semibold">التكلفة</th>
                    <th className="p-3 text-start font-semibold">الرصيد</th>
                    <th className="p-3 text-start font-semibold">الحالة</th>
                    {canManage ? <th className="p-3 text-start font-semibold">إجراءات</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={p.id} className="border-t transition-colors hover:bg-cream-100">
                      <td className="p-3">
                        <span className="font-semibold">{p.name}</span>
                        {p.barcode ? <span className="block font-mono text-xs text-muted-foreground" dir="ltr">{p.barcode}</span> : null}
                      </td>
                      <td className="p-3 font-mono text-xs" dir="ltr">{p.code ?? '—'}</td>
                      <td className="p-3">{p.category?.name ?? '—'}</td>
                      <td className="p-3">
                        <Badge variant="secondary">{PRODUCT_TYPE_LABELS[p.type] ?? p.type}</Badge>
                      </td>
                      <td className="p-3">{p.baseUnit}</td>
                      <td className="p-3 font-semibold tabular-nums">{money(p.priceMinor)}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">{money(p.costMinor)}</td>
                      <td className={cn('p-3 font-semibold tabular-nums', isLow(p) && 'text-destructive')}>
                        {p.trackStock ? `${fmtQty(p.stockMilli ?? 0)} ${p.baseUnit}` : '—'}
                        {isLow(p) ? <span className="ms-1 text-xs">(الحد {fmtQty(p.minStockMilli)})</span> : null}
                      </td>
                      <td className="p-3">
                        {p.active ? (
                          <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مفعّل</Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1"><span aria-hidden>⏸</span> معطّل</Badge>
                        )}
                      </td>
                      {canManage ? (
                        <td className="p-3">
                          <div className="flex gap-1.5">
                            <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => void openEdit(p)} aria-label={`تعديل ${p.name}`}>
                              <Pencil className="h-4 w-4" aria-hidden />
                              تعديل
                            </Button>
                            <Button
                              type="button"
                              variant={p.active ? 'ghost' : 'outline'}
                              size="sm"
                              className={cn('h-9', p.active && 'text-destructive hover:text-destructive')}
                              onClick={() => setToggleTarget(p)}
                              aria-label={p.active ? `تعطيل ${p.name}` : `تفعيل ${p.name}`}
                            >
                              <Power className="h-4 w-4" aria-hidden />
                              {p.active ? 'تعطيل' : 'تفعيل'}
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : null}
        </TabsContent>

        {/* ==================== تبويب التصنيفات ==================== */}
        <TabsContent value="categories">
          <div className="mb-4 flex justify-end">
            {canManageCats ? (
              <Button type="button" className="h-10" onClick={openCatNew}>
                <FolderPlus className="h-4 w-4" aria-hidden />
                تصنيف جديد
              </Button>
            ) : null}
          </div>

          {catsError ? <ErrorBanner message={catsError} onRetry={loadCategories} /> : null}

          {catsLoading ? (
            <LoadingRows rows={3} />
          ) : categories.length === 0 ? (
            <EmptyState title="لا تصنيفات بعد" hint="أنشئ تصنيفات لتنظيم منتجاتك (خبز، معجنات، مواد خام…)." />
          ) : (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">الاسم</th>
                    <th className="p-3 text-start font-semibold">عدد المنتجات</th>
                    <th className="p-3 text-start font-semibold">الحالة</th>
                    {canManageCats ? <th className="p-3 text-start font-semibold">إجراءات</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c.id} className="border-t transition-colors hover:bg-cream-100">
                      <td className="p-3 font-semibold">{c.name}</td>
                      <td className="p-3 tabular-nums">{c._count?.products ?? 0}</td>
                      <td className="p-3">
                        {c.active ? (
                          <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مفعّل</Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1"><span aria-hidden>⏸</span> معطّل</Badge>
                        )}
                      </td>
                      {canManageCats ? (
                        <td className="p-3">
                          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => openCatEdit(c)} aria-label={`تعديل تصنيف ${c.name}`}>
                            <Pencil className="h-4 w-4" aria-hidden />
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
        </TabsContent>
      </Tabs>

      {/* ===== نموذج المنتج (إضافة/تعديل) ===== */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'تعديل منتج' : 'منتج جديد'}</DialogTitle>
            <DialogDescription>
              الأموال تُحفظ بالأغورة والكميات بالألفية تلقائيًا — أدخل القيم كما تظهر على الشاشة.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-name">اسم المنتج *</Label>
              <Input id="p-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-code">الكود</Label>
              <Input id="p-code" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="h-10" dir="ltr" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-barcode">الباركود</Label>
              <Input id="p-barcode" value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} className="h-10" dir="ltr" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>التصنيف</Label>
              <Select value={form.categoryId || '__none__'} onValueChange={v => setForm(f => ({ ...f, categoryId: v === '__none__' ? '' : v }))}>
                <SelectTrigger className="h-10 w-full" aria-label="التصنيف"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">بدون تصنيف</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>النوع</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="h-10 w-full" aria-label="نوع المنتج"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRODUCT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>وحدة القياس</Label>
              <Select value={form.unitChoice} onValueChange={v => setForm(f => ({ ...f, unitChoice: v }))}>
                <SelectTrigger className="h-10 w-full" aria-label="وحدة القياس"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map(u => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                  <SelectItem value={OTHER_UNIT}>أخرى…</SelectItem>
                </SelectContent>
              </Select>
              {form.unitChoice === OTHER_UNIT ? (
                <Input
                  value={form.unitCustom}
                  onChange={e => setForm(f => ({ ...f, unitCustom: e.target.value }))}
                  placeholder="اكتب الوحدة (مثال: صينية)"
                  className="h-10"
                  autoComplete="off"
                  aria-label="وحدة قياس مخصصة"
                />
              ) : null}
            </div>
            <div className="flex items-end gap-3 pb-1">
              <div className="flex items-center gap-2">
                <Switch
                  id="p-track"
                  checked={form.trackStock}
                  onCheckedChange={v => setForm(f => ({ ...f, trackStock: v }))}
                />
                <Label htmlFor="p-track">تتبع المخزون</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-price">سعر البيع ({settings.currencySymbol}) *</Label>
              <Input id="p-price" inputMode="decimal" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className="h-10 tabular-nums" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-wprice">سعر الجملة (اختياري)</Label>
              <Input id="p-wprice" inputMode="decimal" value={form.wholesalePrice} onChange={e => setForm(f => ({ ...f, wholesalePrice: e.target.value }))} className="h-10 tabular-nums" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-cost">التكلفة ({settings.currencySymbol})</Label>
              <Input id="p-cost" inputMode="decimal" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} className="h-10 tabular-nums" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-minstock">الحد الأدنى للمخزون ({form.unitChoice === OTHER_UNIT ? 'الوحدة' : form.unitChoice})</Label>
              <Input id="p-minstock" inputMode="decimal" value={form.minStock} onChange={e => setForm(f => ({ ...f, minStock: e.target.value }))} className="h-10 tabular-nums" autoComplete="off" />
            </div>
          </div>

          {formError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{formError}</p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setFormOpen(false)} disabled={formBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitForm()} disabled={formBusy}>
              {formBusy ? 'جارٍ الحفظ…' : editingId ? 'حفظ التعديلات' : 'إضافة المنتج'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد التعطيل/التفعيل ===== */}
      <AlertDialog open={!!toggleTarget} onOpenChange={v => { if (!v) setToggleTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.active ? `تعطيل «${toggleTarget?.name}»؟` : `تفعيل «${toggleTarget?.name}»؟`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              المنتج المستخدم في حركات لا يُحذف — يُعطّل فقط، ويختفي من نقطة البيع دون فقدان سجلاته.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10">رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="h-10"
              disabled={toggleBusy}
              onClick={e => { e.preventDefault(); void toggleActive() }}
            >
              {toggleBusy ? 'جارٍ التنفيذ…' : 'تأكيد'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== نموذج التصنيف ===== */}
      <Dialog open={catDlgOpen} onOpenChange={setCatDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{catEditing ? 'تعديل تصنيف' : 'تصنيف جديد'}</DialogTitle>
            <DialogDescription>اسم التصنيف يجب أن يكون فريدًا.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">اسم التصنيف *</Label>
              <Input id="cat-name" value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            {catEditing ? (
              <div className="flex items-center gap-2">
                <Switch id="cat-active" checked={catForm.active} onCheckedChange={v => setCatForm(f => ({ ...f, active: v }))} />
                <Label htmlFor="cat-active">مفعّل</Label>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setCatDlgOpen(false)} disabled={catBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitCat()} disabled={catBusy || !catForm.name.trim()}>
              {catBusy ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

// =============================================================
// الإنتاج والوصفات — دفعات إنتاج بكفاءة، وصفات بمواد وتكلفة محسوبة
// =============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Product } from '@/lib/bakery/types'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, TableShell,
  qty as fmtQty,
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
import { AlertTriangle, ChefHat, Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react'

type ProductRow = Product & { stockMilli?: number }

type RecipeItem = {
  id?: string
  productId: string
  qtyMilli: number
  product: { id: string; name: string; type?: string; baseUnit: string; costMinor: number }
}

type Recipe = {
  id: string
  name: string
  outputProductId: string
  outputQtyMilli: number
  active: boolean
  notes: string | null
  outputProduct: { id: string; name: string; type?: string; baseUnit: string; costMinor: number }
  items: RecipeItem[]
  materialsCostMinor?: number
  unitCostMinor?: number
}

type Batch = {
  id: string
  batchNo: string
  date: string
  plannedQtyMilli: number
  actualQtyMilli: number
  wasteQtyMilli: number
  materialsCostMinor: number
  unitCostMinor: number
  status: 'COMPLETED' | 'CANCELLED'
  notes: string | null
  voidReason?: string | null
  recipe: { id: string; name: string; outputQtyMilli: number; outputProduct: { id: string; name: string; baseUnit: string } }
  efficiencyPercent: number
}

type InventoryItem = { productId: string; qtyMilli: number }

type DraftMaterial = { key: number; productId: string; qty: string }

let draftKey = 1
const nextKey = () => draftKey++

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

/** تكلفة المواد بنفس صيغة الـ API: Σ Math.round(qtyMilli × costMinor / 1000) */
function materialsCost(items: { qtyMilli: number; product: { costMinor: number } }[]): number {
  return items.reduce((s, it) => s + Math.round((it.qtyMilli * it.product.costMinor) / 1000), 0)
}

export function ProductionScreen() {
  const { money, can } = useSession()
  const { toast } = useToast()
  const canManage = can('production.manage')

  // ===== الدفعات =====
  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(fmtISO(new Date()))
  const [batches, setBatches] = useState<Batch[] | null>(null)
  const [batchLoading, setBatchLoading] = useState(true)
  const [batchError, setBatchError] = useState('')

  // ===== الوصفات =====
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [recipesLoading, setRecipesLoading] = useState(true)
  const [recipesError, setRecipesError] = useState('')

  // ===== قوائم مساعدة =====
  const [products, setProducts] = useState<ProductRow[]>([])
  const [inventory, setInventory] = useState<Map<string, number>>(new Map())

  // ===== حوار وصفة (إضافة/تعديل) =====
  const [recipeOpen, setRecipeOpen] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [rName, setRName] = useState('')
  const [rOutputId, setROutputId] = useState('')
  const [rOutputQty, setROutputQty] = useState('')
  const [rMaterials, setRMaterials] = useState<DraftMaterial[]>([])
  const [rNotes, setRNotes] = useState('')
  const [rBusy, setRBusy] = useState(false)
  const [rError, setRError] = useState('')

  // ===== حوار دفعة إنتاج =====
  const [batchOpen, setBatchOpen] = useState(false)
  const [bRecipeId, setBRecipeId] = useState('')
  const [bActual, setBActual] = useState('')
  const [bWaste, setBWaste] = useState('0')
  const [bNotes, setBNotes] = useState('')
  const [bBusy, setBBusy] = useState(false)
  const [bError, setBError] = useState('')

  // ===== إلغاء دفعة =====
  const [cancelTarget, setCancelTarget] = useState<Batch | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)

  // ===== التحميل =====
  const loadBatches = useCallback(async () => {
    setBatchLoading(true)
    setBatchError('')
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await api.get<Batch[]>(`/api/production?${params.toString()}`)
      setBatches(res)
    } catch (e) {
      setBatchError(e instanceof ApiError ? e.message : 'تعذر تحميل الدفعات')
      setBatches(null)
    } finally {
      setBatchLoading(false)
    }
  }, [from, to])

  const loadRecipes = useCallback(async () => {
    setRecipesLoading(true)
    setRecipesError('')
    try {
      const res = await api.get<Recipe[]>('/api/recipes')
      setRecipes(res)
    } catch (e) {
      setRecipesError(e instanceof ApiError ? e.message : 'تعذر تحميل الوصفات')
      setRecipes(null)
    } finally {
      setRecipesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBatches()
  }, [loadBatches])

  useEffect(() => {
    void loadRecipes()
  }, [loadRecipes])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [prods, inv] = await Promise.all([
          api.get<{ items: ProductRow[]; total: number }>('/api/products'),
          api.get<{ items: InventoryItem[]; total: number }>('/api/inventory'),
        ])
        if (!cancelled) {
          setProducts(prods.items)
          setInventory(new Map(inv.items.map(x => [x.productId, x.qtyMilli])))
        }
      } catch {
        // القوائم المساعدة اختيارية
      }
    })()
    return () => { cancelled = true }
  }, [])

  const activeRecipes = useMemo(() => (recipes ?? []).filter(r => r.active), [recipes])

  // ===== نموذج الوصفة =====
  const finishedProducts = products.filter(p => p.type === 'FINISHED')
  // مواد الوصفة: أي منتج عدا الناتج نفسه (تُستبعد من القائمة أدناه)
  const rawProducts = products
  const rMaterialCost = rMaterials.reduce((s, it) => {
    const qty = toMilliSafe(it.qty) ?? 0
    const cost = products.find(p => p.id === it.productId)?.costMinor ?? 0
    return s + Math.round((qty * cost) / 1000)
  }, 0)
  const rOutputMilli = toMilliSafe(rOutputQty) ?? 0
  const rUnitCost = rOutputMilli > 0 ? Math.round((rMaterialCost * 1000) / rOutputMilli) : 0

  function openRecipeNew() {
    setEditingRecipe(null)
    setRName('')
    setROutputId('')
    setROutputQty('')
    setRMaterials([{ key: nextKey(), productId: '', qty: '' }])
    setRNotes('')
    setRError('')
    setRecipeOpen(true)
  }

  async function openRecipeEdit(r: Recipe) {
    setEditingRecipe(r)
    setRError('')
    setRecipeOpen(true)
    try {
      const full = await api.get<Recipe>(`/api/recipes/${r.id}`)
      setRName(full.name)
      setROutputId(full.outputProductId)
      setROutputQty(fmtQty(full.outputQtyMilli))
      setRMaterials(full.items.map(it => ({ key: nextKey(), productId: it.productId, qty: fmtQty(it.qtyMilli) })))
      setRNotes(full.notes ?? '')
    } catch (e) {
      toast({
        title: 'تعذر تحميل الوصفة',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
      setRecipeOpen(false)
    }
  }

  async function submitRecipe() {
    setRError('')
    const name = rName.trim()
    if (!name) {
      setRError('اسم الوصفة مطلوب')
      return
    }
    if (!rOutputId) {
      setRError('اختر المنتج الناتج')
      return
    }
    if (rOutputMilli <= 0) {
      setRError('أدخل كمية الناتج المتوقعة')
      return
    }
    const items = rMaterials
      .map(it => ({ productId: it.productId, qtyMilli: toMilliSafe(it.qty) ?? 0 }))
      .filter(it => it.productId && it.qtyMilli > 0)
    if (items.length === 0) {
      setRError('أضف مادة خام واحدة على الأقل بكمية صحيحة')
      return
    }
    const ids = items.map(i => i.productId)
    if (new Set(ids).size !== ids.length) {
      setRError('لا تكرر نفس المادة — ادمجها في سطر واحد')
      return
    }
    if (ids.includes(rOutputId)) {
      setRError('لا يمكن أن يكون الناتج نفسه ضمن مواد الوصفة')
      return
    }
    setRBusy(true)
    try {
      if (editingRecipe) {
        await api.put(`/api/recipes/${editingRecipe.id}`, {
          name,
          outputProductId: rOutputId,
          outputQtyMilli: rOutputMilli,
          items,
          notes: rNotes.trim() || undefined,
        })
        toast({ title: 'تم حفظ تعديلات الوصفة' })
      } else {
        await api.post('/api/recipes', {
          name,
          outputProductId: rOutputId,
          outputQtyMilli: rOutputMilli,
          items,
          notes: rNotes.trim() || undefined,
        })
        toast({ title: `تم إنشاء الوصفة «${name}»` })
      }
      setRecipeOpen(false)
      void loadRecipes()
    } catch (e) {
      setRError(e instanceof ApiError ? e.message : 'تعذر حفظ الوصفة')
    } finally {
      setRBusy(false)
    }
  }

  // ===== دفعة إنتاج =====
  const selectedRecipe = activeRecipes.find(r => r.id === bRecipeId) ?? null
  const bActualMilli = toMilliSafe(bActual) ?? 0
  const bWasteMilli = toMilliSafe(bWaste) ?? 0

  /** المواد المطلوبة للدفعة الحالية وفق نسبة التحويل — نفس صيغة الـ API */
  const requiredMaterials = useMemo(() => {
    if (!selectedRecipe || bActualMilli <= 0) return []
    return selectedRecipe.items.map(it => ({
      productId: it.productId,
      name: it.product.name,
      baseUnit: it.product.baseUnit,
      required: Math.round((it.qtyMilli * bActualMilli) / selectedRecipe.outputQtyMilli),
    }))
  }, [selectedRecipe, bActualMilli])

  const bMaterialsCost = useMemo(() => {
    if (!selectedRecipe || bActualMilli <= 0) return 0
    return selectedRecipe.items.reduce((s, it) => {
      const required = Math.round((it.qtyMilli * bActualMilli) / selectedRecipe.outputQtyMilli)
      return s + Math.round((required * it.product.costMinor) / 1000)
    }, 0)
  }, [selectedRecipe, bActualMilli])

  function openBatch() {
    setBRecipeId('')
    setBActual('')
    setBWaste('0')
    setBNotes('')
    setBError('')
    setBatchOpen(true)
  }

  async function submitBatch() {
    setBError('')
    if (!bRecipeId) {
      setBError('اختر الوصفة')
      return
    }
    if (bActualMilli <= 0) {
      setBError('أدخل الكمية الفعلية المنتجة')
      return
    }
    if (bWasteMilli < 0) {
      setBError('كمية الهدر يجب أن تكون صفرًا أو أكثر')
      return
    }
    setBBusy(true)
    try {
      const batch = await api.post<Batch>('/api/production', {
        recipeId: bRecipeId,
        actualQtyMilli: bActualMilli,
        wasteQtyMilli: bWasteMilli,
        notes: bNotes.trim() || undefined,
      })
      toast({
        title: `تم تسجيل دفعة ${batch.batchNo}`,
        description: `خصمت المواد ودخل الناتج للمخزون — تكلفة الوحدة ${money(batch.unitCostMinor)}.`,
      })
      setBatchOpen(false)
      void loadBatches()
    } catch (e) {
      setBError(e instanceof ApiError ? e.message : 'تعذر تسجيل الدفعة')
    } finally {
      setBBusy(false)
    }
  }

  // ===== إلغاء دفعة =====
  async function cancelBatch() {
    if (!cancelTarget) return
    if (!cancelReason.trim()) return
    setCancelBusy(true)
    try {
      await api.post(`/api/production/${cancelTarget.id}/cancel`, { reason: cancelReason.trim() })
      toast({ title: `تم إلغاء الدفعة ${cancelTarget.batchNo}`, description: 'عادت المواد للمخزون وخارج الناتج.' })
      setCancelTarget(null)
      setCancelReason('')
      void loadBatches()
    } catch (e) {
      toast({
        title: 'تعذر إلغاء الدفعة',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setCancelBusy(false)
    }
  }

  function efficiencyTone(pct: number) {
    if (pct >= 95) return 'bg-ok-600 text-white'
    if (pct >= 80) return 'bg-copper-500 text-white'
    return 'bg-destructive text-white'
  }

  return (
    <div>
      <PageHeader
        title="الإنتاج والوصفات"
        subtitle="دفعات الإنتاج تخصم المواد وتضيف الناتج بتكلفة محسوبة — داخل معاملة واحدة"
        actions={canManage ? (
          <Button type="button" className="h-10" onClick={openBatch}>
            <ChefHat className="h-4 w-4" aria-hidden />
            دفعة إنتاج
          </Button>
        ) : null}
      />

      <Tabs defaultValue="batches">
        <TabsList className="mb-4 h-11">
          <TabsTrigger value="batches" className="gap-2 px-4">
            <ChefHat className="h-4 w-4" aria-hidden />
            دفعات الإنتاج
          </TabsTrigger>
          <TabsTrigger value="recipes" className="gap-2 px-4">
            <UtensilsCrossed className="h-4 w-4" aria-hidden />
            الوصفات
          </TabsTrigger>
        </TabsList>

        {/* ==================== دفعات الإنتاج ==================== */}
        <TabsContent value="batches">
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="prd-from" className="text-xs">من</Label>
              <Input id="prd-from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prd-to" className="text-xs">إلى</Label>
              <Input id="prd-to" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-10" />
            </div>
          </div>

          {batchError ? <ErrorBanner message={batchError} onRetry={loadBatches} /> : null}

          {batchLoading && !batches ? (
            <LoadingRows rows={6} />
          ) : batches && batches.length === 0 ? (
            <EmptyState
              title="لا دفعات إنتاج في هذه الفترة"
              hint="سجّل دفعة إنتاج من زر «دفعة إنتاج» بعد تجهيز وصفة."
              action={canManage ? (
                <Button type="button" className="mt-2 h-10" onClick={openBatch}>
                  <ChefHat className="h-4 w-4" aria-hidden />
                  دفعة إنتاج
                </Button>
              ) : undefined}
            />
          ) : batches ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-cream-200">
                  <tr>
                    <th className="p-3 text-start font-semibold">رقم الدفعة</th>
                    <th className="p-3 text-start font-semibold">التاريخ</th>
                    <th className="p-3 text-start font-semibold">الوصفة</th>
                    <th className="p-3 text-start font-semibold">مخطط</th>
                    <th className="p-3 text-start font-semibold">فعلي</th>
                    <th className="p-3 text-start font-semibold">هدر</th>
                    <th className="p-3 text-start font-semibold">تكلفة المواد</th>
                    <th className="p-3 text-start font-semibold">تكلفة الوحدة</th>
                    <th className="p-3 text-start font-semibold">الكفاءة</th>
                    <th className="p-3 text-start font-semibold">الحالة</th>
                    {canManage ? <th className="p-3 text-start font-semibold">إجراءات</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id} className="border-t transition-colors hover:bg-cream-100">
                      <td className="p-3 font-mono text-xs" dir="ltr">{b.batchNo}</td>
                      <td className="p-3 text-muted-foreground">{dateTime(b.date)}</td>
                      <td className="p-3 font-semibold">
                        {b.recipe.name}
                        <span className="block text-xs text-muted-foreground">{b.recipe.outputProduct.name}</span>
                      </td>
                      <td className="p-3 tabular-nums">{fmtQty(b.plannedQtyMilli)} {b.recipe.outputProduct.baseUnit}</td>
                      <td className="p-3 font-semibold tabular-nums">{fmtQty(b.actualQtyMilli)}</td>
                      <td className={cn('p-3 tabular-nums', b.wasteQtyMilli > 0 && 'text-destructive')}>{fmtQty(b.wasteQtyMilli)}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">{money(b.materialsCostMinor)}</td>
                      <td className="p-3 tabular-nums">{money(b.unitCostMinor)}</td>
                      <td className="p-3">
                        {b.status === 'CANCELLED' ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge className={efficiencyTone(b.efficiencyPercent)}>{b.efficiencyPercent}%</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        {b.status === 'COMPLETED' ? (
                          <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مكتملة</Badge>
                        ) : (
                          <Badge variant="outline" className="border-destructive/50 text-destructive gap-1"><span aria-hidden>✕</span> ملغاة</Badge>
                        )}
                      </td>
                      {canManage ? (
                        <td className="p-3">
                          {b.status === 'COMPLETED' ? (
                            <Button type="button" variant="ghost" size="sm" className="h-9 text-destructive hover:text-destructive" onClick={() => { setCancelTarget(b); setCancelReason('') }}>
                              إلغاء
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : null}
        </TabsContent>

        {/* ==================== الوصفات ==================== */}
        <TabsContent value="recipes">
          <div className="mb-4 flex justify-end">
            {canManage ? (
              <Button type="button" className="h-10" onClick={openRecipeNew}>
                <Plus className="h-4 w-4" aria-hidden />
                وصفة جديدة
              </Button>
            ) : null}
          </div>

          {recipesError ? <ErrorBanner message={recipesError} onRetry={loadRecipes} /> : null}

          {recipesLoading && !recipes ? (
            <LoadingRows rows={4} />
          ) : recipes && recipes.length === 0 ? (
            <EmptyState
              title="لا وصفات بعد"
              hint="الوصفة تحدد الناتج وكميته المتوقعة والمواد الخام اللازمة — تُستخدم لحساب تكلفة الإنتاج."
              action={canManage ? (
                <Button type="button" className="mt-2 h-10" onClick={openRecipeNew}>
                  <Plus className="h-4 w-4" aria-hidden />
                  وصفة جديدة
                </Button>
              ) : undefined}
            />
          ) : recipes ? (
            <div className="grid gap-3 md:grid-cols-2">
              {recipes.map(r => {
                const items = r.items
                const cost = materialsCost(items)
                const unitCost = r.outputQtyMilli > 0 ? Math.round((cost * 1000) / r.outputQtyMilli) : 0
                return (
                  <div key={r.id} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold">{r.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          الناتج: <b className="text-cocoa-900 dark:text-cream-100">{r.outputProduct.name}</b> — {fmtQty(r.outputQtyMilli)} {r.outputProduct.baseUnit}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!r.active ? <Badge variant="outline" className="gap-1"><span aria-hidden>⏸</span> معطّلة</Badge> : null}
                        {canManage ? (
                          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => void openRecipeEdit(r)} aria-label={`تعديل وصفة ${r.name}`}>
                            <Pencil className="h-4 w-4" aria-hidden />
                            تعديل
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 overflow-hidden rounded-lg border">
                      <table className="w-full text-xs">
                        <thead className="bg-cream-200">
                          <tr>
                            <th className="p-2 text-start font-semibold">المادة</th>
                            <th className="p-2 text-start font-semibold">الكمية</th>
                            <th className="p-2 text-start font-semibold">التكلفة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(it => (
                            <tr key={it.productId} className="border-t">
                              <td className="p-2">{it.product.name}</td>
                              <td className="p-2 tabular-nums">{fmtQty(it.qtyMilli)} {it.product.baseUnit}</td>
                              <td className="p-2 tabular-nums">{money(Math.round((it.qtyMilli * it.product.costMinor) / 1000))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>تكلفة المواد: <b className="tabular-nums">{money(cost)}</b></span>
                      <span>تكلفة وحدة الناتج: <b className="tabular-nums">{money(unitCost)} / {r.outputProduct.baseUnit}</b></span>
                    </div>
                    {r.notes ? <p className="mt-2 text-xs text-muted-foreground">{r.notes}</p> : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {/* ===== حوار وصفة جديدة/تعديل ===== */}
      <Dialog open={recipeOpen} onOpenChange={setRecipeOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRecipe ? 'تعديل وصفة' : 'وصفة جديدة'}</DialogTitle>
            <DialogDescription>
              الناتج منتج مصنّع (FINISHED) والمواد أي منتجات أخرى — الحفظ يستبدل بنود الوصفة كاملة.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="r-name">اسم الوصفة *</Label>
                <Input id="r-name" value={rName} onChange={e => setRName(e.target.value)} className="h-10" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-notes">ملاحظات (اختياري)</Label>
                <Input id="r-notes" value={rNotes} onChange={e => setRNotes(e.target.value)} className="h-10" autoComplete="off" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>المنتج الناتج *</Label>
                <Select value={rOutputId || undefined} onValueChange={setROutputId}>
                  <SelectTrigger className="h-10 w-full" aria-label="المنتج الناتج"><SelectValue placeholder="منتج مصنّع (FINISHED)" /></SelectTrigger>
                  <SelectContent>
                    {finishedProducts.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.baseUnit})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {finishedProducts.length === 0 ? (
                  <p className="text-xs text-destructive">لا منتجات مصنّعة — أنشئ منتجًا من نوع «منتج مصنّع» أولًا.</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-output-qty">الكمية المتوقعة ({products.find(p => p.id === rOutputId)?.baseUnit ?? 'الوحدة'}) *</Label>
                <Input id="r-output-qty" inputMode="decimal" value={rOutputQty} onChange={e => setROutputQty(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
              </div>
            </div>

            {/* المواد */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold">مواد الوصفة *</Label>
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setRMaterials(v => [...v, { key: nextKey(), productId: '', qty: '' }])}>
                  <Plus className="h-4 w-4" aria-hidden />
                  أضف مادة
                </Button>
              </div>
              {rMaterials.map((it, idx) => (
                <div key={it.key} className="grid grid-cols-2 items-end gap-2 rounded-xl border bg-cream-100/40 p-2.5 sm:grid-cols-[1fr_130px_40px]">
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <Label className="text-xs">المادة {idx + 1}</Label>
                    <Select value={it.productId || undefined} onValueChange={v => setRMaterials(list => list.map(x => x.key === it.key ? { ...x, productId: v } : x))}>
                      <SelectTrigger className="h-10 w-full" aria-label="المادة"><SelectValue placeholder="اختر مادة" /></SelectTrigger>
                      <SelectContent>
                        {rawProducts.filter(p => p.id !== rOutputId).map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name} ({p.baseUnit})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">الكمية</Label>
                    <Input inputMode="decimal" value={it.qty} onChange={e => setRMaterials(list => list.map(x => x.key === it.key ? { ...x, qty: e.target.value } : x))} className="h-10 tabular-nums" autoComplete="off" aria-label="كمية المادة" />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 text-destructive hover:text-destructive"
                    onClick={() => setRMaterials(list => list.filter(x => x.key !== it.key))}
                    disabled={rMaterials.length <= 1}
                    aria-label="إزالة المادة"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>

            {/* تكلفة محسوبة */}
            <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cocoa-900 p-3 text-cream-100">
              <div><span className="block text-xs text-copper-300">تكلفة المواد</span><b className="tabular-nums">{money(rMaterialCost)}</b></div>
              <div><span className="block text-xs text-copper-300">تكلفة وحدة الناتج</span><b className="tabular-nums">{rOutputMilli > 0 ? `${money(rUnitCost)} / ${products.find(p => p.id === rOutputId)?.baseUnit ?? 'وحدة'}` : '—'}</b></div>
            </div>
          </div>

          {rError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{rError}</p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setRecipeOpen(false)} disabled={rBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitRecipe()} disabled={rBusy}>
              {rBusy ? 'جارٍ الحفظ…' : editingRecipe ? 'حفظ التعديلات' : 'إنشاء الوصفة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== حوار دفعة إنتاج ===== */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>دفعة إنتاج جديدة</DialogTitle>
            <DialogDescription>
              تُخصم المواد وفق نسبة التحويل ويُضاف الناتج للمخزون — ذرّية: إن فشل أي رصيد لا يُسجل شيء.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>الوصفة *</Label>
              <Select value={bRecipeId || undefined} onValueChange={setBRecipeId}>
                <SelectTrigger className="h-10 w-full" aria-label="الوصفة"><SelectValue placeholder="اختر وصفة" /></SelectTrigger>
                <SelectContent>
                  {activeRecipes.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name} → {r.outputProduct.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeRecipes.length === 0 ? (
                <p className="text-xs text-destructive">لا وصفات مفعّلة — أنشئ وصفة أولًا من تبويب الوصفات.</p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="b-actual">الكمية الفعلية المنتجة ({selectedRecipe?.outputProduct.baseUnit ?? 'الوحدة'}) *</Label>
                <Input id="b-actual" inputMode="decimal" value={bActual} onChange={e => setBActual(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
                {selectedRecipe ? (
                  <p className="text-xs text-muted-foreground">المخطط في الوصفة: {fmtQty(selectedRecipe.outputQtyMilli)} {selectedRecipe.outputProduct.baseUnit}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-waste">كمية الهدر ({selectedRecipe?.outputProduct.baseUnit ?? 'الوحدة'})</Label>
                <Input id="b-waste" inputMode="decimal" value={bWaste} onChange={e => setBWaste(e.target.value)} className="h-10 tabular-nums" autoComplete="off" />
              </div>
            </div>

            {/* المواد المطلوبة مع الرصيد */}
            {selectedRecipe && bActualMilli > 0 ? (
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-cream-200">
                    <tr>
                      <th className="p-2.5 text-start font-semibold">المادة</th>
                      <th className="p-2.5 text-start font-semibold">المطلوب</th>
                      <th className="p-2.5 text-start font-semibold">المتاح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requiredMaterials.map(it => {
                      const avail = inventory.get(it.productId) ?? 0
                      const insufficient = avail - it.required < 0
                      return (
                        <tr key={it.productId} className={cn('border-t', insufficient && 'bg-destructive/5')}>
                          <td className="p-2.5 font-semibold">{it.name}</td>
                          <td className="p-2.5 tabular-nums">{fmtQty(it.required)} {it.baseUnit}</td>
                          <td className={cn('p-2.5 font-semibold tabular-nums', insufficient ? 'text-destructive' : 'text-ok-600')}>
                            {insufficient ? <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{fmtQty(avail)} — غير كافٍ</span> : `${fmtQty(avail)} ${it.baseUnit}`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="b-notes">ملاحظة (اختياري)</Label>
              <Textarea id="b-notes" value={bNotes} onChange={e => setBNotes(e.target.value)} rows={2} />
            </div>

            {selectedRecipe && bActualMilli > 0 ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl border bg-cocoa-900 p-3 text-cream-100">
                <div><span className="block text-xs text-copper-300">تكلفة المواد المتوقعة</span><b className="tabular-nums">{money(bMaterialsCost)}</b></div>
                <div><span className="block text-xs text-copper-300">تكلفة الوحدة المتوقعة</span><b className="tabular-nums">{money(Math.round((bMaterialsCost * 1000) / bActualMilli))}</b></div>
              </div>
            ) : null}
          </div>

          {bError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{bError}</p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setBatchOpen(false)} disabled={bBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitBatch()} disabled={bBusy || !bRecipeId || bActualMilli <= 0}>
              {bBusy ? 'جارٍ التسجيل…' : 'تسجيل الدفعة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تأكيد إلغاء دفعة ===== */}
      <AlertDialog open={!!cancelTarget} onOpenChange={v => { if (!v) setCancelTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء دفعة {cancelTarget?.batchNo}؟</AlertDialogTitle>
            <AlertDialogDescription>
              ستُعاد المواد إلى المخزون ويُخرج الناتج منه داخل معاملة واحدة موثقة. الهدر لا يُعاد أصلًا لأنه لم يدخل المخزون.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="batch-cancel-reason">سبب الإلغاء (إلزامي) *</Label>
            <Textarea id="batch-cancel-reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10">رجوع</AlertDialogCancel>
            <AlertDialogAction
              className="h-10 bg-destructive text-white hover:bg-destructive/90"
              disabled={cancelBusy || !cancelReason.trim()}
              onClick={e => { e.preventDefault(); void cancelBatch() }}
            >
              {cancelBusy ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

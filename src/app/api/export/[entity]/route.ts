import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, requirePerm } from '@/lib/bakery/auth'
import type { Perm } from '@/lib/bakery/permissions'
import { fromMilli } from '@/lib/bakery/money'

export const dynamic = 'force-dynamic'

const ENTITIES: Record<string, { perm: Perm; label: string; fetch: (countId?: string) => Promise<Record<string, unknown>[]> }> = {
  products: {
    perm: 'products.view',
    label: 'المنتجات',
    fetch: async () => {
      const rows = await db.product.findMany({ include: { category: true }, orderBy: { name: 'asc' } })
      return rows.map(p => ({
        'الرمز': p.code ?? '', 'الباركود': p.barcode ?? '', 'الاسم': p.name, 'التصنيف': p.category?.name ?? '',
        'النوع': p.type, 'وحدة القياس': p.baseUnit, 'سعر البيع': fromMilli(p.priceMinor), 'تكلفة': fromMilli(p.costMinor),
        'حد أدنى': fromMilli(p.minStockMilli), 'مفعّل': p.active ? 'نعم' : 'لا',
      }))
    },
  },
  customers: {
    perm: 'customers.view',
    label: 'العملاء',
    fetch: async () => {
      const rows = await db.customer.findMany({ orderBy: { name: 'asc' } })
      const ledger = await db.customerLedgerEntry.groupBy({ by: ['customerId'], _sum: { amountMinor: true } })
      const map = new Map(ledger.map(l => [l.customerId, l._sum.amountMinor ?? 0]))
      return rows.map(c => ({ 'الاسم': c.name, 'الهاتف': c.phone ?? '', 'العنوان': c.address ?? '', 'الرصيد (دين)': fromMilli(map.get(c.id) ?? 0), 'مفعّل': c.active ? 'نعم' : 'لا' }))
    },
  },
  suppliers: {
    perm: 'suppliers.view',
    label: 'الموردون',
    fetch: async () => {
      const rows = await db.supplier.findMany({ orderBy: { name: 'asc' } })
      const ledger = await db.supplierLedgerEntry.groupBy({ by: ['supplierId'], _sum: { amountMinor: true } })
      const map = new Map(ledger.map(l => [l.supplierId, l._sum.amountMinor ?? 0]))
      return rows.map(s => ({ 'الاسم': s.name, 'الهاتف': s.phone ?? '', 'الرصيد (مستحق)': fromMilli(map.get(s.id) ?? 0), 'مفعّل': s.active ? 'نعم' : 'لا' }))
    },
  },
  sales: {
    perm: 'sales.view',
    label: 'فواتير البيع',
    fetch: async () => {
      const rows = await db.sale.findMany({ orderBy: { date: 'desc' }, take: 5000 })
      return rows.map(s => ({
        'رقم الفاتورة': s.invoiceNo, 'التاريخ': s.date.toISOString().slice(0, 19).replace('T', ' '), 'العميل': s.customerName,
        'المصدر': s.source, 'المجموع': fromMilli(s.subtotalMinor), 'الخصم': fromMilli(s.discountMinor), 'الضريبة': fromMilli(s.taxMinor),
        'الإجمالي': fromMilli(s.totalMinor), 'المدفوع': fromMilli(s.paidMinor), 'الآجل': fromMilli(s.creditMinor),
        'حالة الدفع': s.paymentStatus, 'الحالة': s.status,
      }))
    },
  },
  purchases: {
    perm: 'purchases.view',
    label: 'فواتير الشراء',
    fetch: async () => {
      const rows = await db.purchase.findMany({ orderBy: { date: 'desc' }, take: 5000 })
      return rows.map(p => ({
        'رقم الفاتورة': p.invoiceNo, 'التاريخ': p.date.toISOString().slice(0, 19).replace('T', ' '), 'المورد': p.supplierName,
        'المجموع': fromMilli(p.subtotalMinor), 'الإجمالي': fromMilli(p.totalMinor), 'المدفوع': fromMilli(p.paidMinor),
        'حالة الدفع': p.paymentStatus, 'الحالة': p.status,
      }))
    },
  },
  movements: {
    perm: 'inventory.view',
    label: 'حركات المخزون',
    fetch: async () => {
      const rows = await db.stockMovement.findMany({ include: { product: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 10000 })
      return rows.map(m => ({
        'التاريخ': m.date.toISOString().slice(0, 19).replace('T', ' '), 'المنتج': m.product.name, 'النوع': m.type,
        'الكمية': fromMilli(m.qtyMilli), 'المرجع': m.refType ?? '', 'ملاحظة': m.note ?? '',
      }))
    },
  },
  expenses: {
    perm: 'expenses.view',
    label: 'المصروفات',
    fetch: async () => {
      const rows = await db.expense.findMany({ include: { category: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 5000 })
      return rows.map(e => ({
        'التاريخ': e.date.toISOString().slice(0, 19).replace('T', ' '), 'التصنيف': e.category.name, 'المبلغ': fromMilli(e.amountMinor),
        'الطريقة': e.method, 'الجهة': e.beneficiary ?? '', 'السبب': e.note ?? '', 'الحالة': e.status,
      }))
    },
  },
  audit: {
    perm: 'audit.view',
    label: 'سجل التدقيق',
    fetch: async () => {
      const rows = await db.auditLog.findMany({ orderBy: { date: 'desc' }, take: 10000 })
      return rows.map(a => ({
        'التاريخ': a.date.toISOString().slice(0, 19).replace('T', ' '), 'المستخدم': a.username ?? '', 'الإجراء': a.action,
        'الكيان': a.entityType ?? '', 'المعرف': a.entityId ?? '', 'تفاصيل': a.details ?? '',
      }))
    },
  },
  'count-variance': {
    perm: 'inventory.view',
    label: 'فروق الجرد الشهري',
    fetch: async (countId?: string) => {
      if (!countId) throw new Error('COUNT_ID_REQUIRED')
      const c = await db.stockCount.findUnique({ where: { id: countId }, include: { items: { orderBy: { productName: 'asc' } } } })
      if (!c) throw new Error('COUNT_NOT_FOUND')
      return c.items.filter(i => i.countedQtyMilli !== null).map(i => {
        const diff = i.countedQtyMilli! - i.systemQtyMilli
        return {
          'رقم الورقة': c.countNo, 'الشهر': c.month, 'المنتج': i.productName,
          'الرصيد الدفتري': fromMilli(i.systemQtyMilli), 'المجرود': fromMilli(i.countedQtyMilli!),
          'الفرق (كمية)': fromMilli(diff), 'تكلفة الوحدة': fromMilli(i.unitCostMinor),
          'الفرق (قيمة)': fromMilli(diff * i.unitCostMinor), 'حالة الورقة': c.status,
        }
      })
    },
  },
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  return handle(async () => {
    const { entity } = await params
    const conf = ENTITIES[entity]
    if (!conf) return fail(404, 'نوع التصدير غير معروف')
    const r = await requirePerm(req, conf.perm)
    if ('response' in r) return r.response

    const countId = req.nextUrl.searchParams.get('countId') ?? undefined
    let rows: Record<string, unknown>[]
    try {
      rows = await conf.fetch(countId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg === 'COUNT_ID_REQUIRED') return fail(400, 'معرف ورقة الجرد (countId) مطلوب في الاستعلام')
      if (msg === 'COUNT_NOT_FOUND') return fail(404, 'ورقة الجرد غير موجودة')
      throw e
    }
    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['لا توجد بيانات']
    const lines = [headers.map(csvEscape).join(',')]
    for (const row of rows) lines.push(headers.map(h => csvEscape(row[h])).join(','))
    // BOM لدعم العربية في Excel
    const body = '\uFEFF' + lines.join('\r\n')

    await db.auditLog.create({
      data: { userId: r.user.id, username: r.user.username, action: 'EXPORT', entityType: entity, details: JSON.stringify({ rows: rows.length }) },
    }).catch(() => {})

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${entity}-${Date.now()}.csv"`,
      },
    })
  })
}

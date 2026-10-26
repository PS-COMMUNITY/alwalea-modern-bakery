import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { isValidMonthKey, monthKeyOf, assertMonthOpen, isMonthLocked, MONTH_LOCKED_MESSAGE } from '@/lib/bakery/period'
import { fromMilli } from '@/lib/bakery/money'

export const dynamic = 'force-dynamic'

/**
 * GET /api/inventory/count — قائمة أوراق الجرد (perm: inventory.view)
 * فلتر اختياري: ?month=YYYY-MM
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'inventory.view')
    if ('response' in r) return r.response
    const month = req.nextUrl.searchParams.get('month')
    const where = month && isValidMonthKey(month) ? { month } : {}
    const rows = await db.stockCount.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { items: { select: { systemQtyMilli: true, countedQtyMilli: true, unitCostMinor: true } } },
    })
    return ok({
      rows: rows.map(c => {
        const counted = c.items.filter(i => i.countedQtyMilli !== null).length
        const diffItems = c.items.filter(i => i.countedQtyMilli !== null && i.countedQtyMilli !== i.systemQtyMilli).length
        const diffValueMinor = c.items.reduce((s, i) =>
          s + (i.countedQtyMilli === null ? 0 : (i.countedQtyMilli - i.systemQtyMilli) * i.unitCostMinor), 0)
        return {
          id: c.id, countNo: c.countNo, month: c.month, status: c.status, note: c.note,
          userName: c.userName, createdAt: c.createdAt, approvedAt: c.approvedAt,
          approvedByName: c.approvedByName,
          itemsTotal: c.items.length, itemsCounted: counted, diffItems, diffValueMinor,
          diffValueLabel: fromMilli(diffValueMinor),
        }
      }),
    })
  })
}

/**
 * POST /api/inventory/count — إنشاء ورقة جرد شهري (perm: inventory.adjust)
 * { month?: "YYYY-MM" (افتراضي الشهر الحالي), note? }
 * يلتقط لقطة للرصيد الدفتري لكل منتج مفعّل متتبع للمخزون.
 * الحاجز: لا إنشاء ورقة جرد لشهر مقفل (الاعتماد لاحقًا يكتب حركات بتاريخ الآن).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'inventory.adjust')
    if ('response' in r) return r.response
    const user = r.user
    const body = await req.json().catch(() => ({}))

    const month = body?.month ? str(body.month, 7) : monthKeyOf(new Date())
    if (!month || !isValidMonthKey(month)) return fail(400, 'صيغة الشهر يجب أن تكون YYYY-MM')

    // حاجز الشهر المقفل: لا جرد داخل شهر مقفل (الاعتماد لاحقًا يكتب حركات بتاريخ الآن)
    await assertMonthOpen(new Date())
    if (await isMonthLocked(month)) return fail(423, MONTH_LOCKED_MESSAGE)

    const products = await db.product.findMany({
      where: { active: true, trackStock: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, costMinor: true },
    })
    if (products.length === 0) return fail(409, 'لا توجد منتجات متتبعة للمخزون لإنشاء ورقة جرد')

    // أرصدة لحظة الإنشاء
    const ids = products.map(p => p.id)
    const aggs = await db.stockMovement.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _sum: { qtyMilli: true } })
    const stockMap = new Map(aggs.map(a => [a.productId, a._sum.qtyMilli ?? 0]))

    // رقم الورقة: JC-YYYYMM-0001
    const seqKey = `JC-${month}`
    const countNo = await db.$transaction(async tx => {
      const seq = await tx.sequence.upsert({ where: { id: seqKey }, create: { id: seqKey, value: 1 }, update: { value: { increment: 1 } } })
      const no = `${seqKey}-${String(seq.value).padStart(4, '0')}`
      return await tx.stockCount.create({
        data: {
          countNo: no,
          month,
          status: 'DRAFT',
          note: str(body?.note, 300) ?? undefined,
          userId: user.id,
          userName: user.displayName,
          items: {
            create: products.map(p => ({
              productId: p.id,
              productName: p.name,
              systemQtyMilli: stockMap.get(p.id) ?? 0,
              unitCostMinor: p.costMinor,
            })),
          },
        },
      })
    })

    await audit({
      userId: user.id, username: user.username, action: 'STOCK_COUNT_CREATE',
      entityType: 'StockCount', entityId: countNo.id,
      details: { countNo: countNo.countNo, month, items: products.length },
    })

    return ok({ id: countNo.id, countNo: countNo.countNo, month, items: products.length })
  })
}

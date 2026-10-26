import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { assertMonthOpen } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

type Tx = Prisma.TransactionClient

/** خطأ عمل برمز حالة HTTP */
class BizError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** رقم تسلسلي داخل معاملة — نفس منطق nextNumber لكن بـ tx */
async function txNextNumber(tx: Tx, prefix: string): Promise<string> {
  const day = new Date()
  const key = `${prefix}-${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`
  const seq = await tx.sequence.upsert({
    where: { id: key },
    create: { id: key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${key}-${String(seq.value).padStart(4, '0')}`
}

/** تنسيق كمية ألفية للعرض في رسائل الخطأ */
function fmtQty(milli: number): string {
  const v = milli / 1000
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)))
}

/** GET /api/production — قائمة دفعات الإنتاج مع الوصفة والناتج (فلاتر from/to) */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'production.view')
    if ('response' in r) return r.response
    const sp = req.nextUrl.searchParams
    const where: { date?: { gte?: Date; lte?: Date } } = {}
    const fromS = sp.get('from'), toS = sp.get('to')
    if (fromS) {
      const d = new Date(`${fromS}T00:00:00`)
      if (isNaN(d.getTime())) return fail(400, 'تاريخ البداية غير صالح')
      where.date = { gte: d }
    }
    if (toS) {
      const d = new Date(`${toS}T23:59:59.999`)
      if (isNaN(d.getTime())) return fail(400, 'تاريخ النهاية غير صالح')
      where.date = { ...(where.date ?? {}), lte: d }
    }
    const batches = await db.productionBatch.findMany({
      where,
      include: {
        recipe: {
          select: { id: true, name: true, outputQtyMilli: true, outputProduct: { select: { id: true, name: true, baseUnit: true } } },
        },
      },
      orderBy: { date: 'desc' },
    })
    return ok(batches.map(b => ({
      ...b,
      efficiencyPercent: b.plannedQtyMilli > 0 ? Math.round((b.actualQtyMilli * 100) / b.plannedQtyMilli) : 0,
    })))
  })
}

/**
 * POST /api/production — تسجيل دفعة إنتاج (صلاحية: production.manage)
 * ذرية داخل $transaction واحدة:
 *  - خصم المواد (PRODUCTION_OUT) بعد التحقق من الأرصدة
 *  - إضافة الناتج (PRODUCTION_IN) وتحديث تكلفته
 *  - الهدر يوثق في الدفعة دون حركة مخزون (لم يدخل المخزون أصلًا)
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'production.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const recipeId = str(body.recipeId, 60)
    const actualQtyMilli = int(body.actualQtyMilli)
    const wasteQtyMilli = body.wasteQtyMilli === undefined ? 0 : int(body.wasteQtyMilli)
    if (!recipeId) return fail(400, 'الوصفة مطلوبة')
    if (!actualQtyMilli || actualQtyMilli <= 0) return fail(400, 'الكمية الفعلية يجب أن تكون أكبر من صفر')
    if (wasteQtyMilli === null || wasteQtyMilli < 0) return fail(400, 'كمية الهدر يجب أن تكون صفرًا أو أكثر')

    // منع الترحيل المزدوج عبر clientRef (توحيد مع البيع والشراء)
    const clientRef = str(body.clientRef, 100)
    if (clientRef) {
      const existing = await db.productionBatch.findUnique({ where: { clientRef } })
      if (existing) return ok(existing)
    }

    // حاجز الشهر المقفل: دفعة إنتاج جديدة بتاريخ الآن
    await assertMonthOpen(new Date())

    try {
      const batch = await db.$transaction(async tx => {
        const recipe = await tx.recipe.findUnique({
          where: { id: recipeId },
          include: { items: { include: { product: true } }, outputProduct: true },
        })
        if (!recipe) throw new BizError(404, 'الوصفة غير موجودة')
        if (!recipe.active) throw new BizError(409, 'الوصفة غير مفعلة')
        if (recipe.outputProduct.type !== 'FINISHED') {
          throw new BizError(409, 'ناتج الوصفة يجب أن يكون منتجًا نهائيًا (FINISHED)')
        }

        // الكمية المطلوبة من كل مادة وفق نسبة التحويل
        const requiredItems = recipe.items.map(it => ({
          product: it.product,
          required: Math.round((it.qtyMilli * actualQtyMilli) / recipe.outputQtyMilli),
        }))

        // تحقق مخزون كل مادة خام
        for (const it of requiredItems) {
          const agg = await tx.stockMovement.aggregate({ where: { productId: it.product.id }, _sum: { qtyMilli: true } })
          const avail = agg._sum.qtyMilli ?? 0
          if (avail - it.required < 0) {
            throw new BizError(409, `الكمية غير كافية من المادة ${it.product.name} (المتاح: ${fmtQty(avail)})`)
          }
        }

        // تكلفة المواد = مجموع (المطلوب × التكلفة / 1000)
        const materialsCostMinor = requiredItems.reduce(
          (sum, it) => sum + Math.round((it.required * it.product.costMinor) / 1000), 0)
        // تكلفة الوحدة للناتج
        const unitCostMinor = Math.round((materialsCostMinor * 1000) / actualQtyMilli)

        const batchNo = await txNextNumber(tx, 'PRD')
        const created = await tx.productionBatch.create({
          data: {
            batchNo,
            recipeId: recipe.id,
            plannedQtyMilli: recipe.outputQtyMilli,
            actualQtyMilli,
            wasteQtyMilli,
            materialsCostMinor,
            unitCostMinor,
            status: 'COMPLETED',
            clientRef: clientRef ?? undefined,
            notes: str(body.notes, 500) ?? undefined,
            userId: r.user.id,
          },
        })

        // خصم المواد
        for (const it of requiredItems) {
          await tx.stockMovement.create({
            data: {
              productId: it.product.id,
              qtyMilli: -it.required,
              type: 'PRODUCTION_OUT',
              refType: 'ProductionBatch',
              refId: created.id,
              unitCostMinor: it.product.costMinor,
              note: `استهلاك في دفعة ${batchNo}`,
              userId: r.user.id,
            },
          })
        }

        // إضافة الناتج وتحديث تكلفته
        await tx.stockMovement.create({
          data: {
            productId: recipe.outputProductId,
            qtyMilli: actualQtyMilli,
            type: 'PRODUCTION_IN',
            refType: 'ProductionBatch',
            refId: created.id,
            unitCostMinor,
            note: `إنتاج دفعة ${batchNo}`,
            userId: r.user.id,
          },
        })
        await tx.product.update({ where: { id: recipe.outputProductId }, data: { costMinor: unitCostMinor } })

        return created
      })

      await audit({ userId: r.user.id, username: r.user.username, action: 'PRODUCTION', entityType: 'ProductionBatch', entityId: batch.id, details: { batchNo: batch.batchNo, recipeId, actualQtyMilli, wasteQtyMilli, materialsCostMinor: batch.materialsCostMinor, unitCostMinor: batch.unitCostMinor } })
      return ok(batch)
    } catch (e) {
      if (e instanceof BizError) return fail(e.status, e.message)
      throw e
    }
  })
}

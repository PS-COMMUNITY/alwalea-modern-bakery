import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

class BizError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function fmtQty(milli: number): string {
  const v = milli / 1000
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)))
}

/**
 * POST /api/production/[id]/cancel — إلغاء دفعة إنتاج (عكسي ذري)
 * إعادة المواد +qty type ADJUSTMENT، إخراج الناتج −qty (بعد تحقق الرصيد)،
 * status = CANCELLED. الهدر لا يُعاد أصلًا (لم يدخل المخزون).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'production.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const body = await req.json().catch(() => null)
    const reason = body ? str(body.reason, 300) : null
    if (!reason) return fail(400, 'سبب الإلغاء مطلوب')

    try {
      const batch = await db.$transaction(async tx => {
        const b = await tx.productionBatch.findUnique({ where: { id } })
        if (!b) throw new BizError(404, 'الدفعة غير موجودة')
        if (b.status !== 'COMPLETED') throw new BizError(409, 'الدفعة ملغاة مسبقًا')

        // حركات الدفعة الأصلية
        const movements = await tx.stockMovement.findMany({
          where: { refType: 'ProductionBatch', refId: id },
        })
        const matOut = movements.filter(m => m.type === 'PRODUCTION_OUT')
        const outIn = movements.find(m => m.type === 'PRODUCTION_IN')

        // إعادة المواد إلى المخزون
        for (const m of matOut) {
          await tx.stockMovement.create({
            data: {
              productId: m.productId,
              qtyMilli: Math.abs(m.qtyMilli),
              type: 'ADJUSTMENT',
              refType: 'ProductionBatch',
              refId: id,
              unitCostMinor: m.unitCostMinor,
              note: `إلغاء دفعة إنتاج ${b.batchNo}`,
              userId: r.user.id,
            },
          })
        }

        // إخراج الناتج من المخزون (تحقق أن رصيده يكفي)
        if (outIn) {
          const outQty = Math.abs(outIn.qtyMilli)
          const agg = await tx.stockMovement.aggregate({ where: { productId: outIn.productId }, _sum: { qtyMilli: true } })
          const avail = agg._sum.qtyMilli ?? 0
          if (avail - outQty < 0) {
            throw new BizError(409, `لا يمكن الإلغاء: رصيد الناتج غير كافٍ (المتاح: ${fmtQty(avail)}، المطلوب خصمه: ${fmtQty(outQty)})`)
          }
          await tx.stockMovement.create({
            data: {
              productId: outIn.productId,
              qtyMilli: -outQty,
              type: 'ADJUSTMENT',
              refType: 'ProductionBatch',
              refId: id,
              unitCostMinor: outIn.unitCostMinor,
              note: `إلغاء دفعة إنتاج ${b.batchNo}`,
              userId: r.user.id,
            },
          })
        }

        return tx.productionBatch.update({
          where: { id },
          data: { status: 'CANCELLED', voidReason: reason, voidedAt: new Date() },
        })
      })

      await audit({ userId: r.user.id, username: r.user.username, action: 'PRODUCTION_CANCEL', entityType: 'ProductionBatch', entityId: id, details: { batchNo: batch.batchNo, reason } })
      return ok(batch)
    } catch (e) {
      if (e instanceof BizError) return fail(e.status, e.message)
      throw e
    }
  })
}

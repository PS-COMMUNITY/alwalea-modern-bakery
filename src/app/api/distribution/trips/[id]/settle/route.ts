import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

type Tx = Prisma.TransactionClient

class BizError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

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

/**
 * POST /api/distribution/trips/[id]/settle — تسوية الجولة (صلاحية: distribution.manage)
 * ذرية داخل $transaction واحدة:
 *  - ترحيل كل TripSale كفاتورة Sale حقيقية (نقدية مع دفعة صندوقية، آجلة مع قيد دفتر عميل)
 *  - مرتجع جيد يعود للمخزون (TRIP_RETURN)؛ التالف يبقى خارج المخزون ولا حركة له (موثق في TripReturn)
 *  - النقد المحصل ينتقل من عهدة المندوب إلى الصندوق (TRIP_CASH_IN على الوردية المفتوحة إن وجدت)
 *  - لا تُسوى الجولة إلا إذا سجلت كل الكميات المتبقية كمرتجعات
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'distribution.manage')
    if ('response' in r) return r.response
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const countedCashMinor = body && body.countedCashMinor !== undefined ? int(body.countedCashMinor) : null
    const notes = body ? str(body.notes, 500) : null
    if (countedCashMinor === null && body && body.countedCashMinor !== undefined) {
      return fail(400, 'النقد المعدود غير صالح')
    }

    try {
      const summary = await db.$transaction(async tx => {
        const trip = await tx.distributionTrip.findUnique({
          where: { id },
          include: {
            loads: { include: { product: { select: { id: true, name: true } } } },
            sales: { include: { product: { select: { id: true, name: true, costMinor: true } } } },
            returns: true,
          },
        })
        if (!trip) throw new BizError(404, 'الجولة غير موجودة')
        if (trip.status !== 'OPEN') throw new BizError(409, 'الجولة مسواة مسبقًا')

        // تحقق: كل المتبقي يجب أن يكون مسجلًا كمرتجعات قبل التسوية
        const remain = new Map<string, { name: string; qty: number }>()
        for (const l of trip.loads) {
          const cur = remain.get(l.productId) ?? { name: l.product.name, qty: 0 }
          cur.qty += l.qtyMilli
          remain.set(l.productId, cur)
        }
        for (const s of trip.sales) {
          const cur = remain.get(s.productId) ?? { name: s.product.name, qty: 0 }
          cur.qty -= s.qtyMilli
          remain.set(s.productId, cur)
        }
        for (const rt of trip.returns) {
          const cur = remain.get(rt.productId) ?? { name: '', qty: 0 }
          cur.qty -= rt.qtyMilli
          remain.set(rt.productId, cur)
        }
        for (const [pid, row] of remain) {
          if (row.qty > 0) {
            throw new BizError(409, `لا يمكن التسوية: الكمية المتبقية من المنتج ${row.name} غير مرتجعة (سجل المرتجعات أولًا)`)
          }
          void pid
        }

        // ترحيل المبيعات كفواتير حقيقية
        let cashCollected = 0
        let creditTotal = 0
        let salesCount = 0
        for (const s of trip.sales) {
          const isCash = s.paymentType === 'CASH'
          const sale = await tx.sale.create({
            data: {
              invoiceNo: await txNextNumber(tx, 'S'),
              // clientRef يمنع الترحيل المزدوج في حال تنفيذ متزامن
              clientRef: `TRIP-${trip.id}-${s.id}`,
              date: new Date(),
              source: 'DISTRIBUTION',
              tripId: trip.id,
              customerId: s.customerId ?? undefined,
              customerName: s.customerName,
              subtotalMinor: s.lineTotalMinor,
              totalMinor: s.lineTotalMinor,
              paidMinor: isCash ? s.lineTotalMinor : 0,
              creditMinor: isCash ? 0 : s.lineTotalMinor,
              paymentStatus: isCash ? 'PAID' : 'UNPAID',
              status: 'COMPLETED',
              userId: r.user.id,
              items: {
                create: {
                  productId: s.productId,
                  productName: s.product.name,
                  qtyMilli: s.qtyMilli,
                  priceMinor: s.priceMinor,
                  costMinor: s.product.costMinor,
                  lineTotalMinor: s.lineTotalMinor,
                },
              },
            },
          })
          if (isCash) {
            await tx.salePayment.create({
              data: {
                saleId: sale.id,
                customerId: s.customerId ?? undefined,
                method: 'CASH',
                amountMinor: s.lineTotalMinor,
                tripId: trip.id,
                userId: r.user.id,
                note: `تحصيل نقدي من جولة ${trip.tripNo}`,
              },
            })
            cashCollected += s.lineTotalMinor
          } else {
            creditTotal += s.lineTotalMinor
            if (s.customerId) {
              await tx.customerLedgerEntry.create({
                data: {
                  customerId: s.customerId,
                  type: 'INVOICE',
                  amountMinor: s.lineTotalMinor,
                  refType: 'Sale',
                  refId: sale.id,
                  note: `فاتورة آجلة من جولة ${trip.tripNo}`,
                  userId: r.user.id,
                },
              })
            }
          }
          await tx.tripSale.update({ where: { id: s.id }, data: { saleId: sale.id } })
          salesCount++
        }

        // المرتجعات: الجيد يعود للمخزون، التالف يبقى خارج المخزون (موثق في TripReturn دون حركة)
        for (const rt of trip.returns) {
          if (rt.condition === 'GOOD') {
            await tx.stockMovement.create({
              data: {
                productId: rt.productId,
                qtyMilli: rt.qtyMilli,
                type: 'TRIP_RETURN',
                refType: 'DistributionTrip',
                refId: trip.id,
                note: `مرتجع جيد من جولة ${trip.tripNo}`,
                userId: r.user.id,
              },
            })
          }
          // DAMAGED: لا حركة مخزون — الكمية خرجت عند التحميل ولم تعد، موثقة في TripReturn
        }

        // النقد من عهدة المندوب إلى الصندوق (على الوردية المفتوحة إن وجدت)
        let cashShiftId: string | undefined
        if (cashCollected > 0) {
          const openShift = await tx.shift.findFirst({ where: { status: 'OPEN' } })
          if (openShift) {
            await tx.cashMovement.create({
              data: {
                shiftId: openShift.id,
                type: 'TRIP_CASH_IN',
                amountMinor: cashCollected,
                refType: 'DistributionTrip',
                refId: trip.id,
                note: `نقد جولة ${trip.tripNo}`,
                userId: r.user.id,
              },
            })
            cashShiftId = openShift.id
          }
        }

        const updated = await tx.distributionTrip.update({
          where: { id: trip.id },
          data: {
            status: 'SETTLED',
            settledAt: new Date(),
            settledByUserId: r.user.id,
            notes: notes ?? trip.notes,
          },
        })

        return {
          tripNo: trip.tripNo,
          tripId: trip.id,
          status: updated.status,
          settledAt: updated.settledAt,
          salesCount,
          cashCollectedMinor: cashCollected,
          creditTotalMinor: creditTotal,
          returnedGoodMilli: trip.returns.filter(x => x.condition === 'GOOD').reduce((s, x) => s + x.qtyMilli, 0),
          returnedDamagedMilli: trip.returns.filter(x => x.condition === 'DAMAGED').reduce((s, x) => s + x.qtyMilli, 0),
          cashRecordedToShift: !!cashShiftId,
          warning: cashCollected > 0 && !cashShiftId ? 'لم تُسجل حركة صندوق للنقد المحصل لعدم وجود وردية مفتوحة' : undefined,
        }
      })

      await audit({
        userId: r.user.id, username: r.user.username, action: 'TRIP_SETTLE', entityType: 'DistributionTrip', entityId: id,
        details: {
          tripNo: summary.tripNo,
          salesCount: summary.salesCount,
          cashCollectedMinor: summary.cashCollectedMinor,
          creditTotalMinor: summary.creditTotalMinor,
          returnedGoodMilli: summary.returnedGoodMilli,
          returnedDamagedMilli: summary.returnedDamagedMilli,
          countedCashMinor,
        },
      })
      return ok(summary)
    } catch (e) {
      if (e instanceof BizError) return fail(e.status, e.message)
      throw e
    }
  })
}

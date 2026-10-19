import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sales/[id]/cancel — إلغاء فاتورة بيع بعكس كل آثارها (perm: sales.cancel)
 * { reason: مطلوب } — داخل معاملة واحدة: عكس المخزون + عكس دفتر العميل + إرجاع النقدية.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'sales.cancel')
    if ('response' in r) return r.response
    const user = r.user
    const { id } = await params

    const sale = await db.sale.findUnique({ where: { id }, include: { items: true, payments: true } })
    if (!sale) return fail(404, 'الفاتورة غير موجودة')
    if (sale.status === 'CANCELLED') return fail(409, 'الفاتورة ملغاة مسبقًا')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const reason = str(body.reason, 300)
    if (!reason) return fail(400, 'سبب الإلغاء مطلوب')

    const updated = await db.$transaction(async tx => {
      const sale = await tx.sale.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          voidReason: reason,
          voidedAt: new Date(),
          voidedByUserId: user.id,
        },
        include: { items: true, payments: true },
      })

      // عكس حركات المخزون (إرجاع الكميات)
      for (const item of sale.items) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            qtyMilli: item.qtyMilli,
            type: 'SALE_RETURN',
            refType: 'SaleCancel',
            refId: sale.id,
            note: `إلغاء فاتورة ${sale.invoiceNo}`,
            userId: user.id,
          },
        })
      }

      // عكس قيد الآجل في دفتر العميل
      if (sale.customerId && sale.creditMinor > 0) {
        await tx.customerLedgerEntry.create({
          data: {
            customerId: sale.customerId,
            type: 'ADJUSTMENT',
            amountMinor: -sale.creditMinor,
            refType: 'SaleCancel',
            refId: sale.id,
            note: `إلغاء فاتورة ${sale.invoiceNo}`,
            userId: user.id,
          },
        })
      }

      // إرجاع النقدية المدفوعة على الفاتورة
      const salePaidCash = sale.payments
        .filter(p => p.method === 'CASH')
        .reduce((sum, p) => sum + p.amountMinor, 0)
      if (salePaidCash > 0) {
        // وردية الدفعة النقدية إن وُجدت، وإلا أي وردية مفتوحة حاليًا
        const cashWithShift = sale.payments.find(p => p.method === 'CASH' && p.shiftId)
        const shiftId = cashWithShift?.shiftId ?? (await tx.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } }))?.id
        if (shiftId) {
          await tx.cashMovement.create({
            data: {
              shiftId,
              type: 'ADJUSTMENT',
              amountMinor: -salePaidCash,
              refType: 'SaleCancel',
              refId: sale.id,
              note: `إرجاع نقدية فاتورة ${sale.invoiceNo}`,
              userId: user.id,
            },
          })
        }
      }

      return sale
    })

    await audit({
      userId: user.id,
      username: user.username,
      action: 'SALE_CANCEL',
      entityType: 'Sale',
      entityId: id,
      details: { invoiceNo: updated.invoiceNo, totalMinor: updated.totalMinor, paidMinor: updated.paidMinor, creditMinor: updated.creditMinor, reason },
    })

    return ok(updated)
  })
}

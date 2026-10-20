import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/**
 * POST /api/purchases/[id]/cancel — إلغاء فاتورة شراء بعكس آثارها (perm: purchases.cancel)
 * { reason: مطلوب } — داخل معاملة: خروج مخزون PURCHASE_RETURN + عكس دفتر المورد.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req, 'purchases.cancel')
    if ('response' in r) return r.response
    const user = r.user
    const { id } = await params

    const purchase = await db.purchase.findUnique({ where: { id }, include: { items: true } })
    if (!purchase) return fail(404, 'فاتورة الشراء غير موجودة')
    if (purchase.status === 'CANCELLED') return fail(409, 'فاتورة الشراء ملغاة مسبقًا')

    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')
    const reason = str(body.reason, 300)
    if (!reason) return fail(400, 'سبب الإلغاء مطلوب')

    const updated = await db.$transaction(async tx => {
      const p = await tx.purchase.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          voidReason: reason,
          voidedAt: new Date(),
          voidedByUserId: user.id,
        },
        include: { items: true },
      })

      // عكس حركات المخزون (خروج الكميات)
      for (const item of p.items) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            qtyMilli: -item.qtyMilli,
            type: 'PURCHASE_RETURN',
            refType: 'PurchaseCancel',
            refId: p.id,
            unitCostMinor: item.costMinor,
            note: `إلغاء فاتورة شراء ${p.invoiceNo}`,
            userId: user.id,
          },
        })
      }

      // عكس قيد الفاتورة في دفتر المورد
      await tx.supplierLedgerEntry.create({
        data: {
          supplierId: p.supplierId,
          type: 'ADJUSTMENT',
          amountMinor: -p.totalMinor,
          refType: 'PurchaseCancel',
          refId: p.id,
          note: `إلغاء فاتورة شراء ${p.invoiceNo}`,
          userId: user.id,
        },
      })

      return p
    })

    await audit({
      userId: user.id,
      username: user.username,
      action: 'PURCHASE_CANCEL',
      entityType: 'Purchase',
      entityId: id,
      details: { invoiceNo: updated.invoiceNo, totalMinor: updated.totalMinor, supplierName: updated.supplierName, reason },
    })

    return ok(updated)
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/**
 * POST /api/expenses/[id]/cancel — إلغاء مصروف (OWNER فقط — مبسّط)
 * عكسي: status = CANCELLED، وإن كان نقديًا له حركة صندوق: حركة عكسية ADJUSTMENT موجبة
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requirePerm(req)
    if ('response' in r) return r.response
    if (r.user.role !== 'OWNER') return fail(403, 'إلغاء المصروفات متاح للمالك فقط')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const reason = body ? str(body.reason, 300) : null

    const expense = await db.expense.findUnique({ where: { id }, include: { category: { select: { name: true } } } })
    if (!expense) return fail(404, 'المصروف غير موجود')
    if (expense.status !== 'COMPLETED') return fail(409, 'المصروف ملغى مسبقًا')

    const openShift = await db.shift.findFirst({ where: { status: 'OPEN' } })

    await db.$transaction(async tx => {
      await tx.expense.update({
        where: { id },
        data: { status: 'CANCELLED', voidReason: reason, voidedAt: new Date(), voidedByUserId: r.user.id },
      })
      // حركة صندوق عكسية فقط إن كان المصروف نقديًا وله حركة أصلية (له shiftId)
      if (expense.method === 'CASH' && expense.shiftId) {
        await tx.cashMovement.create({
          data: {
            shiftId: openShift ? openShift.id : expense.shiftId,
            type: 'ADJUSTMENT',
            amountMinor: expense.amountMinor,
            refType: 'Expense',
            refId: expense.id,
            note: 'إلغاء مصروف',
            userId: r.user.id,
          },
        })
      }
    })

    await audit({ userId: r.user.id, username: r.user.username, action: 'EXPENSE_CANCEL', entityType: 'Expense', entityId: id, details: { amountMinor: expense.amountMinor, categoryName: expense.category.name, reason } })
    return ok({ ok: true, id, status: 'CANCELLED' })
  })
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, int, ok, requirePerm, str } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { assertMonthOpen } from '@/lib/bakery/period'

export const dynamic = 'force-dynamic'

const METHODS = ['CASH', 'CARD', 'TRANSFER', 'CHEQUE']

/** GET /api/expenses — قائمة المصروفات (فلاتر from/to/categoryId) مع اسم التصنيف */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'expenses.view')
    if ('response' in r) return r.response
    const sp = req.nextUrl.searchParams
    const where: { date?: { gte?: Date; lte?: Date }; categoryId?: string } = {}
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
    const categoryId = sp.get('categoryId')
    if (categoryId) where.categoryId = categoryId

    const expenses = await db.expense.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    })
    return ok(expenses)
  })
}

/**
 * POST /api/expenses — تسجيل مصروف (صلاحية: expenses.manage)
 * إن كان نقديًا: حركة صندوق EXPENSE سالبة على الوردية المفتوحة إن وجدت
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'expenses.manage')
    if ('response' in r) return r.response
    const body = await req.json().catch(() => null)
    if (!body) return fail(400, 'بيانات غير صالحة')

    const categoryId = str(body.categoryId, 60)
    const amountMinor = int(body.amountMinor)
    const method = str(body.method, 20) ?? 'CASH'
    if (!categoryId) return fail(400, 'تصنيف المصروف مطلوب')
    if (!amountMinor || amountMinor <= 0) return fail(400, 'المبلغ يجب أن يكون أكبر من صفر')
    if (!METHODS.includes(method)) return fail(400, 'طريقة الدفع غير صالحة (CASH أو CARD أو TRANSFER أو CHEQUE)')

    let date: Date | undefined
    if (body.date !== undefined && body.date !== null) {
      const s = String(body.date)
      date = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s)
      if (isNaN(date.getTime())) return fail(400, 'تاريخ المصروف غير صالح')
    }

    // حاجز الشهر المقفل: بتاريخ المصروف المطلوب أو الآن
    await assertMonthOpen(date ?? new Date())

    const category = await db.expenseCategory.findUnique({ where: { id: categoryId } })
    if (!category) return fail(404, 'تصنيف المصروف غير موجود')
    if (!category.active) return fail(409, 'تصنيف المصروف غير مفعل')

    const openShift = await db.shift.findFirst({ where: { status: 'OPEN' } })

    const expense = await db.$transaction(async tx => {
      const created = await tx.expense.create({
        data: {
          categoryId,
          amountMinor,
          method,
          beneficiary: str(body.beneficiary, 120) ?? undefined,
          note: str(body.note, 500) ?? undefined,
          date,
          status: 'COMPLETED',
          shiftId: method === 'CASH' && openShift ? openShift.id : undefined,
          userId: r.user.id,
        },
      })
      if (method === 'CASH' && openShift) {
        await tx.cashMovement.create({
          data: {
            shiftId: openShift.id,
            type: 'EXPENSE',
            amountMinor: -amountMinor,
            refType: 'Expense',
            refId: created.id,
            note: `مصروف: ${category.name}`,
            userId: r.user.id,
          },
        })
      }
      return created
    })

    await audit({ userId: r.user.id, username: r.user.username, action: 'EXPENSE', entityType: 'Expense', entityId: expense.id, details: { categoryId, categoryName: category.name, amountMinor, method, beneficiary: expense.beneficiary } })
    return ok({ ...expense, category: { id: category.id, name: category.name } })
  })
}

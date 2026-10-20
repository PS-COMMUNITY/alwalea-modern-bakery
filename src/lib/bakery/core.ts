import { db } from '@/lib/db'

/** تسجيل حدث في سجل التدقيق — لا تسجل أسرارًا أبدًا */
export async function audit(params: {
  userId?: string | null
  username?: string | null
  action: string
  entityType?: string
  entityId?: string
  details?: unknown
}) {
  await db.auditLog.create({
    data: {
      userId: params.userId ?? undefined,
      username: params.username ?? undefined,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: params.details ? JSON.stringify(params.details) : undefined,
    },
  }).catch(err => console.error('[audit]', err))
}

/** أرقام تسلسلية يومية: S-20250101-0001 */
export async function nextNumber(prefix: string): Promise<string> {
  const day = new Date()
  const key = `${prefix}-${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`
  const seq = await db.sequence.upsert({
    where: { id: key },
    create: { id: key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${key}-${String(seq.value).padStart(4, '0')}`
}

/** الإعدادات المفردة — تنشأ تلقائيًا */
export async function getSettings() {
  let s = await db.settings.findUnique({ where: { id: 1 } })
  if (!s) s = await db.settings.create({ data: { id: 1 } })
  return s
}

/** الرصيد الحالي لمنتج (مجموع الحركات) */
export async function stockOf(productId: string): Promise<number> {
  const agg = await db.stockMovement.aggregate({ where: { productId }, _sum: { qtyMilli: true } })
  return agg._sum.qtyMilli ?? 0
}

/** دين العميل (مجموع القيود الموقعة) */
export async function customerDebtMinor(customerId: string): Promise<number> {
  const agg = await db.customerLedgerEntry.aggregate({ where: { customerId }, _sum: { amountMinor: true } })
  return agg._sum.amountMinor ?? 0
}

/** مستحقات المورد (مجموع القيود الموقعة) */
export async function supplierDueMinor(supplierId: string): Promise<number> {
  const agg = await db.supplierLedgerEntry.aggregate({ where: { supplierId }, _sum: { amountMinor: true } })
  return agg._sum.amountMinor ?? 0
}

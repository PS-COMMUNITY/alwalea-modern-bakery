// =============================================================
// مساعدات مشتركة لمسارات API — داخل src/app/api فقط
// (مجلد _lib مستثنى من التوجيه في App Router)
// =============================================================
import { Prisma } from '@prisma/client'

export type Tx = Prisma.TransactionClient

export const PAY_METHODS = ['CASH', 'CARD', 'TRANSFER', 'CHEQUE'] as const
export type PayMethod = (typeof PAY_METHODS)[number]

export const SALE_STATUSES = ['COMPLETED', 'CANCELLED'] as const
export const PRODUCT_TYPES = ['RAW', 'FINISHED', 'TRADE'] as const
export const MOVEMENT_TYPES = [
  'OPENING', 'PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN',
  'PRODUCTION_IN', 'PRODUCTION_OUT', 'WASTE', 'ADJUSTMENT', 'TRIP_OUT', 'TRIP_RETURN',
] as const

/** عدد صحيح موجب (> 0) — للكميات والمبالغ الموجبة */
export function posInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null
  return v
}

/** عدد صحيح موقّع (للتسويات) */
export function signedInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null
  return v
}

/**
 * تفسير ?from&to كحدود أيام:
 * from = بداية اليوم 00:00:00.000 و to = نهاية اليوم 23:59:59.999
 * يعيد { error } عند تاريخ غير صالح.
 */
export function resolveRange(url: URL): { from?: Date; to?: Date; error?: string } {
  const fromS = url.searchParams.get('from')
  const toS = url.searchParams.get('to')
  const out: { from?: Date; to?: Date } = {}
  if (fromS) {
    const d = new Date(`${fromS}T00:00:00.000`)
    if (isNaN(d.getTime())) return { error: 'تاريخ البداية غير صالح (الصيغة: YYYY-MM-DD)' }
    out.from = d
  }
  if (toS) {
    const d = new Date(`${toS}T23:59:59.999`)
    if (isNaN(d.getTime())) return { error: 'تاريخ النهاية غير صالح (الصيغة: YYYY-MM-DD)' }
    out.to = d
  }
  return out
}

/** ترقيم صفحات موحد من ?page&pageSize */
export function pagination(url: URL, defSize = 20) {
  const pageRaw = Number(url.searchParams.get('page'))
  const sizeRaw = Number(url.searchParams.get('pageSize'))
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1
  const pageSize = Number.isInteger(sizeRaw) && sizeRaw >= 1 && sizeRaw <= 200 ? sizeRaw : defSize
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

/** رقم تسلسلي يومي داخل معاملة (نسخة من nextNumber تعمل عبر tx) — مثل S-20250101-0001 */
export async function nextNumberTx(tx: Tx, prefix: string): Promise<string> {
  const day = new Date()
  const key = `${prefix}-${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`
  const seq = await tx.sequence.upsert({
    where: { id: key },
    create: { id: key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${key}-${String(seq.value).padStart(4, '0')}`
}

/** رصيد منتج داخل معاملة (مجموع حركاته) */
export async function stockOfTx(tx: Tx, productId: string): Promise<number> {
  const agg = await tx.stockMovement.aggregate({ where: { productId }, _sum: { qtyMilli: true } })
  return agg._sum.qtyMilli ?? 0
}

/** دين عميل داخل معاملة (مجموع قيود دفتره) */
export async function customerDebtTx(tx: Tx, customerId: string): Promise<number> {
  const agg = await tx.customerLedgerEntry.aggregate({ where: { customerId }, _sum: { amountMinor: true } })
  return agg._sum.amountMinor ?? 0
}

/** مستحقات مورد داخل معاملة */
export async function supplierDueTx(tx: Tx, supplierId: string): Promise<number> {
  const agg = await tx.supplierLedgerEntry.aggregate({ where: { supplierId }, _sum: { amountMinor: true } })
  return agg._sum.amountMinor ?? 0
}

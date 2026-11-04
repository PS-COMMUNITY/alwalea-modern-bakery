// =============================================================
// مخبز الولاء الحديث — نواة الحسابات المالية (مشترك)
// الأموال: أعداد صحيحة بوحدة أصغر للعملة (أغورة). ممنوع floating point.
// الكميات: أعداد صحيحة بوحدة ألفية (×1000).
// التقريب: half-up عند إجماليات السطور والفواتير.
// =============================================================

/** ضرب كمي آمن: qtyMilli × priceMinor → مجموع بالأغورة مع تقريب half-up */
export function lineTotalMinor(qtyMilli: number, priceMinor: number, discountMinor = 0): number {
  const raw = Math.round((qtyMilli * priceMinor) / 1000)
  return Math.max(0, raw - discountMinor)
}

/** نسبة بنقاط أساس على مبلغ (أغورة) مع تقريب half-up */
export function percentOfBp(amountMinor: number, bp: number): number {
  return Math.round((amountMinor * bp) / 10000)
}

/** من وحدة ألفية إلى رقم عرض (1500 → 1.5) */
export function fromMilli(milli: number): number {
  return milli / 1000
}

/** من أغورة إلى رقم عرض (1250 → 12.5) */
export function fromMinor(minor: number): number {
  return minor / 100
}

/** تحويل رقم عرض إلى وحدة ألفية (1.5 → 1500) — للمدخلات من الواجهة */
export function toMilli(value: number | string): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 1000)
}

/** تحويل رقم عرض إلى أغورة ("12.50" → 1250) — للمدخلات من الواجهة */
export function toMinor(value: number | string): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** تنسيق مبلغ بالعملة */
export function formatMoney(minor: number, symbol = '₪', decimals = 2): string {
  const v = (minor / Math.pow(10, decimals)).toFixed(decimals)
  return `${v} ${symbol}`
}

/** تنسيق كمية بوحدة ألفية لعرض مقروء (1500 → "1.5") */
export function formatQty(milli: number): string {
  const v = milli / 1000
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

/** التحقق من أن مبلغًا صحيحًا غير سالب */
export function isMinorValid(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

/** التحقق من أن كمية صحيحة موجبة */
export function isMilliValid(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}

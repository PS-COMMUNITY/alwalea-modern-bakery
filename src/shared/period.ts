// =============================================================
// مخبز الولاء الحديث — إقفال الشهور: الثوابت المشتركة (main / renderer)
// الرسالة حرفية ومُلزمة في كل نقاط الحاجز (موازاة P1-E مع تطبيق الويب)
// =============================================================

/** رسالة حاجز الشهر المقفل — تُعرض للمستخدم كما هي حرفيًا (بند قبول) */
export const MONTH_LOCKED_MESSAGE =
  'هذا الشهر مقفل. يلزم فك القفل بسبب مسجل في سجل التدقيق قبل أي تعديل.'

/** مفتاح الشهر YYYY-MM من تاريخ أو نص تاريخ — بمكونات محلية لمطابقة تواريخ العمل */
export function monthKeyOf(d: Date | string): string {
  if (typeof d === 'string') {
    const s = d.trim()
    const m = /^\d{4}-\d{2}/.exec(s)
    if (m) return m[0]
    const parsed = new Date(s)
    if (!isNaN(parsed.getTime())) return monthKeyOf(parsed)
    return ''
  }
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${mo}`
}

/** هل النص مفتاح شهر صالح YYYY-MM؟ */
export function isValidMonthKey(k: unknown): k is string {
  return typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(k)
}

/** الشهر الحالي YYYY-MM (للعرض الافتراضي في الواجهات) */
export function currentMonthKey(): string {
  return monthKeyOf(new Date())
}

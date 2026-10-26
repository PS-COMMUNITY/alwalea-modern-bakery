import { db } from '@/lib/db'

// =============================================================
// إقفال الشهور — الحاجز المالي الموحد
// الرسالة حرفية ومُلزمة في كل نقاط الحاجز (تكليف P0 المرحلة 1)
// =============================================================

export const MONTH_LOCKED_MESSAGE =
  'هذا الشهر مقفل. يلزم فك القفل بسبب مسجل في سجل التدقيق قبل أي تعديل.'

/** مفتاح الشهر YYYY-MM من تاريخ أو نص تاريخ — بمكوّنات محلية لمطابقة تواريخ العمل */
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

export function isValidMonthKey(k: unknown): k is string {
  return typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(k)
}

/** خطأ الحاجز — يلتقطه غلاف handle ويعيده 423 بالرسالة الحرفية */
export class MonthLockedError extends Error {
  month: string
  constructor(month: string) {
    super(MONTH_LOCKED_MESSAGE)
    this.name = 'MonthLockedError'
    this.month = month
  }
}

/** هل الشهر مقفل؟ */
export async function isMonthLocked(month: string): Promise<boolean> {
  const row = await db.periodClose.findUnique({ where: { month } })
  return !!row?.locked
}

/**
 * الحاجز الموحد: يرفع MonthLockedError إن كان تاريخ العملية داخل شهر مقفل.
 * تُستدعى في كل كتابة مالية/مخزنية:
 *  - الإنشاءات: بتاريخ العملية الفعلي (الافتراضي الآن)
 *  - الإلغاءات/التعديلات: بتاريخ السجل الأصلي نفسه
 */
export async function assertMonthOpen(date: Date | string): Promise<void> {
  const key = monthKeyOf(date)
  if (!key) return
  if (await isMonthLocked(key)) throw new MonthLockedError(key)
}

/** قائمة الشهور المقفلة حاليًا (للعرض في الواجهة) */
export async function lockedMonths(): Promise<string[]> {
  const rows = await db.periodClose.findMany({ where: { locked: true }, select: { month: true } })
  return rows.map(r => r.month)
}

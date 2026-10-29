// =============================================================
// مخبز الولاء الحديث — طبقة استدعاء الـ IPC في الـ renderer
// =============================================================
import type { ApiEnvelope, IpcChannel } from '../../shared/types'
import { formatMoney, formatQty } from '../../shared/money'

let currentToken: string | null = null

export function setToken(token: string | null): void {
  currentToken = token
}

export function getToken(): string | null {
  return currentToken
}

/** استدعاء قناة IPC مع تمرير الجلسة تلقائيًا — يرمي خطأً عربيًا عند الفشل */
export async function call<T>(channel: IpcChannel, payload: Record<string, unknown> = {}): Promise<T> {
  const full: Record<string, unknown> = currentToken ? { token: currentToken, ...payload } : { ...payload }
  const res: ApiEnvelope = await window.bakery.invoke(channel, full)
  if (!res.ok) throw new Error(res.error)
  return res.data as T
}

export const money = formatMoney
export const qty = formatQty

/** تنسيق تاريخ/وقت للعرض */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** نص عمر نسخة احتياطية: «قبل دقائق/ساعة/يوم» — rc.8 (P0-2) مؤشر عمر النسخة */
export function ageText(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const mins = Math.max(0, Math.round((now - t) / 60000))
  if (mins < 1) return 'الآن'
  if (mins < 60) return `قبل ${mins} دقيقة`
  const hours = Math.round(mins / 60)
  if (hours < 24) {
    const h = hours === 1 ? 'ساعة' : hours === 2 ? 'ساعتين' : `${hours} ساعات`
    return `قبل ${h}`
  }
  const days = Math.round(hours / 24)
  const d = days === 1 ? 'يوم' : days === 2 ? 'يومين' : days <= 10 ? `${days} أيام` : `${days} يومًا`
  return `قبل ${d}`
}

/** هل آخر نسخة احتياطية أقدم من 3 أيام (أو لا توجد)؟ — يحمرّ المؤشر فوق العتبة */
export const BACKUP_STALE_MS = 3 * 24 * 60 * 60 * 1000

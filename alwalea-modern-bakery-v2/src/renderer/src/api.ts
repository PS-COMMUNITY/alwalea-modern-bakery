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

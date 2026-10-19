// =============================================================
// مخبز الولاء الحديث — جسر preload الآمن
// sandbox:true + contextIsolation:true — لا يُكشف ipcRenderer الخام إطلاقًا.
// قائمة القنوات المسموحة فقط (من shared/types) عبر contextBridge.
// =============================================================
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, isIpcChannel, type ApiEnvelope, type IpcChannel } from '../shared/types'

const ALLOWED: ReadonlySet<string> = new Set<string>(IPC_CHANNELS)

const api = {
  /** استدعاء قناة مسموحة فقط — يفحص الاسم هنا وفي العملية الرئيسية */
  invoke(channel: unknown, payload?: unknown): Promise<ApiEnvelope> {
    if (!isIpcChannel(channel)) {
      return Promise.resolve<ApiEnvelope>({ ok: false, error: 'قناة IPC غير معروفة', code: 404 })
    }
    if (!ALLOWED.has(channel)) {
      return Promise.resolve<ApiEnvelope>({ ok: false, error: 'قناة غير مسموحة', code: 403 })
    }
    return ipcRenderer.invoke('bakery:invoke', channel as IpcChannel, payload) as Promise<ApiEnvelope>
  },
  /** قائمة القنوات المسموحة (للتشخيص في وحدة التحكم) */
  channels(): string[] {
    return [...IPC_CHANNELS]
  }
}

export type BakeryApi = typeof api

contextBridge.exposeInMainWorld('bakery', api)

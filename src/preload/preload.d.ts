// تعريف واجهة النافذة للاستخدام في الـ renderer
import type { ApiEnvelope, IpcChannel } from '../shared/types'

export interface BakeryApi {
  invoke(channel: IpcChannel | unknown, payload?: unknown): Promise<ApiEnvelope>
  channels(): string[]
}

declare global {
  interface Window {
    bakery: BakeryApi
  }
}

export {}

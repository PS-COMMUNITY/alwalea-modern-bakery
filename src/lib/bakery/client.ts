// =============================================================
// عميل API موحد للواجهة — كل الطلبات تمر من هنا
// =============================================================

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // استجابة غير JSON (مثل CSV)
    return text as unknown as T
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `خطأ ${res.status}`
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  /** تنزيل ملف (نسخة احتياطية/CSV) */
  download: async (path: string, fallbackName: string) => {
    const res = await fetch(path, { cache: 'no-store' })
    if (!res.ok) {
      let msg = `خطأ ${res.status}`
      try {
        msg = (await res.json()).error ?? msg
      } catch { /* تجاهل */ }
      throw new ApiError(res.status, msg)
    }
    const dispo = res.headers.get('Content-Disposition') ?? ''
    const match = dispo.match(/filename="?([^";]+)"?/)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = match?.[1] ?? fallbackName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

// =============================================================
// مخبز الولاء الحديث — التحقق من مدخلات الخدمات (strict)
// =============================================================
import { isMinorValid, isMilliValid } from '../shared/money'

export class ApiError extends Error {
  constructor(message: string, public readonly code = 400) {
    super(message)
  }
}

export function reqStr(v: unknown, field: string, maxLen = 200): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new ApiError(`الحقل «${field}» مطلوب`)
  }
  const s = v.trim()
  if (s.length > maxLen) throw new ApiError(`الحقل «${field}» أطول من الحد المسموح`)
  return s
}

export function optStr(v: unknown, field: string, maxLen = 500): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') throw new ApiError(`الحقل «${field}» يجب أن يكون نصًا`)
  const s = v.trim()
  if (s.length > maxLen) throw new ApiError(`الحقل «${field}» أطول من الحد المسموح`)
  return s
}

export function reqInt(v: unknown, field: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new ApiError(`الحقل «${field}» يجب أن يكون عددًا صحيحًا`)
  }
  if (v < min || v > max) throw new ApiError(`الحقل «${field}» خارج النطاق المسموح`)
  return v
}

export function optInt(
  v: unknown,
  field: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER
): number | null {
  if (v === undefined || v === null) return null
  return reqInt(v, field, min, max)
}

export function reqMinor(v: unknown, field: string): number {
  if (!isMinorValid(v)) throw new ApiError(`الحقل «${field}» يجب أن يكون مبلغًا صحيحًا غير سالب (أغورة)`)
  return v
}

export function reqMilli(v: unknown, field: string): number {
  if (!isMilliValid(v)) throw new ApiError(`الحقل «${field}» يجب أن يكون كمية صحيحة موجبة (×1000)`)
  return v
}

export function optMinor(v: unknown, field: string): number | null {
  if (v === undefined || v === null) return null
  return reqMinor(v, field)
}

export function reqBool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new ApiError(`الحقل «${field}» يجب أن يكون صحيح/خطأ`)
  return v
}

export function optBool(v: unknown, field: string): boolean | null {
  if (v === undefined || v === null) return null
  return reqBool(v, field)
}

export function reqEnum<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ApiError(`الحقل «${field}» يجب أن يكون أحد: ${allowed.join(' | ')}`)
  }
  return v as T
}

export function reqArr(v: unknown, field: string, maxItems = 500): unknown[] {
  if (!Array.isArray(v) || v.length === 0) throw new ApiError(`الحقل «${field}» مطلوب كقائمة غير فارغة`)
  if (v.length > maxItems) throw new ApiError(`الحقل «${field}» يتجاوز الحد الأقصى للعناصر`)
  return v
}

export function optArr(v: unknown, field: string, maxItems = 500): unknown[] | null {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v)) throw new ApiError(`الحقل «${field}» يجب أن يكون قائمة`)
  if (v.length > maxItems) throw new ApiError(`الحقل «${field}» يتجاوز الحد الأقصى للعناصر`)
  return v
}

export function reqDate(v: unknown, field: string): string {
  const s = reqStr(v, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ApiError(`الحقل «${field}» يجب أن يكون بتاريخ بصيغة YYYY-MM-DD`)
  return s
}

export function optDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null
  return reqDate(v, field)
}

export function obj(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ApiError(`الحقل «${field}» يجب أن يكون كائنًا`)
  }
  return v as Record<string, unknown>
}

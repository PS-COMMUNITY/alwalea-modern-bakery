import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { hasPerm, type Perm } from './permissions'
import { MonthLockedError, MONTH_LOCKED_MESSAGE } from './period'

export const SESSION_COOKIE = 'bakery_session'
const SESSION_HOURS = 12

// =============================================================
// كلمات المرور — scrypt مع salt مستقل لكل مستخدم
// =============================================================
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const test = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
    const ref = Buffer.from(hash, 'hex')
    return test.length === ref.length && timingSafeEqual(test, ref)
  } catch {
    return false
  }
}

// =============================================================
// الجلسات
// =============================================================

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000)
  await db.session.create({ data: { token, userId, expiresAt } })
  return token
}

export async function destroySession(token: string) {
  await db.session.deleteMany({ where: { token } })
}

export type AuthUser = {
  id: string
  username: string
  displayName: string
  role: string
}

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({ where: { token }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt < new Date() || !session.user.active) {
    await db.session.deleteMany({ where: { token } }).catch(() => {})
    return null
  }
  await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {})
  return { id: session.user.id, username: session.user.username, displayName: session.user.displayName, role: session.user.role }
}

// =============================================================
// استجابات موحدة
// =============================================================

export function ok(data: unknown = { ok: true }) {
  return NextResponse.json(data)
}

export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

/** غلاف موحد لمعالجات API مع رسائل عربية */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof MonthLockedError) return fail(423, MONTH_LOCKED_MESSAGE)
    const msg = e instanceof Error ? e.message : 'خطأ غير متوقع'
    if (msg.includes('Unique constraint')) return fail(409, 'قيمة مكررة: هذا السجل موجود مسبقًا')
    if (msg.includes('Foreign key constraint')) return fail(409, 'لا يمكن تنفيذ العملية: السجل مستخدم في حركات أخرى')
    console.error('[API]', e)
    return fail(500, 'حدث خطأ داخلي، أعد المحاولة')
  }
}

/** يتطلب جلسة صالحة وصلاحية محددة — يُفرض في طبقة الخدمات */
export async function requirePerm(req: NextRequest, perm?: Perm): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const user = await getAuthUser(req)
  if (!user) return { response: fail(401, 'يجب تسجيل الدخول أولًا') }
  if (perm && !hasPerm(user.role, perm)) return { response: fail(403, 'ليس لديك صلاحية لتنفيذ هذه العملية') }
  return { user }
}

/** التحقق من أن القيمة قيمة نصية غير فارغة */
export function str(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > max) return null
  return s
}

/** عدد صحيح غير سالب (أغورة/ألفية) */
export function int(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
  return v
}

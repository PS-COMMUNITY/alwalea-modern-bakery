// =============================================================
// مخبز الولاء الحديث — المصادقة: scrypt + جلسات + قفل محاولات
// =============================================================
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { BakeryDb } from '../db'
import { ApiError, reqStr } from '../validate'
import { permsForRole } from '../../shared/permissions'
import type { SessionUser, LoginResult } from '../../shared/types'
import { SvcCtx, businessName, setupCompleted } from './helpers'

const SESSION_HOURS = 24
const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

export function makeSalt(): string {
  return randomBytes(16).toString('hex')
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = Buffer.from(hashPassword(password, salt), 'hex')
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function createUser(
  db: BakeryDb,
  args: { username: string; name: string; role: string; password: string; active?: boolean }
): number {
  const salt = makeSalt()
  db.run(
    `INSERT INTO users (username, name, role, password_hash, password_salt, active, failed_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [args.username, args.name, args.role, hashPassword(args.password, salt), salt, args.active === false ? 0 : 1, db.now(), db.now()]
  )
  return db.lastId()
}

export function toSessionUser(u: { id: number; username: string; name: string; role: string }): SessionUser {
  return { id: u.id, username: u.username, name: u.name, role: u.role, perms: permsForRole(u.role) }
}

function resolveUser(db: BakeryDb, token: string): SessionUser | null {
  const row = db.get<{ id: number; username: string; name: string; role: string; expires_at: string }>(
    `SELECT u.id, u.username, u.name, u.role, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND u.active = 1`,
    [token]
  )
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.run('DELETE FROM sessions WHERE token = ?', [token])
    return null
  }
  return toSessionUser(row)
}

/** استخدام من الطبقة العليا (dispatcher) لفحص الجلسة */
export function requireSessionUser(db: BakeryDb, token: unknown): SessionUser {
  if (typeof token !== 'string' || token.length < 16) {
    throw new ApiError('جلسة غير صالحة — يلزم تسجيل الدخول', 401)
  }
  const user = resolveUser(db, token)
  if (!user) throw new ApiError('انتهت الجلسة أو غير صالحة — يلزم تسجيل الدخول', 401)
  return user
}

// ---------- القنوات ----------
export function login(ctx: SvcCtx, payload: Record<string, unknown>): LoginResult {
  const db = ctx.db
  const username = reqStr(payload.username, 'اسم المستخدم', 60).toLowerCase()
  const password = reqStr(payload.password, 'كلمة المرور', 200)
  if (setupCompleted(db) === false) {
    throw new ApiError('لم يكتمل إعداد النشاط بعد', 409)
  }

  // تنظيف الجلسات المنتهية
  db.run('DELETE FROM sessions WHERE expires_at < ?', [db.now()])

  const user = db.get<{
    id: number
    username: string
    name: string
    role: string
    password_hash: string
    password_salt: string
    active: number
    failed_attempts: number
    locked_until: string | null
  }>('SELECT * FROM users WHERE username = ?', [username])

  const auditFailedLogin = (userId: number | null, extra: Record<string, unknown> = {}): void => {
    db.tx(() => {
      ctx.audit('auth.login_failed', 'user', userId, { username, ...extra })
    })
  }

  if (!user || user.active !== 1) {
    auditFailedLogin(user?.id ?? null)
    throw new ApiError('بيانات الدخول غير صحيحة', 401)
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const mins = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000))
    throw new ApiError(`الحساب مقفل مؤقتًا — حاول بعد ${mins} دقيقة`, 429)
  }

  const ok = verifyPassword(password, user.password_salt, user.password_hash)
  if (!ok) {
    const attempts = user.failed_attempts + 1
    const lock = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null
    db.tx(() => {
      db.run('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?', [
        attempts >= MAX_ATTEMPTS ? 0 : attempts,
        lock,
        db.now(),
        user.id
      ])
      ctx.audit('auth.login_failed', 'user', user.id, { username, attempts })
    })
    throw new ApiError('بيانات الدخول غير صحيحة', 401)
  }

  return db.tx(() => {
    db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [db.now(), user.id])
    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString()
    db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      token,
      user.id,
      db.now(),
      expires
    ])
    ctx.audit('auth.login', 'user', user.id, { username })
    return { token, user: toSessionUser(user), businessName: businessName(db) }
  })
}

export function me(ctx: SvcCtx, payload: Record<string, unknown>): SessionUser & { businessName: string } {
  const user = requireSessionUser(ctx.db, payload.token)
  return { ...user, businessName: businessName(ctx.db) }
}

export function logout(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const db = ctx.db
  const user = requireSessionUser(db, payload.token)
  if (typeof payload.token === 'string') {
    db.tx(() => {
      db.run('DELETE FROM sessions WHERE token = ?', [payload.token])
      ctx.audit('auth.logout', 'user', user.id, null)
    })
  }
  return { done: true }
}

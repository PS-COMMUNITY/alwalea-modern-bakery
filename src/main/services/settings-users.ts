// =============================================================
// مخبز الولاء الحديث — الإعدادات + المستخدمون + سجل التدقيق
// =============================================================
import { hashPassword, makeSalt, verifyPassword } from './auth'
import { ApiError, reqStr, optStr, reqEnum, reqArr, obj, reqInt, reqMinor } from '../validate'
import { ROLES } from '../../shared/permissions'
import type { AppSettings, UserRow } from '../../shared/types'
import { SvcCtx, setSetting, getSetting } from './helpers'

// ---------- الإعدادات ----------
export function getSettings(ctx: SvcCtx): AppSettings {
  const db = ctx.db
  return {
    businessName: getSetting(db, 'business_name') ?? 'مخبز الولاء',
    currencyCode: getSetting(db, 'currency_code') ?? 'ILS',
    currencySymbol: getSetting(db, 'currency_symbol') ?? '₪',
    taxBp: parseInt(getSetting(db, 'tax_bp') ?? '0', 10) || 0,
    taxEnabled: (getSetting(db, 'tax_enabled') ?? '0') === '1',
    allowNegativeStock: (getSetting(db, 'allow_negative_stock') ?? '0') === '1',
    receiptFooter: getSetting(db, 'receipt_footer') ?? '',
    phone: getSetting(db, 'phone') ?? '',
    address: getSetting(db, 'address') ?? '',
    telegramBotToken: getSetting(db, 'telegram_bot_token') ?? '',
    telegramChatId: getSetting(db, 'telegram_chat_id') ?? '',
    telegramDaily: (getSetting(db, 'telegram_daily') ?? '0') === '1',
    telegramTime: getSetting(db, 'telegram_time') ?? '23:00'
  }
}

const SETTABLE_KEYS = new Set([
  'business_name',
  'currency_code',
  'currency_symbol',
  'tax_bp',
  'tax_enabled',
  'allow_negative_stock',
  'receipt_footer',
  'phone',
  'address',
  'telegram_bot_token',
  'telegram_chat_id',
  'telegram_daily',
  'telegram_time'
])

export function updateSettings(ctx: SvcCtx, payload: Record<string, unknown>): AppSettings {
  const input = obj(payload.settings, 'settings')
  ctx.db.tx(() => {
    for (const [k, v] of Object.entries(input)) {
      if (!SETTABLE_KEYS.has(k)) continue
      if (k === 'business_name') setSetting(ctx.db, k, reqStr(v, 'اسم النشاط', 120))
      else if (k === 'receipt_footer') setSetting(ctx.db, k, optStr(v, 'تذييل الإيصال', 200) ?? '')
      else if (k === 'phone' || k === 'address') setSetting(ctx.db, k, optStr(v, k, 200) ?? '')
      else if (k === 'tax_bp') {
        const bp = reqInt(v, 'نقاط الضريبة', 0, 10000)
        setSetting(ctx.db, k, String(bp))
      } else if (k === 'tax_enabled' || k === 'allow_negative_stock') {
        setSetting(ctx.db, k, v === true || v === '1' ? '1' : '0')
      } else if (k === 'currency_code') setSetting(ctx.db, k, reqStr(v, 'رمز العملة', 8))
      else if (k === 'currency_symbol') setSetting(ctx.db, k, reqStr(v, 'رمز العملة للعرض', 8))
      else if (k === 'telegram_bot_token') {
        const t = optStr(v, 'telegram_bot_token', 120) ?? ''
        if (t !== '' && !/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(t.trim())) {
          throw new ApiError('توكن البوت غير صالح — انسخه كما أعطاك إياه BotFather', 422)
        }
        setSetting(ctx.db, k, t.trim())
      } else if (k === 'telegram_chat_id') {
        const c = optStr(v, 'telegram_chat_id', 60) ?? ''
        if (c !== '' && !/^(-?\d{4,}|@[A-Za-z0-9_]{4,64})$/.test(c.trim())) {
          throw new ApiError('معرّف المحادثة غير صالح — رقم (مثل 123456789 أو -100…) أو @اسم_قناة', 422)
        }
        setSetting(ctx.db, k, c.trim())
      } else if (k === 'telegram_daily') {
        setSetting(ctx.db, k, v === true || v === '1' ? '1' : '0')
      } else if (k === 'telegram_time') {
        const t = optStr(v, 'telegram_time', 5) ?? '23:00'
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(t.trim())) {
          throw new ApiError('الوقت يجب أن يكون بصيغة HH:MM (مثل 23:00)', 422)
        }
        setSetting(ctx.db, k, t.trim())
      }
    }
    // rc.12 (P1-4): التدقيق يوثق أسماء المفاتيح المحدثة فقط — قيم الأسرار لا تُخزن أبدًا
    // (اكتشف بجناح QA: تفاصيل الحدث كانت تحمل توكن تيليجرام خامًا داخل audit_log)
    const auditSafe: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      auditSafe[k] = k === 'telegram_bot_token' || /token|secret|password/i.test(k) ? '***' : v
    }
    ctx.audit('settings.update', 'settings', null, auditSafe)
  })
  return getSettings(ctx)
}

// ---------- المستخدمون ----------
function userRow(db: SvcCtx['db'], id: number): UserRow {
  const u = db.get<{ id: number; username: string; name: string; role: string; active: number; pin_hash: string | null; created_at: string }>(
    'SELECT id, username, name, role, active, pin_hash, created_at FROM users WHERE id = ?',
    [id]
  )
  if (!u) throw new ApiError('المستخدم غير موجود', 404)
  return { ...u, hasPin: u.pin_hash ? 1 : 0 }
}

export function listUsers(ctx: SvcCtx): UserRow[] {
  const rows = ctx.db.query<{ id: number; username: string; name: string; role: string; active: number; pin_hash: string | null; created_at: string }>(
    'SELECT id, username, name, role, active, pin_hash, created_at FROM users ORDER BY id'
  )
  return rows.map((u) => ({ ...u, hasPin: u.pin_hash ? 1 : 0 }))
}

export function createUserSvc(ctx: SvcCtx, payload: Record<string, unknown>): UserRow {
  const username = reqStr(payload.username, 'اسم المستخدم', 60).toLowerCase()
  const name = reqStr(payload.name, 'الاسم', 120)
  const role = reqEnum(payload.role, 'الدور', ROLES)
  const password = reqStr(payload.password, 'كلمة المرور', 200)
  if (password.length < 4) throw new ApiError('كلمة المرور يجب ألا تقل عن 4 أحرف')
  const id = ctx.db.tx(() => {
    if (ctx.db.get('SELECT id FROM users WHERE username = ?', [username])) {
      throw new ApiError('اسم المستخدم موجود مسبقًا', 409)
    }
    const salt = makeSalt()
    ctx.db.run(
      `INSERT INTO users (username, name, role, password_hash, password_salt, active, failed_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [username, name, role, hashPassword(password, salt), salt, ctx.db.now(), ctx.db.now()]
    )
    const newId = ctx.db.lastId()
    ctx.audit('users.create', 'user', newId, { username, role })
    return newId
  })
  return userRow(ctx.db, id)
}

export function updateUser(ctx: SvcCtx, payload: Record<string, unknown>): UserRow {
  const id = reqInt(payload.id, 'المعرف', 1)
  const name = optStr(payload.name, 'الاسم', 120)
  const role = payload.role === undefined ? null : reqEnum(payload.role, 'الدور', ROLES)
  // rc.12-merge: قبول boolean صرفًا فقط — كانت قيمة رقمية (1/0) تُفسَّر false
  // (payload.active === true) فتُعطَّل الحساب صامتًا؛ الآن رفض صريح برسالة واضحة
  let active: boolean | null = null
  if (payload.active !== undefined) {
    if (typeof payload.active !== 'boolean') throw new ApiError('الحقل «الحالة» يجب أن يكون صحيح/خطأ')
    active = payload.active
  }

  const row = userRow(ctx.db, id)
  return ctx.db.tx(() => {
    if (row.role === 'OWNER' && (role !== null && role !== 'OWNER') && ctx.user?.id === id) {
      throw new ApiError('لا يمكن تغيير دور المالك لجلسته الحالية', 400)
    }
    // حماية آخر مالك نشط
    if (row.role === 'OWNER' && ((role !== null && role !== 'OWNER') || active === false)) {
      const owners = ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'OWNER' AND active = 1 AND id != ?", [id])
      if (!owners || Number(owners.c) === 0) throw new ApiError('يجب أن يبقى مالك نشط واحد على الأقل', 400)
    }
    if (active === false && ctx.user?.id === id) {
      throw new ApiError('لا يمكن تعطيل حسابك الحالي', 400)
    }
    if (name !== null) ctx.db.run('UPDATE users SET name = ?, updated_at = ? WHERE id = ?', [name, ctx.db.now(), id])
    if (role !== null) ctx.db.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, ctx.db.now(), id])
    if (active !== null) {
      ctx.db.run('UPDATE users SET active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, ctx.db.now(), id])
      if (!active) ctx.db.run('DELETE FROM sessions WHERE user_id = ?', [id])
    }
    ctx.audit('users.update', 'user', id, { name, role, active })
    return userRow(ctx.db, id)
  })
}

export function setPassword(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const self = ctx.user?.id === id
  // تغيير كلمة مرورك الخاصة يلزمه الكلمة الحالية (تكافأ أمني مع الويب)
  if (self) {
    const u = ctx.db.get<{ password_hash: string; password_salt: string }>(
      'SELECT password_hash, password_salt FROM users WHERE id = ?',
      [id]
    )
    if (u) {
      const current = typeof payload.currentPassword === 'string' ? payload.currentPassword : ''
      if (!verifyPassword(current, u.password_salt, u.password_hash)) {
        throw new ApiError('كلمة المرور الحالية غير صحيحة', 401)
      }
    }
  }
  const password = reqStr(payload.password, 'كلمة المرور', 200)
  if (password.length < 4) throw new ApiError('كلمة المرور يجب ألا تقل عن 4 أحرف')
  if (!self) {
    // تغيير كلمة مرور غيرك يتطلب users.manage — يفرضه الـ registry
  }
  return ctx.db.tx(() => {
    userRow(ctx.db, id)
    const salt = makeSalt()
    ctx.db.run('UPDATE users SET password_hash = ?, password_salt = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [
      hashPassword(password, salt),
      salt,
      ctx.db.now(),
      id
    ])
    if (!self) ctx.db.run('DELETE FROM sessions WHERE user_id = ?', [id])
    ctx.audit('users.password_change', 'user', id, null)
    return { done: true }
  })
}

export function setPin(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const pin = payload.pin === null || payload.pin === undefined || payload.pin === '' ? null : reqStr(payload.pin, 'رمز PIN', 8)
  if (pin !== null && !/^\d{4,8}$/.test(pin)) throw new ApiError('رمز PIN يجب أن يكون 4-8 أرقام')
  return ctx.db.tx(() => {
    userRow(ctx.db, id)
    if (pin === null) {
      ctx.db.run('UPDATE users SET pin_hash = NULL, pin_salt = NULL, updated_at = ? WHERE id = ?', [ctx.db.now(), id])
    } else {
      const salt = makeSalt()
      ctx.db.run('UPDATE users SET pin_hash = ?, pin_salt = ?, updated_at = ? WHERE id = ?', [
        hashPassword(pin, salt),
        salt,
        ctx.db.now(),
        id
      ])
    }
    ctx.audit('users.pin_change', 'user', id, { cleared: pin === null })
    return { done: true }
  })
}

/**
 * rc.12-merge: حذف مستخدم نهائي — سلامة مرجعية صارمة (منقول من local):
 * - لا حذف لنفسك، ولا لآخر مالك نشط، ولا للمالك المعيّن في الإعدادات.
 * - أي مستند/حركة/وردية/تدقيق مرتبط به (FK users(id)) يمنع الحذف نهائيًا —
 *   البيانات التاريخية لا تُمسّ: عطّل الحساب بدلًا من ذلك (يبقى التاريخ سليمًا).
 * - عند الحذف تُمسح جلساته النشطة أولًا.
 */
export function deleteUser(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean; username: string } {
  const id = reqInt(payload.id, 'المعرف', 1)
  if (ctx.user?.id === id) throw new ApiError('لا يمكن حذف حسابك الحالي', 400)
  const row = userRow(ctx.db, id)
  return ctx.db.tx(() => {
    // حماية المالك المعيّن والمالك الأخير
    if (getSetting(ctx.db, 'owner_user_id') === String(id)) {
      throw new ApiError('هذا المستخدم هو المالك المعيّن في الإعدادات — عيّن مالكًا آخر أو عطّل الحساب بدلًا من حذفه', 409)
    }
    if (row.role === 'OWNER' && row.active === 1) {
      const owners = ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'OWNER' AND active = 1 AND id != ?", [id])
      if (!owners || Number(owners.c) === 0) throw new ApiError('يجب أن يبقى مالك نشط واحد على الأقل — عطّل الحساب بدلًا من حذفه', 400)
    }

    // فحص كل المراجع ذات المفاتيح الأجنبية (سلامة مرجعية — لا يتيم أي سند)
    const refChecks: Array<{ label: string; sql: string; params: number[] }> = [
      { label: 'فاتورة بيع', sql: 'SELECT COUNT(*) AS c FROM sales WHERE user_id = ?', params: [id] },
      { label: 'فاتورة شراء', sql: 'SELECT COUNT(*) AS c FROM purchases WHERE user_id = ?', params: [id] },
      { label: 'حركة مخزون', sql: 'SELECT COUNT(*) AS c FROM stock_movements WHERE user_id = ?', params: [id] },
      { label: 'دفعة إنتاج', sql: 'SELECT COUNT(*) AS c FROM production_batches WHERE user_id = ?', params: [id] },
      { label: 'مصروف', sql: 'SELECT COUNT(*) AS c FROM expenses WHERE user_id = ?', params: [id] },
      { label: 'وردية', sql: 'SELECT COUNT(*) AS c FROM shifts WHERE user_id = ?', params: [id] },
      { label: 'حركة صندوق', sql: 'SELECT COUNT(*) AS c FROM cash_movements WHERE user_id = ?', params: [id] },
      { label: 'جولة توزيع', sql: 'SELECT COUNT(*) AS c FROM distribution_trips WHERE user_id = ?', params: [id] },
      { label: 'ورقة جرد', sql: 'SELECT COUNT(*) AS c FROM stock_count WHERE user_id = ? OR approved_by_user_id = ?', params: [id, id] },
      { label: 'إقفال شهر', sql: 'SELECT COUNT(*) AS c FROM period_close WHERE closed_by_user_id = ? OR unlocked_by_user_id = ?', params: [id, id] }
    ]
    const bound: string[] = []
    for (const rc of refChecks) {
      const n = Number(ctx.db.get<{ c: number }>(rc.sql, rc.params)?.c ?? 0)
      if (n > 0) bound.push(`${n} ${rc.label}`)
    }
    if (bound.length > 0) {
      throw new ApiError(
        `لا يمكن حذف المستخدم «${row.name}» — مرتبط بسجلات نشاط: ${bound.join('، ')}. ` +
          'السجلات التاريخية لا تُحذف للحفاظ على سلامة التدقيق — عطّل الحساب بدلًا من ذلك ليختفي من الدخول والقوائم',
        409
      )
    }

    ctx.db.run('DELETE FROM sessions WHERE user_id = ?', [id])
    ctx.db.run('DELETE FROM users WHERE id = ?', [id])
    ctx.audit('users.delete', 'user', id, { username: row.username, name: row.name })
    return { done: true, username: row.username }
  })
}

// ---------- سجل التدقيق ----------
export function listAudit(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const from = optStr(payload.from, 'من تاريخ', 10)
  const to = optStr(payload.to, 'إلى تاريخ', 10)
  const action = optStr(payload.action, 'الإجراء', 60)
  const conditions: string[] = []
  const params: unknown[] = []
  if (from) {
    conditions.push('date >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('date <= ?')
    params.push(to)
  }
  if (action) {
    conditions.push('action = ?')
    params.push(action)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return ctx.db.query(
    `SELECT id, date, user_id, username, action, entity, entity_id, details, created_at
     FROM audit_log ${where} ORDER BY id DESC LIMIT 500`,
    params
  )
}

// فحص مدخلات المصروف يُستخدم من خدمة المصروفات
export function validateExpenseInput(payload: Record<string, unknown>): { categoryId: number; amountMinor: number; note: string | null; date: string | null } {
  const categoryId = reqInt(payload.categoryId, 'فئة المصروف', 1)
  const amountMinor = reqMinor(payload.amountMinor, 'المبلغ')
  if (amountMinor <= 0) throw new ApiError('مبلغ المصروف يجب أن يكون أكبر من صفر')
  const note = optStr(payload.note, 'ملاحظة', 300)
  const date = optStr(payload.date, 'التاريخ', 10)
  return { categoryId, amountMinor, note, date }
}

export { reqArr }

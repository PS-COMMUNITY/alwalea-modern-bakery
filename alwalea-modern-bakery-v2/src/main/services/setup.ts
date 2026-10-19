// =============================================================
// مخبز الولاء الحديث — معالج أول تشغيل (مرة واحدة فقط)
// =============================================================
import { ApiError, reqStr } from '../validate'
import { ROLES } from '../../shared/permissions'
import { SvcCtx, getSetting, setSetting, setupCompleted } from './helpers'
import { createUser, hashPassword, makeSalt } from './auth'

export function runSetup(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const db = ctx.db
  if (setupCompleted(db)) throw new ApiError('الإعداد المبدئي تم مسبقًا — لا يمكن تكراره', 409)

  const business = reqStr(payload.businessName, 'اسم النشاط', 120)
  const ownerName = reqStr(payload.ownerName, 'اسم المالك', 120)
  const username = reqStr(payload.username, 'اسم المستخدم', 60).toLowerCase()
  const password = reqStr(payload.password, 'كلمة المرور', 200)
  if (password.length < 6) throw new ApiError('كلمة المرور يجب ألا تقل عن 6 أحرف')

  if (db.get('SELECT id FROM users WHERE username = ?', [username])) {
    throw new ApiError('اسم المستخدم مستخدم مسبقًا', 409)
  }

  return db.tx(() => {
    setSetting(db, 'business_name', business)
    setSetting(db, 'currency_code', typeof payload.currencyCode === 'string' ? payload.currencyCode : 'ILS')
    setSetting(db, 'currency_symbol', typeof payload.currencySymbol === 'string' ? payload.currencySymbol : '₪')
    setSetting(db, 'tax_bp', '0')
    setSetting(db, 'tax_enabled', '0')
    setSetting(db, 'allow_negative_stock', '0')
    setSetting(db, 'receipt_footer', 'شكرًا لزيارتكم')
    setSetting(db, 'phone', '')
    setSetting(db, 'address', '')

    const id = createUser(db, { username, name: ownerName, role: 'OWNER' as (typeof ROLES)[number], password })
    setSetting(db, 'owner_user_id', String(id))
    setSetting(db, 'setup_completed', '1')

    // فئات افتراضية أولية
    const now = db.now()
    for (const name of ['خبز ومعجنات', 'حلويات', 'مواد خام']) {
      db.run('INSERT INTO categories (name, active, created_at) VALUES (?, 1, ?)', [name, now])
    }
    // فئات مصروفات افتراضية
    for (const name of ['مواد ولوازم', 'كهرباء وماء', 'رواتب', 'نقل ومواصلات', 'متنوعة']) {
      db.run('INSERT INTO expense_categories (name, active, created_at) VALUES (?, 1, ?)', [name, now])
    }

    ctx.audit('setup.completed', 'settings', null, { business, ownerName })
    return { done: true }
  })
}

export function setupStatus(ctx: SvcCtx): { completed: boolean } {
  return { completed: setupCompleted(ctx.db) || getSetting(ctx.db, 'setup_completed') === '1' }
}

// وصول للمساعدة في بناء مستخدمين مستقبلًا
export const _cryptoHelpers = { hashPassword, makeSalt }

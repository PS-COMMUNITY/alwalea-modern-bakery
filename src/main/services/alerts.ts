// =============================================================
// مخبز الولاء الحديث — تنبيهات تيليجرام (rc.10)
// إرسال اختياري عبر بوت تيليجرام: مخزون منخفض، فرق صندوق، متأخرون 30+ يوم.
// - بلا إنترنت: يفشل بصمت ويُسجّل في alerts.log — لا يؤثر على أي عملية.
// - التلخيص اليومي مرة واحدة يوميًا (settings: telegram_last_digest).
// - التوكن لا يُعاد أبدًا للواجهة (hasToken فقط).
// =============================================================
import * as https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SvcCtx, getSetting, setSetting, getBoolSetting } from './helpers'
import type { TelegramStatus } from '../../shared/types'

const DIGEST_KEY = 'telegram_last_digest'

function alertsLog(ctx: SvcCtx, line: string): void {
  try {
    const dir = path.dirname(ctx.db.filePath)
    fs.appendFileSync(path.join(dir, 'alerts.log'), `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {
    // حتى سجل الفشل لا يمنع شيئًا أبدًا
  }
}

export function telegramStatus(ctx: SvcCtx): TelegramStatus {
  const db = ctx.db
  return {
    enabled: getBoolSetting(db, 'telegram_enabled', false),
    chatId: getSetting(db, 'telegram_chat_id') ?? '',
    hasToken: (getSetting(db, 'telegram_bot_token') ?? '').length > 10,
    lastSentAt: getSetting(db, 'telegram_last_sent_at'),
    lastError: getSetting(db, 'telegram_last_error')
  }
}

export function telegramSave(
  ctx: SvcCtx,
  payload: Record<string, unknown>
): TelegramStatus {
  const db = ctx.db
  const enabled = payload.enabled === true
  const chatId = typeof payload.chatId === 'string' ? payload.chatId.trim().slice(0, 60) : ''
  const token = typeof payload.token === 'string' ? payload.token.trim() : ''
  if (enabled && !chatId) throw new Error('معرّف الدردشة (chat id) مطلوب لتفعيل التنبيهات')
  if (token && !/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error('صيغة توكن البوت غير صحيحة — انسخه كاملًا من @BotFather (مثال: 123456789:AAH...)')
  }
  setSetting(db, 'telegram_enabled', enabled ? '1' : '0')
  if (payload.chatId !== undefined) setSetting(db, 'telegram_chat_id', chatId)
  if (token) setSetting(db, 'telegram_bot_token', token)
  ctx.audit('alerts.telegram.save', 'settings', null, { enabled, chatIdChanged: chatId !== '', tokenChanged: token !== '' })
  return telegramStatus(ctx)
}

/** إرسال رسالة عبر بوت تيليجرام — لا يرمي أبدًا (يرجع نتيجة فقط) */
export function sendTelegramRaw(ctx: SvcCtx, text: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const token = getSetting(ctx.db, 'telegram_bot_token') ?? ''
    const chatId = getSetting(ctx.db, 'telegram_chat_id') ?? ''
    if (!token || !chatId) {
      resolve({ ok: false, error: 'التيليجرام غير مُهيأ (توكن/معرّف دردشة مفقود)' })
      return
    }
    const body = JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), parse_mode: 'HTML' })
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 15000
      },
      (res) => {
        let data = ''
        res.on('data', (c) => {
          data += c
        })
        res.on('end', () => {
          const ok = res.statusCode === 200
          const err = ok ? undefined : `HTTP ${res.statusCode}: ${data.slice(0, 200)}`
          if (ok) {
            setSetting(ctx.db, 'telegram_last_sent_at', ctx.db.now())
            setSetting(ctx.db, 'telegram_last_error', '')
          } else {
            setSetting(ctx.db, 'telegram_last_error', err ?? 'خطأ غير معروف')
            alertsLog(ctx, `SEND FAIL ${err ?? ''}`)
          }
          resolve(ok ? { ok } : { ok, error: err ?? 'خطأ غير معروف' })
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      setSetting(ctx.db, 'telegram_last_error', 'انتهت المهلة (لا اتصال بالإنترنت؟)')
      alertsLog(ctx, 'SEND FAIL timeout')
      resolve({ ok: false, error: 'انتهت المهلة — تحقق من الاتصال بالإنترنت' })
    })
    req.on('error', (e) => {
      setSetting(ctx.db, 'telegram_last_error', e.message)
      alertsLog(ctx, `SEND FAIL ${e.message}`)
      resolve({ ok: false, error: e.message })
    })
    req.write(body)
    req.end()
  })
}

export async function telegramTest(ctx: SvcCtx): Promise<{ ok: boolean; error?: string }> {
  const name = getSetting(ctx.db, 'business_name') ?? 'مخبز الولاء الحديث'
  const res = await sendTelegramRaw(ctx, `✅ تجربة تنبيهات — ${name}\nالنظام يعمل وسيصل شما تنبيهات هنا.`)
  ctx.audit('alerts.telegram.test', 'settings', null, { ok: res.ok })
  return res
}

/** ملخص يومي: متأخرون 30+ + مخزون منخفض — يُرسل مرة واحدة يوميًا عند التفعيل */
export async function maybeDailyDigest(ctx: SvcCtx): Promise<void> {
  try {
    const db = ctx.db
    if (!getBoolSetting(db, 'telegram_enabled', false)) return
    const today = db.today()
    if (getSetting(db, DIGEST_KEY) === today) return

    const cur = getSetting(db, 'currency_symbol') ?? '₪'
    const lines: string[] = [`📋 ملخص يومي — ${getSetting(db, 'business_name') ?? 'المخبز'} (${today})`]

    // متأخرون 30+ يومًا
    const overdue = db.query<{ name: string; bal: number; last_pay: string | null }>(
      `SELECT c.name, SUM(l.amount_minor) AS bal,
              (SELECT MAX(date(l2.created_at)) FROM customer_ledger l2 WHERE l2.customer_id = c.id AND l2.amount_minor < 0) AS last_pay
       FROM customers c JOIN customer_ledger l ON l.customer_id = c.id
       GROUP BY c.id HAVING bal > 0 AND (last_pay IS NULL OR last_pay <= date(?, '-30 days'))
       ORDER BY bal DESC LIMIT 8`,
      [today]
    )
    if (overdue.length > 0) {
      lines.push('')
      lines.push('🔴 ذمم متأخرة (30+ يومًا بلا دفعة):')
      for (const o of overdue) {
        const days = o.last_pay ? Math.round((Date.now() - new Date(o.last_pay).getTime()) / 86400000) : null
        lines.push(`• ${o.name}: ${(Number(o.bal) / 100).toFixed(2)} ${cur}${days === null ? ' (لم يدفع أبدًا)' : ` — آخر دفعة قبل ${days} يومًا`}`)
      }
    }

    // مخزون منخفض
    const low = db.query<{ name: string; bal: number; minq: number; unit: string }>(
      `SELECT p.name, p.min_stock_milli AS minq, p.base_unit AS unit,
              COALESCE((SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.product_id = p.id), 0) AS bal
       FROM products p WHERE p.track_stock = 1 AND p.active = 1
       AND COALESCE((SELECT SUM(m.qty_milli) FROM stock_movements m WHERE m.product_id = p.id), 0) < p.min_stock_milli
       ORDER BY bal LIMIT 8`
    )
    if (low.length > 0) {
      lines.push('')
      lines.push('⚠️ منتجات تحت الحد الأدنى:')
      for (const l of low) {
        lines.push(`• ${l.name}: ${(Number(l.bal) / 1000).toFixed(2)} ${l.unit} (الحد الأدنى ${(Number(l.minq) / 1000).toFixed(2)})`)
      }
    }

    if (overdue.length > 0 || low.length > 0) {
      const res = await sendTelegramRaw(ctx, lines.join('\n'))
      if (res.ok) setSetting(db, DIGEST_KEY, today)
    } else {
      setSetting(db, DIGEST_KEY, today) // لا شيء للتنبيه عنه — علّم اليوم
    }
  } catch (e) {
    alertsLog(ctx, `DIGEST FAIL ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** تنبيه فوري بفرق الصندوق عند إغلاق وردية فيها فرق — يُستدعى من خدمة الورديات */
export function fireShiftDiffAlert(ctx: SvcCtx, info: { shiftId: number; expected: number; counted: number; difference: number }): void {
  try {
    const db = ctx.db
    if (!getBoolSetting(db, 'telegram_enabled', false)) return
    const cur = getSetting(db, 'currency_symbol') ?? '₪'
    const name = getSetting(db, 'business_name') ?? 'المخبز'
    const sign = info.difference < 0 ? 'نقص' : 'زيادة'
    void sendTelegramRaw(
      ctx,
      `🟠 تنبيه فرق صندوق — ${name}\n` +
        `الوردية #${info.shiftId}\n` +
        `المتوقع: ${(info.expected / 100).toFixed(2)} ${cur}\n` +
        `المجرود: ${(info.counted / 100).toFixed(2)} ${cur}\n` +
        `الفرق: ${sign} ${(Math.abs(info.difference) / 100).toFixed(2)} ${cur}`
    )
  } catch {
    // التنبيه لا يفشل إغلاق الوردية أبدًا
  }
}

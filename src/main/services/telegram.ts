// =============================================================
// مخبز الولاء الحديث — خدمة تيليجرام (rc.10)
// ملخص يومي واحد عند الوقت المضبوط + زر اختبار + سجل telegram.log
// https خالص بلا تبعيات — لا يرمي أبدًا (الإرسال محاولة وليس شرط عمل)
// =============================================================
import * as fs from 'node:fs'
import * as https from 'node:https'
import * as path from 'node:path'
import { ApiError } from '../validate'
import { getSetting, setSetting, type SvcCtx } from './helpers'
import { eod } from './reports'
import { formatMoney } from '../../shared/money'

const TG_LOG = 'telegram.log'

function tgLog(ctx: SvcCtx, line: string): void {
  try {
    const dir = path.join(path.dirname(ctx.db.filePath), '..', 'backups')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, TG_LOG), `${line}\n`, 'utf8')
  } catch {
    // حتى سجل الفشل لا يمنع شيئًا أبدًا
  }
}

function telegramConfigured(ctx: SvcCtx): boolean {
  const token = getSetting(ctx.db, 'telegram_bot_token') ?? ''
  const chat = getSetting(ctx.db, 'telegram_chat_id') ?? ''
  return token.trim() !== '' && chat.trim() !== ''
}

/** إرسال رسالة عبر Bot API — يعيد نتيجة ولا يرمي */
function sendTelegramMessage(token: string, chatId: string, text: string, timeoutMs = 15000): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${token.trim()}/sendMessage`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: timeoutMs
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            try {
              const j = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ok?: boolean; description?: string }
              if (res.statusCode === 200 && j.ok === true) resolve({ ok: true })
              else resolve({ ok: false, error: j.description ?? `HTTP ${String(res.statusCode)}` })
            } catch (e) {
              resolve({ ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          })
        }
      )
      req.on('timeout', () => {
        req.destroy(new Error('انتهت مهلة الاتصال بتيليجرام'))
      })
      req.on('error', (e) => resolve({ ok: false, error: e.message }))
      req.write(body)
      req.end()
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
}

/** زر الاختبار من الإعدادات — يتطلب توكن ومحادثة محفوظين */
export async function telegramTest(ctx: SvcCtx): Promise<{ ok: boolean; error?: string }> {
  const token = getSetting(ctx.db, 'telegram_bot_token') ?? ''
  const chat = getSetting(ctx.db, 'telegram_chat_id') ?? ''
  if (token.trim() === '' || chat.trim() === '') {
    throw new ApiError('أدخل توكن البوت ومعرّف المحادثة أولًا ثم احفظ الإعدادات', 422)
  }
  const name = getSetting(ctx.db, 'business_name') ?? 'مخبز الولاء الحديث'
  const r = await sendTelegramMessage(token, chat, `✅ ${name}: الربط مع تيليجرام تم بنجاح — ستصلك الملخصات اليومية هنا.`)
  ctx.audit('telegram.test', 'telegram', null, { ok: r.ok, error: r.error ?? null })
  tgLog(ctx, `TEST ${r.ok ? 'OK' : 'FAIL'} ${new Date().toISOString()} ${r.error ?? ''}`)
  return r
}

/** بناء نص الملخص اليومي من ورقة نهاية اليوم + الديون المتراكمة */
function buildDailySummary(ctx: SvcCtx): string {
  const date = ctx.db.today()
  const e = eod(ctx, { date })
  const sym = e.currencySymbol
  const m = (v: number): string => formatMoney(v, sym)
  const debts = ctx.db.get<{ s: number; c: number }>(
    `SELECT COALESCE(SUM(amount_minor),0) AS s, COUNT(DISTINCT customer_id) AS c
     FROM customer_ledger WHERE amount_minor > 0`
  )
  const lines: string[] = []
  lines.push(`🌇 ${e.businessName} — ملخص يوم ${date}`)
  lines.push('━━━━━━━━━━━━━━')
  lines.push(`🧾 عدد الفواتير: ${e.invoicesCount}`)
  lines.push(`💰 المبيعات: ${m(e.salesTotalMinor)}`)
  lines.push(`🏦 نقدية واردة: ${m(e.cashInMinor)}`)
  lines.push(`🤝 تحصيلات من العملاء: ${m(e.collectionsMinor)}`)
  lines.push(`🛒 مصروفات: ${m(e.expensesMinor)}`)
  lines.push(`📊 صافي الصندوق: ${m(e.cashNetMinor)}`)
  if (e.topItems.length > 0) {
    const t = e.topItems[0]
    if (t) lines.push(`⭐ الأكثر بيعًا: ${t.product_name} (${Number(t.qty_milli) / 1000})`)
  }
  const debtTotal = Number(debts?.s ?? 0)
  if (debtTotal > 0) {
    lines.push(`⚠️ ديون العملاء المتراكمة: ${m(debtTotal)} على ${Number(debts?.c ?? 0)} عميل`)
  }
  lines.push('━━━━━━━━━━━━━━')
  lines.push('📍 تُرسل هذه الرسالة تلقائيًا من نظام المخبز')
  return lines.join('\n')
}

/** الإرسال اليومي المرة-واحدة: يُستدعى من المجدول كل دقيقة — يفحص الوقت والمفتاح اليومي */
export async function telegramDailyIfDue(ctx: SvcCtx): Promise<{ sent: boolean; error?: string }> {
  try {
    if ((getSetting(ctx.db, 'telegram_daily') ?? '0') !== '1') return { sent: false }
    if (!telegramConfigured(ctx)) return { sent: false }
    const time = getSetting(ctx.db, 'telegram_time') ?? '23:00'
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim())
    if (!m) return { sent: false }
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (hhmm < (m[1] ?? '23') + ':' + (m[2] ?? '00')) return { sent: false }
    const today = ctx.db.today()
    if ((getSetting(ctx.db, 'telegram_last_sent') ?? '') === today) return { sent: false }
    const text = buildDailySummary(ctx)
    const token = getSetting(ctx.db, 'telegram_bot_token') ?? ''
    const chat = getSetting(ctx.db, 'telegram_chat_id') ?? ''
    const r = await sendTelegramMessage(token, chat, text)
    ctx.audit('telegram.daily', 'telegram', null, { ok: r.ok, date: today, error: r.error ?? null })
    tgLog(ctx, `DAILY ${r.ok ? 'OK' : 'FAIL'} ${new Date().toISOString()} ${r.error ?? ''}`)
    if (r.ok) {
      setSetting(ctx.db, 'telegram_last_sent', today)
    }
    const out: { sent: boolean; error?: string } = { sent: r.ok }
    if (r.error) out.error = r.error
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    tgLog(ctx, `DAILY ERROR ${new Date().toISOString()} ${msg}`)
    return { sent: false, error: msg }
  }
}

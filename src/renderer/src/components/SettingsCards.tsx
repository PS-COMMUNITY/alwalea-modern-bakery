// =============================================================
// مخبز الولاء الحديث — بطاقات الإعدادات (rc.10)
// بيانات النشاط / تيليجرام — ملخص يومي / النسخ التلقائي
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppSettings, AutoBackupStatus } from '../../../shared/types'
import { call, fmtDateTime, ageText } from '../api'
import { Field, Banner } from '../components/ui'

// ---------- بيانات النشاط ----------

export function BusinessInfoCard(): ReactNode {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [footer, setFooter] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const s = await call<AppSettings>('settings.get')
      setSettings(s)
      setName(s.businessName)
      setPhone(s.phone)
      setAddress(s.address)
      setFooter(s.receiptFooter)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const s = await call<AppSettings>('settings.update', {
        settings: { business_name: name, phone, address, receipt_footer: footer }
      })
      setSettings(s)
      setNotice('تم الحفظ بنجاح')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>🏪 بيانات النشاط</h2>
      <p style={{ fontSize: 12.5, color: '#777', margin: '0 0 12px' }}>
        تظهر في الترويسات الرسمية (تقارير PDF، ورقة نهاية اليوم). الإيصالات المطبوعة تعرض الاسم المحدث بعد إعادة فتح التطبيق.
      </p>
      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}
      <div className="form-row">
        <Field label="اسم النشاط">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="الهاتف">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={200} placeholder="0599…" />
        </Field>
      </div>
      <Field label="العنوان">
        <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
      </Field>
      <Field label="تذييل الإيصال" hint="سطر يظهر أسفل كل إيصال بيع — مثل: شكرًا لزيارتكم 🌟">
        <input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={200} />
      </Field>
      <button className="btn primary" disabled={busy || !settings} onClick={() => void save()}>
        {busy ? 'جارٍ الحفظ…' : '💾 حفظ بيانات النشاط'}
      </button>
    </div>
  )
}

// ---------- تيليجرام — ملخص يومي ----------

export function TelegramCard(): ReactNode {
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [time, setTime] = useState('23:00')
  const [daily, setDaily] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await call<AppSettings>('settings.get')
        setToken(s.telegramBotToken)
        setChatId(s.telegramChatId)
        setTime(s.telegramTime)
        setDaily(s.telegramDaily)
        setLoaded(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await call('settings.update', {
        settings: {
          telegram_bot_token: token.trim(),
          telegram_chat_id: chatId.trim(),
          telegram_daily: daily ? '1' : '0',
          telegram_time: time
        }
      })
      setNotice('تم حفظ إعدادات تيليجرام')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setError('')
    setNotice('')
    try {
      const r = await call<{ ok: boolean; error?: string }>('telegram.test')
      if (r.ok) setNotice('✅ وصلت رسالة الاختبار إلى تيليجرام')
      else setError(`فشل الإرسال: ${r.error ?? 'خطأ غير معروف'} — تحقق من التوكن ومعرف المحادثة وأن البوت مضاف لديك`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>📣 تيليجرام — ملخص يومي</h2>
      <p style={{ fontSize: 12.5, color: '#777', margin: '0 0 12px' }}>
        يصلك كل يوم في الوقت المحدد: المبيعات، النقدية، التحصيلات، المصروفات، صافي الصندوق، وأكثر منتج بيعًا.
        <br />
        <b>الإعداد مرة واحدة:</b> ① أنشئ بوتًا من <span dir="ltr">@BotFather</span> في تيليجرام وانسخ التوكن. ② اكتب لبوتك أي رسالة. ③ افتح الرابط
        <span
          dir="ltr"
          style={{ display: 'inline-block', margin: '2px 4px', background: '#f3e9dc', padding: '1px 6px', borderRadius: 6 }}
        >
          api.telegram.org/bot&lt;التوكن&gt;/getUpdates
        </span>
        وانسخ رقم <b>chat.id</b>.
      </p>
      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}
      {loaded ? (
        <>
          <Field label="توكن البوت (BotFather)" hint="يُحفظ داخل قاعدة بياناتك المحلية فقط">
            <input value={token} onChange={(e) => setToken(e.target.value)} maxLength={120} dir="ltr" placeholder="123456789:ABCdef…" />
          </Field>
          <Field label="معرف المحادثة (Chat ID)" hint="رقم محادثتك مع البوت أو @اسم قناة عامة">
            <input value={chatId} onChange={(e) => setChatId(e.target.value)} maxLength={60} dir="ltr" placeholder="123456789" />
          </Field>
          <div className="form-row">
            <Field label="وقت الإرسال اليومي">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="التفعيل">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 0' }}>
                <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
                إرسال ملخص يومي
              </label>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'جارٍ الحفظ…' : '💾 حفظ إعدادات تيليجرام'}
            </button>
            <button className="btn ghost" disabled={testing} onClick={() => void test()}>
              {testing ? 'جارٍ الإرسال…' : '📨 إرسال رسالة اختبار'}
            </button>
          </div>
        </>
      ) : (
        <p className="empty">جارٍ التحميل…</p>
      )}
    </div>
  )
}

// ---------- النسخ التلقائي ----------

export function AutoBackupCard(): ReactNode {
  const [status, setStatus] = useState<AutoBackupStatus | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await call<AutoBackupStatus>('backup.autoStatus'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>🛡️ النسخ التلقائي</h2>
      {error ? <Banner kind="error" text={error} /> : null}
      {status ? (
        <>
          <div className="form-row" style={{ marginBottom: 10 }}>
            <div className="stat">
              <div className="label">الدورية</div>
              <div className="value">كل {status.intervalMinutes} دقيقة</div>
            </div>
            <div className="stat">
              <div className="label">آخر نسخة تلقائية</div>
              <div className="value ok">{status.lastAutoAt ? fmtDateTime(status.lastAutoAt) : 'لا يوجد'}</div>
            </div>
            <div className="stat">
              <div className="label">عدد النسخ التلقائية</div>
              <div className="value">{status.autoCount}</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: '#777', margin: '0 0 6px' }}>
            تُحفظ تلقائيًا كل {status.intervalMinutes} دقيقة وعند كل إغلاق للتطبيق — ويُبقى على آخر 14 نسخة تلقائية.
            {status.lastAutoAt ? (
              <>
                {' '}
                آخر نسخة: {ageText(status.lastAutoAt)} ({status.lastAutoNote ?? ''}).
              </>
            ) : null}
          </p>
          <p style={{ fontSize: 11.5, color: '#999', margin: '0 0 10px', wordBreak: 'break-all' }} dir="ltr">
            {status.dirPath}
          </p>
          {status.logTail.length > 0 ? (
            <details>
              <summary style={{ fontSize: 12.5, cursor: 'pointer' }}>سجل آخر عمليات النسخ</summary>
              <pre
                style={{ fontSize: 11, background: '#f7f1e8', padding: 8, borderRadius: 8, overflowX: 'auto', whiteSpace: 'pre-wrap' }}
                dir="ltr"
              >
                {status.logTail.join('\n')}
              </pre>
            </details>
          ) : null}
          <button className="btn ghost small" onClick={() => void load()}>
            🔄 تحديث الحالة
          </button>
        </>
      ) : (
        <p className="empty">جارٍ التحميل…</p>
      )}
    </div>
  )
}

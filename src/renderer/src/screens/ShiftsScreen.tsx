// =============================================================
// مخبز الولاء الحديث — شاشة الورديات والصندوق
// القنوات: shifts.current/open/close/list + cash.list/record
// النقد المتوقع يأتي جاهزًا من الخادم (expectedMinor = داخل − خارج الوردية)
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionUser } from '../../../shared/types'
import { call, money, fmtDateTime } from '../api'
import { toMinor } from '../../../shared/money'
import { Field, Modal, Banner, EmptyState, Badge } from '../components/ui'

interface ShiftCurrent {
  id: number
  opened_at: string
  opening_cash_minor: number
  inflowMinor: number
  outflowMinor: number
  expectedMinor: number
}

interface ShiftsCurrentResponse {
  shift: ShiftCurrent | null
  cashBalanceMinor: number
}

interface ShiftHistoryRow {
  id: number
  opened_at: string
  closed_at: string | null
  opening_cash_minor: number
  expected_cash_minor: number | null
  counted_cash_minor: number | null
  difference_minor: number | null
  status: string
  user_name: string | null
}

interface CashRow {
  id: number
  date: string
  shift_id: number | null
  type: string
  ref_type: string | null
  ref_id: number | null
  amount_minor: number
  note: string | null
  created_at: string
}

const CASH_TYPE_LABELS: Record<string, string> = {
  OPENING: 'افتتاح وردية',
  SALE: 'مبيعات',
  EXPENSE: 'مصروف',
  PURCHASE: 'فاتورة شراء',
  SUPPLIER_PAYMENT: 'دفعة مورد',
  COLLECTION: 'تحصيل عميل',
  TRIP_CASH: 'نقد جولة',
  ADJUSTMENT: 'تسوية صندوق'
}

export default function ShiftsScreen(props: { user: SessionUser }): ReactNode {
  const [current, setCurrent] = useState<ShiftsCurrentResponse | null>(null)
  const [history, setHistory] = useState<ShiftHistoryRow[] | null>(null)
  const [cash, setCash] = useState<CashRow[] | null>(null)
  const [cashFrom, setCashFrom] = useState('')
  const [cashTo, setCashTo] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // فتح وردية
  const [openModal, setOpenModal] = useState(false)
  const [openingCash, setOpeningCash] = useState('')

  // إغلاق وردية
  const [closeModal, setCloseModal] = useState(false)
  const [countedCash, setCountedCash] = useState('')
  const [closeNotes, setCloseNotes] = useState('')

  // تسجيل حركة صندوق يدوية
  const [cashModal, setCashModal] = useState(false)
  const [cashDir, setCashDir] = useState<'IN' | 'OUT'>('IN')
  const [cashAmount, setCashAmount] = useState('')
  const [cashReason, setCashReason] = useState('')

  const canUse = props.user.perms.includes('shifts.use')
  const canClose = props.user.perms.includes('shifts.close')
  const canRecord = props.user.perms.includes('settings.manage')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const cashPayload: Record<string, unknown> = {}
      if (cashFrom) cashPayload.from = cashFrom
      if (cashTo) cashPayload.to = cashTo
      const [cur, hist, cashList] = await Promise.all([
        call<ShiftsCurrentResponse>('shifts.current', {}),
        call<ShiftHistoryRow[]>('shifts.list', {}),
        call<CashRow[]>('cash.list', cashPayload)
      ])
      setCurrent(cur)
      setHistory(hist)
      setCash(cashList)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [cashFrom, cashTo])

  useEffect(() => {
    void load()
  }, [load])

  const shift = current?.shift ?? null

  const submitOpen = async (): Promise<void> => {
    setError('')
    const openingMinor = openingCash.trim() === '' ? 0 : toMinor(openingCash)
    if (openingMinor === null) {
      setError('نقدية الافتتاح غير صحيحة')
      return
    }
    setBusy(true)
    try {
      await call<ShiftsCurrentResponse>('shifts.open', { openingCashMinor: openingMinor })
      setOpenModal(false)
      setOpeningCash('')
      setNotice('تم فتح وردية جديدة — حركات الصندوق ستُربط بها')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const countedMinor = toMinor(countedCash)
  const closeDiff = shift && countedMinor !== null ? countedMinor - shift.expectedMinor : null

  const submitClose = async (): Promise<void> => {
    setError('')
    if (countedMinor === null) {
      setError('أدخل النقد المجرود فعليًا')
      return
    }
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { countedCashMinor: countedMinor }
      if (closeNotes.trim()) payload.notes = closeNotes.trim()
      const res = await call<{ id: number; expectedMinor: number; countedMinor: number; differenceMinor: number }>('shifts.close', payload)
      setCloseModal(false)
      setCountedCash('')
      setCloseNotes('')
      setNotice(
        `أُغلقت الوردية #${res.id} — المتوقع ${money(res.expectedMinor)}، المجرود ${money(res.countedMinor)}، الفرق ${money(res.differenceMinor)}`
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitCashRecord = async (): Promise<void> => {
    setError('')
    const amountMinor = toMinor(cashAmount)
    if (amountMinor === null || amountMinor <= 0) {
      setError('أدخل مبلغًا صحيحًا أكبر من صفر')
      return
    }
    if (cashReason.trim().length < 3) {
      setError('اكتب سبب الحركة (3 أحرف على الأقل) — يُوثق في سجل التدقيق')
      return
    }
    setBusy(true)
    try {
      await call('cash.record', { amountMinor: cashDir === 'IN' ? amountMinor : -amountMinor, reason: cashReason.trim() })
      setCashModal(false)
      setCashAmount('')
      setCashReason('')
      setNotice(cashDir === 'IN' ? 'تمت إضافة النقد للصندوق كتسوية موثقة' : 'تم خصم النقد من الصندوق كتسوية موثقة')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ marginRight: 'auto' }}>الورديات والصندوق</h1>
        {canUse ? (
          <button className="btn primary" disabled={busy || shift !== null} onClick={() => { setOpeningCash(''); setOpenModal(true) }}>
            ＋ فتح وردية
          </button>
        ) : null}
        {canClose ? (
          <button
            className="btn"
            disabled={busy || shift === null}
            onClick={() => { setCountedCash(''); setCloseNotes(''); setCloseModal(true) }}
            title={shift === null ? 'لا توجد وردية مفتوحة' : 'إغلاق الوردية الحالية وجرد النقد'}
          >
            🔒 إغلاق الوردية
          </button>
        ) : null}
        {canRecord ? (
          <button
            className="btn ghost"
            onClick={() => { setCashDir('IN'); setCashAmount(''); setCashReason(''); setCashModal(true) }}
            title="تسوية صندوق موثقة (دخول/خروج)"
          >
            تسوية صندوق ±
          </button>
        ) : null}
      </div>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {/* ================= الوردية الحالية ================= */}
      {current === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : shift === null ? (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2>الوردية الحالية</h2>
          <EmptyState icon="🕒" text="لا وردية مفتوحة حاليًا — افتح وردية لربط مبيعات وحركات الصندوق بها." />
        </div>
      ) : (
        <>
          <div className="grid-cards" style={{ marginBottom: 8 }}>
            <div className="stat">
              <div className="label">الوردية الحالية</div>
              <div className="value" style={{ fontSize: 16 }}>
                #{shift.id} <Badge kind="warn" text="مفتوحة" />
              </div>
            </div>
            <div className="stat">
              <div className="label">فتحت في</div>
              <div className="value" style={{ fontSize: 16 }}>{fmtDateTime(shift.opened_at)}</div>
            </div>
            <div className="stat">
              <div className="label">نقدية الافتتاح</div>
              <div className="value">{money(shift.opening_cash_minor)}</div>
            </div>
            <div className="stat">
              <div className="label">رصيد الصندوق الكلي</div>
              <div className="value ok">{money(current.cashBalanceMinor)}</div>
            </div>
          </div>
          <div className="grid-cards" style={{ marginBottom: 22 }}>
            <div className="stat">
              <div className="label">داخل خلال الوردية</div>
              <div className="value ok">+{money(shift.inflowMinor)}</div>
            </div>
            <div className="stat">
              <div className="label">خارج خلال الوردية</div>
              <div className="value err">−{money(shift.outflowMinor)}</div>
            </div>
            <div className="stat">
              <div className="label">النقد المتوقع في الدرج</div>
              <div className="value warn">{money(shift.expectedMinor)}</div>
            </div>
          </div>
        </>
      )}

      {/* ================= سجل الورديات ================= */}
      <h2 style={{ marginBottom: 10 }}>📋 سجل الورديات</h2>
      {history === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : history.length === 0 ? (
        <EmptyState icon="🕒" text="لا ورديات بعد — افتح أول وردية لتظهر هنا مع جرد الإغلاق." />
      ) : (
        <table className="data" style={{ marginBottom: 26 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>الفتح</th>
              <th>الإغلاق</th>
              <th className="num">نقدية الافتتاح</th>
              <th className="num">المتوقع</th>
              <th className="num">المجرود</th>
              <th className="num">الفرق</th>
              <th>الحالة</th>
              <th>المستخدم</th>
            </tr>
          </thead>
          <tbody>
            {history.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{fmtDateTime(s.opened_at)}</td>
                <td>{s.closed_at ? fmtDateTime(s.closed_at) : '—'}</td>
                <td className="num">{money(s.opening_cash_minor)}</td>
                <td className="num">{s.expected_cash_minor === null ? '—' : money(s.expected_cash_minor)}</td>
                <td className="num">{s.counted_cash_minor === null ? '—' : money(s.counted_cash_minor)}</td>
                <td className="num" style={{ color: (s.difference_minor ?? 0) !== 0 ? 'var(--err)' : 'var(--ok)' }}>
                  {s.difference_minor === null ? '—' : money(s.difference_minor)}
                </td>
                <td>{s.status === 'OPEN' ? <Badge kind="warn" text="مفتوحة" /> : <Badge kind="ok" text="مغلقة" />}</td>
                <td>{s.user_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ================= حركات الصندوق ================= */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ marginRight: 'auto' }}>💰 حركات الصندوق</h2>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>من تاريخ</label>
          <input type="date" value={cashFrom} onChange={(e) => setCashFrom(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>إلى تاريخ</label>
          <input type="date" value={cashTo} onChange={(e) => setCashTo(e.target.value)} />
        </div>
      </div>
      {cash === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : cash.length === 0 ? (
        <EmptyState icon="💰" text="لا حركات صندوق في هذا النطاق." />
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto', borderRadius: 'var(--radius)' }}>
          <table className="data">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>النوع</th>
                <th className="num">المبلغ</th>
                <th>الوردية</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {cash.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDateTime(c.created_at)}</td>
                  <td>{CASH_TYPE_LABELS[c.type] ?? c.type}</td>
                  <td className="num" style={{ color: c.amount_minor >= 0 ? 'var(--ok)' : 'var(--err)', fontWeight: 700 }}>
                    {c.amount_minor >= 0 ? '+' : '−'}
                    {money(Math.abs(c.amount_minor))}
                  </td>
                  <td>{c.shift_id ? `#${c.shift_id}` : '—'}</td>
                  <td>{c.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ================= فتح وردية ================= */}
      {openModal ? (
        <Modal title="فتح وردية جديدة" onClose={() => setOpenModal(false)}>
          <Field label="نقدية الافتتاح (في الدرج الآن)" hint="تُسجل كحركة OPENING — اتركها فارغة أو 0 إن كان الدرج فارغًا">
            <input dir="ltr" inputMode="decimal" placeholder="0.00" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} autoFocus />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void submitOpen()}>
              {busy ? 'جارٍ الفتح…' : 'فتح الوردية'}
            </button>
            <button className="btn ghost" onClick={() => setOpenModal(false)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ================= إغلاق وردية ================= */}
      {closeModal && shift ? (
        <Modal title={`إغلاق الوردية #${shift.id}`} onClose={() => setCloseModal(false)}>
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">النقد المتوقع</div>
              <div className="value warn">{money(shift.expectedMinor)}</div>
            </div>
            <div className="stat">
              <div className="label">الفرق بعد الجرد</div>
              <div className={`value ${closeDiff === null ? '' : closeDiff === 0 ? 'ok' : 'err'}`}>
                {closeDiff === null ? '—' : money(closeDiff)}
              </div>
            </div>
          </div>
          <Field label="النقد المجرود فعليًا *" hint="عُدّ ما في الدرج وأدخله — الفرق يُوثق في سجل الوردية">
            <input dir="ltr" inputMode="decimal" placeholder="0.00" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} autoFocus />
          </Field>
          <Field label="ملاحظات الإغلاق">
            <input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="اختياري — مثال: نقص مستند إلى مرتجع" />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void submitClose()}>
              {busy ? 'جارٍ الإغلاق…' : 'إغلاق الوردية'}
            </button>
            <button className="btn ghost" onClick={() => setCloseModal(false)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ================= تسوية صندوق ================= */}
      {cashModal ? (
        <Modal title="تسوية صندوق موثقة" onClose={() => setCashModal(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            تُسجل كحركة ADJUSTMENT باسمك وتظهر في سجل التدقيق — استخدمها لتصحيح فرق جرد مبرر فقط.
          </p>
          <div className="pay-toggle">
            <button className={cashDir === 'IN' ? 'sel' : ''} onClick={() => setCashDir('IN')}>
              ⬆ إضافة للصندوق
            </button>
            <button className={cashDir === 'OUT' ? 'sel' : ''} onClick={() => setCashDir('OUT')}>
              ⬇ خصم من الصندوق
            </button>
          </div>
          <Field label="المبلغ *">
            <input dir="ltr" inputMode="decimal" placeholder="0.00" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="السبب *" hint="3 أحرف على الأقل — مثال: تسوية فرق جرد وردية #3">
            <input value={cashReason} onChange={(e) => setCashReason(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void submitCashRecord()}>
              {busy ? 'جارٍ التسجيل…' : 'تسجيل الحركة'}
            </button>
            <button className="btn ghost" onClick={() => setCashModal(false)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

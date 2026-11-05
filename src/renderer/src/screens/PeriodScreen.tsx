// =============================================================
// مخبز الولاء الحديث — شاشة الجرد الشهري وإقفال الشهور
// القنوات: periods.list/period.close/period.unlock + counts.list/get/create/saveItems/approve
// + reports.countVariance — رسالة حاجز الشهر المقفل تُعرض كما تعود من المغلف حرفيًا
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PeriodRow, StockCountRow, StockCountItemRow, CountVarianceRow, SessionUser } from '../../../shared/types'
import { currentMonthKey } from '../../../shared/period'
import { toMilli } from '../../../shared/money'
import { call, money, qty as fmtQ, fmtDateTime } from '../api'
import { downloadCsv, csvMoney } from '../csvExport'
import { Field, Modal, Banner, Badge, EmptyState } from '../components/ui'

type CountDetail = Omit<StockCountRow, 'items_total' | 'items_counted' | 'diff_items' | 'diff_value_minor'> & {
  items: StockCountItemRow[]
}

interface VarianceData {
  count: { id: number; count_no: string; month: string; status: string; created_at: string; approved_at: string | null; approved_by_name: string | null }
  summary: { itemsTotal: number; itemsCounted: number; itemsNotCounted: number; diffItems: number; totalDiffValueMinor: number }
  rows: CountVarianceRow[]
}

function statusBadgeOf(status: string): ReactNode {
  if (status === 'APPROVED') return <Badge kind="ok" text="معتمدة" />
  if (status === 'DRAFT') return <Badge kind="warn" text="مسودة" />
  return <Badge kind="muted" text={status} />
}

export default function PeriodScreen(props: { user: SessionUser }): ReactNode {
  const [periods, setPeriods] = useState<PeriodRow[] | null>(null)
  const [counts, setCounts] = useState<StockCountRow[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // إنشاء ورقة جرد
  const [createForm, setCreateForm] = useState<{ month: string; note: string } | null>(null)

  // تفاصيل ورقة + تعديل الكميات المجرودة محليًا
  const [detail, setDetail] = useState<CountDetail | null>(null)
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [approveFor, setApproveFor] = useState<CountDetail | null>(null)
  const [approveNote, setApproveNote] = useState('')

  // تقرير الفروق
  const [variance, setVariance] = useState<VarianceData | null>(null)

  // إقفال وفك قفل الشهور
  const [closeMonthKey, setCloseMonthKey] = useState(currentMonthKey())
  const [confirmClose, setConfirmClose] = useState(false)
  const [unlockFor, setUnlockFor] = useState<PeriodRow | null>(null)
  const [unlockReason, setUnlockReason] = useState('')

  const canManage = props.user.perms.includes('settings.manage')
  const canAdjust = props.user.perms.includes('inventory.adjust')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const [p, c] = await Promise.all([
        call<PeriodRow[]>('periods.list', {}),
        call<StockCountRow[]>('counts.list', {})
      ])
      setPeriods(p)
      setCounts(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refreshDetail = async (id: number): Promise<void> => {
    const d = await call<CountDetail>('counts.get', { id })
    setDetail(d)
    const map: Record<number, string> = {}
    for (const it of d.items) map[it.id] = it.counted_qty_milli === null ? '' : String(it.counted_qty_milli / 1000)
    setEdits(map)
  }

  const openDetail = async (id: number): Promise<void> => {
    setError('')
    try {
      await refreshDetail(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const openVariance = async (id: number): Promise<void> => {
    setError('')
    try {
      setVariance(await call<VarianceData>('reports.countVariance', { id }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const submitCreate = async (): Promise<void> => {
    if (!createForm) return
    setBusy(true)
    setError('')
    try {
      const res = await call<{ countNo: string; items: number }>('counts.create', {
        month: createForm.month || null,
        note: createForm.note.trim() || null
      })
      setCreateForm(null)
      setNotice(`أُنشئت ورقة الجرد ${res.countNo} بـ ${res.items} بندًا (لقطة أرصدة الدفتر)`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitSaveItems = async (): Promise<void> => {
    if (!detail) return
    const items: Array<{ itemId: number; countedQtyMilli: number | null }> = []
    for (const it of detail.items) {
      const raw = (edits[it.id] ?? '').trim()
      if (raw === '') {
        items.push({ itemId: it.id, countedQtyMilli: null })
        continue
      }
      const milli = toMilli(raw)
      if (milli === null) {
        setError(`الكمية المجرودة للمنتج «${it.product_name}» غير صالحة — أدخل رقمًا ≥ 0 أو اتركها فارغة`)
        return
      }
      items.push({ itemId: it.id, countedQtyMilli: milli })
    }
    setBusy(true)
    setError('')
    try {
      const res = await call<{ saved: number }>('counts.saveItems', { id: detail.id, items })
      setNotice(`حُفظت الكميات المجرودة (${res.saved} بندًا)`)
      await refreshDetail(detail.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const cancelDraft = async (c: { id: number; count_no: string }): Promise<void> => {
    if (!window.confirm(`حذف مسودة الجرد «${c.count_no}» نهائيًا؟\n\nهذه هي الطريقة لفك قفل الجرد النشط دون اعتماد — ستعود الحركات المخزنية للعمل عاديًا. الورقة وبنودها يُحذفون ولا تُكتب أي حركات.`)) return
    setError('')
    try {
      await call('counts.cancel', { id: c.id })
      setNotice(`تم حذف مسودة الجرد «${c.count_no}» — الحركات المخزنية تعمل الآن طبيعيًا`)
      setDetail(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const submitApprove = async (): Promise<void> => {
    if (!approveFor) return
    setBusy(true)
    setError('')
    try {
      const res = await call<{ countNo: string; adjustmentMovements: number; diffValueMinor: number }>('counts.approve', {
        id: approveFor.id,
        note: approveNote.trim() || null
      })
      setApproveFor(null)
      setApproveNote('')
      setNotice(`اعتُمدت الورقة ${res.countNo} — رُحّلت ${res.adjustmentMovements} حركة تسوية بقيمة فرق ${money(res.diffValueMinor)}`)
      if (detail && detail.id === approveFor.id) await refreshDetail(approveFor.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitClose = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const res = await call<{ month: string; closeCount: number }>('period.close', { month: closeMonthKey })
      setConfirmClose(false)
      setNotice(`أُقفل الشهر ${res.month} — أي تعديل بتاريخه سيرفض حتى فك القفل (الإقفال رقم ${res.closeCount})`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitUnlock = async (): Promise<void> => {
    if (!unlockFor) return
    setBusy(true)
    setError('')
    try {
      await call('period.unlock', { month: unlockFor.month, reason: unlockReason.trim() })
      setUnlockFor(null)
      setUnlockReason('')
      setNotice(`فُك قفل الشهر ${unlockFor.month} — السبب موثق في سجل التدقيق`)
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
        <h1 style={{ marginRight: 'auto' }}>الجرد والإقفال</h1>
        {canAdjust ? (
          <button className="btn primary" onClick={() => setCreateForm({ month: currentMonthKey(), note: '' })}>
            ＋ ورقة جرد جديدة
          </button>
        ) : null}
      </div>

      {error ? <Banner kind="error" text={error} /> : null}
      {notice ? <Banner kind="ok" text={notice} /> : null}

      {/* ======== الجرد الشهري ======== */}
      <div className="card" style={{ padding: 18 }}>
        <h2>📦 الجرد الشهري</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 12px' }}>
          ورقة الجرد تلتقط لقطة لأرصدة الدفتر لحظة إنشائها، وتُجرَّد الكميات الفعلية ثم تُعتمد لترحيل الفروق للمخزون.
        </p>
        {counts === null ? (
          <EmptyState icon="⏳" text="جارٍ التحميل…" />
        ) : counts.length === 0 ? (
          <EmptyState icon="📦" text="لا أوراق جرد بعد — أنشئ ورقة للشهر الحالي وابدأ بجرد الكميات الفعلية." />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>الشهر</th>
                <th>الحالة</th>
                <th className="num">البنود (مجرود)</th>
                <th className="num">بنود الفرق</th>
                <th className="num">قيمة الفرق</th>
                <th>أنشأها</th>
                <th>اعتمدها</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {counts.map((c) => (
                <tr key={c.id}>
                  <td dir="ltr">
                    <strong>{c.count_no}</strong>
                  </td>
                  <td dir="ltr">{c.month}</td>
                  <td>{statusBadgeOf(c.status)}</td>
                  <td className="num">
                    {c.items_total} ({c.items_counted})
                  </td>
                  <td className="num">{c.diff_items > 0 ? <Badge kind="warn" text={String(c.diff_items)} /> : '0'}</td>
                  <td className="num">{money(c.diff_value_minor)}</td>
                  <td>{c.user_name ?? '—'}</td>
                  <td>{c.approved_by_name ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost small" onClick={() => void openDetail(c.id)}>
                      تفاصيل
                    </button>{' '}
                    {c.status === 'DRAFT' && canManage ? (<>
                      <button className="btn danger small" onClick={() => void cancelDraft(c)} title="حذف المسودة وفك القفل">
                        حذف
                      </button>{' '}
                    </>) : null}
                    <button className="btn small" onClick={() => void openVariance(c.id)}>
                      تقرير الفروق
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ======== إقفال الشهور ======== */}
      <div className="card" style={{ padding: 18, marginTop: 18 }}>
        <h2>🔒 إقفال الشهور</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 12px' }}>
          بعد إقفال شهر يُرفض كل تعديل مالي/مخزني بتاريخ داخله برسالة حاجز موحدة حتى يُفك القفل بسبب موثق في سجل التدقيق.
        </p>
        {canManage ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <Field label="الشهر (YYYY-MM)">
              <input type="month" value={closeMonthKey} onChange={(e) => setCloseMonthKey(e.target.value)} dir="ltr" />
            </Field>
            <button className="btn danger" disabled={busy || !closeMonthKey} onClick={() => setConfirmClose(true)}>
              🔒 إقفال الشهر
            </button>
          </div>
        ) : null}
        {periods === null ? (
          <EmptyState icon="⏳" text="جارٍ التحميل…" />
        ) : periods.length === 0 ? (
          <EmptyState icon="🗓️" text="لا شهور مقفلة بعد — أقفل الشهر بعد مراجعة تقريراته لمنع التعديل الرجعي." />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>الشهر</th>
                <th>الحالة</th>
                <th>أُقفل بواسطة</th>
                <th>فُك بواسطة</th>
                <th>سبب فك القفل</th>
                <th className="num">مرات الإقفال</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td dir="ltr">
                    <strong>{p.month}</strong>
                  </td>
                  <td>{p.locked ? <Badge kind="err" text="مقفل" /> : <Badge kind="ok" text="مفتوح" />}</td>
                  <td>
                    {p.closed_by_name ?? '—'}
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDateTime(p.closed_at)}</div>
                  </td>
                  <td>{p.unlocked_by_name ?? '—'}</td>
                  <td style={{ maxWidth: 260 }}>{p.unlock_reason ?? '—'}</td>
                  <td className="num">{p.close_count}</td>
                  <td>
                    {canManage && p.locked ? (
                      <button
                        className="btn small"
                        onClick={() => {
                          setUnlockReason('')
                          setUnlockFor(p)
                        }}
                      >
                        فك القفل
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* نافذة إنشاء ورقة جرد */}
      {createForm ? (
        <Modal title="ورقة جرد شهرية جديدة" onClose={() => setCreateForm(null)}>
          <Field label="شهر الجرد *" hint="تُلتقط لقطة أرصدة كل منتج متتبع للمخزون">
            <input type="month" value={createForm.month} onChange={(e) => setCreateForm({ ...createForm, month: e.target.value })} dir="ltr" autoFocus />
          </Field>
          <Field label="ملاحظة">
            <input value={createForm.note} onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })} placeholder="اختياري" />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy || !createForm.month} onClick={() => void submitCreate()}>
              {busy ? 'جارٍ الإنشاء…' : 'إنشاء الورقة'}
            </button>
            <button className="btn ghost" onClick={() => setCreateForm(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      ) : null}

      {/* نافذة تفاصيل الورقة + الجرد */}
      {detail ? (
        <Modal title={`ورقة جرد: ${detail.count_no}`} onClose={() => setDetail(null)} wide>
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">الشهر</div>
              <div className="value" dir="ltr">{detail.month}</div>
            </div>
            <div className="stat">
              <div className="label">الحالة</div>
              <div className="value">{statusBadgeOf(detail.status)}</div>
            </div>
            <div className="stat">
              <div className="label">أنشأها</div>
              <div className="value" style={{ fontSize: 15 }}>{detail.user_name ?? '—'}</div>
            </div>
            <div className="stat">
              <div className="label">اعتمدها</div>
              <div className="value" style={{ fontSize: 15 }}>
                {detail.approved_by_name ?? '—'}
                {detail.approved_at ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDateTime(detail.approved_at)}</div> : null}
              </div>
            </div>
          </div>
          {detail.note ? <p style={{ fontSize: 13, margin: '0 0 10px' }}>ملاحظة: {detail.note}</p> : null}

          <table className="data">
            <thead>
              <tr>
                <th>المنتج</th>
                <th className="num">رصيد الدفتر</th>
                <th style={{ minWidth: 140 }}>المجرود فعليًا</th>
                <th className="num">الفرق</th>
                <th className="num">تكلفة الوحدة</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => {
                const raw = (edits[it.id] ?? '').trim()
                const countedMilli = raw === '' ? null : toMilli(raw)
                const diff = countedMilli === null ? it.diff_milli : countedMilli - it.system_qty_milli
                return (
                  <tr key={it.id}>
                    <td>{it.product_name}</td>
                    <td className="num">{fmtQ(it.system_qty_milli)}</td>
                    <td>
                      {detail.status === 'DRAFT' && canAdjust ? (
                        <input
                          className="cnt-input"
                          data-item-id={it.id}
                          value={edits[it.id] ?? ''}
                          onChange={(e) => setEdits({ ...edits, [it.id]: e.target.value })}
                          inputMode="decimal"
                          placeholder="فارغ = لم يُجرد"
                          style={{ width: 120 }}
                        />
                      ) : (
                        <>{it.counted_qty_milli === null ? '— لم يُجرد —' : fmtQ(it.counted_qty_milli)}</>
                      )}
                    </td>
                    <td className="num">
                      {diff === null ? (
                        '—'
                      ) : diff === 0 ? (
                        <Badge kind="ok" text="مطابق" />
                      ) : (
                        <Badge kind={diff > 0 ? 'warn' : 'err'} text={`${diff > 0 ? '+' : ''}${fmtQ(diff)}`} />
                      )}
                    </td>
                    <td className="num">{money(it.unit_cost_minor)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {detail.status === 'DRAFT' && canAdjust ? (
              <button className="btn primary" disabled={busy} onClick={() => void submitSaveItems()}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ الكميات'}
              </button>
            ) : null}
            {detail.status === 'DRAFT' && canManage ? (<>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  setApproveNote('')
                  setApproveFor(detail)
                }}
              >
                اعتماد وترحيل الفروق
              </button>{' '}
              <button className="btn ghost" onClick={() => void cancelDraft(detail)} title="حذف المسودة وفك قفل الجرد دون ترحيل">
                حذف المسودة
              </button>
            </>) : null}
            <button className="btn ghost" onClick={() => void openVariance(detail.id)}>
              تقرير الفروق
            </button>
          </div>
        </Modal>
      ) : null}

      {/* نافذة تأكيد الاعتماد */}
      {approveFor ? (
        <Modal title={`اعتماد ورقة الجرد: ${approveFor.count_no}`} onClose={() => setApproveFor(null)}>
          <Banner kind="error" text="الاعتماد نهائي: تُرحَّل فروق الجرد بحركات تسوية موثقة بتاريخ الآن ولا يمكن تعديل الورقة بعدها." />
          <Field label="ملاحظة الاعتماد">
            <input value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="اختياري — تُوثق في سجل التدقيق" autoFocus />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" disabled={busy} onClick={() => void submitApprove()}>
              {busy ? 'جارٍ الاعتماد…' : 'تأكيد الاعتماد'}
            </button>
            <button className="btn ghost" onClick={() => setApproveFor(null)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* نافذة تقرير الفروق */}
      {variance ? (
        <Modal title={`تقرير فروق الجرد: ${variance.count.count_no}`} onClose={() => setVariance(null)} wide>
          <div className="grid-cards" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="label">إجمالي البنود</div>
              <div className="value">{variance.summary.itemsTotal}</div>
            </div>
            <div className="stat">
              <div className="label">بنود مجرودة</div>
              <div className="value">{variance.summary.itemsCounted}</div>
            </div>
            <div className="stat">
              <div className="label">بنود الفرق</div>
              <div className="value">{variance.summary.diffItems}</div>
            </div>
            <div className="stat">
              <div className="label">إجمالي قيمة الفرق (تكلفة)</div>
              <div className={`value ${variance.summary.totalDiffValueMinor < 0 ? 'err' : 'ok'}`}>
                {money(variance.summary.totalDiffValueMinor)}
              </div>
            </div>
          </div>
          {variance.rows.length === 0 ? (
            <EmptyState icon="📄" text="لا بنود مجرودة بعد — احفظ الكميات المجرودة أولًا ثم اعرض التقرير." />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
                <button
                  className="btn ghost"
                  onClick={() => {
                    // rc.8 (P0-1): تصدير فروق الجرد CSV بـ BOM — وعد UAT 2.12
                    downloadCsv(`فروق-الجرد_${variance.count.count_no}`, [
                      ['المنتج', 'رصيد الدفتر', 'المجرود', 'الفرق', 'تكلفة الوحدة', 'قيمة الفرق'],
                      ...variance.rows.map((r) => [
                        r.product_name,
                        fmtQ(r.system_qty_milli),
                        r.counted_qty_milli === null ? '' : fmtQ(r.counted_qty_milli),
                        fmtQ(r.diff_milli),
                        csvMoney(r.unit_cost_minor),
                        csvMoney(r.diff_value_minor)
                      ])
                    ])
                  }}
                >
                  ⬇ تصدير CSV
                </button>
              </div>
              <table className="data">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th className="num">رصيد الدفتر</th>
                  <th className="num">المجرود</th>
                  <th className="num">الفرق</th>
                  <th className="num">تكلفة الوحدة</th>
                  <th className="num">قيمة الفرق</th>
                </tr>
              </thead>
              <tbody>
                {variance.rows.map((r) => (
                  <tr key={r.product_id}>
                    <td>{r.product_name}</td>
                    <td className="num">{fmtQ(r.system_qty_milli)}</td>
                    <td className="num">{fmtQ(r.counted_qty_milli)}</td>
                    <td className="num">
                      {r.diff_milli === 0 ? (
                        <Badge kind="ok" text="مطابق" />
                      ) : (
                        <Badge kind={r.diff_milli > 0 ? 'warn' : 'err'} text={`${r.diff_milli > 0 ? '+' : ''}${fmtQ(r.diff_milli)}`} />
                      )}
                    </td>
                    <td className="num">{money(r.unit_cost_minor)}</td>
                    <td className="num">{money(r.diff_value_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </Modal>
      ) : null}

      {/* نافذة تأكيد إقفال الشهر */}
      {confirmClose ? (
        <Modal title={`تأكيد إقفال الشهر ${closeMonthKey}`} onClose={() => setConfirmClose(false)}>
          <Banner kind="error" text="هذا الإجراء يمنع كل التعديلات المالية والمخزنية بتاريخ داخل هذا الشهر حتى يُفك القفل بسبب موثق." />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" disabled={busy} onClick={() => void submitClose()}>
              {busy ? 'جارٍ الإقفال…' : 'تأكيد الإقفال'}
            </button>
            <button className="btn ghost" onClick={() => setConfirmClose(false)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* نافذة فك القفل — السبب إلزامي */}
      {unlockFor ? (
        <Modal title={`فك قفل الشهر ${unlockFor.month}`} onClose={() => setUnlockFor(null)}>
          <Banner kind="error" text="فك القفل يفتح الشهر للتصحيح — السبب إلزامي ويُسجل في سجل التدقيق، ويمكن إعادة إقفال الشهر بعد التصحيح." />
          <Field label="سبب فك القفل *" hint="3 أحرف على الأقل — يظهر في سجل التدقيق">
            <textarea
              rows={3}
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              placeholder="مثال: تصحيح فاتورة بيع مسجلة بتاريخ خاطئ"
              autoFocus
            />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" disabled={busy || unlockReason.trim().length < 3} onClick={() => void submitUnlock()}>
              {busy ? 'جارٍ فك القفل…' : 'تأكيد فك القفل'}
            </button>
            <button className="btn ghost" onClick={() => setUnlockFor(null)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

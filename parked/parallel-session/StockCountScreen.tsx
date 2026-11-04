// =============================================================
// مخبز الولاء الحديث — شاشة الجرد الشهري وإقفال الشهر (P0-D)
// لقطة أرصدة ← فعلي + سبب إلزامي ← اعتماد يولّد حركات موثقة
// ← إقفال/فك قفل الشهر + تقرير الفروق بالأثر المالي.
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { MonthStatusRow, ProductRow, SessionUser, StockCountView, VarianceReport } from '../../../shared/types'
import { STOCK_COUNT_REASONS } from '../../../shared/types'
import { call, fmtDateTime, money, qty } from '../api'
import { toMilli } from '../../../shared/money'
import { Badge, Banner, EmptyState, Field, Modal } from '../components/ui'

interface EditRow {
  productId: number
  productName: string
  unit: string | null
  system: number
  actualStr: string
  reason: string
  note: string
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(ym: string, delta: number): string {
  const parts = ym.split('-')
  const d = new Date(Number(parts[0] ?? '0'), Number(parts[1] ?? '1') - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function rowsFromView(v: StockCountView): EditRow[] {
  return v.items.map((it) => ({
    productId: it.product_id,
    productName: it.product_name,
    unit: it.unit,
    system: it.system_qty_milli,
    actualStr: qty(it.actual_qty_milli),
    reason: it.reason,
    note: it.note ?? ''
  }))
}

/** قيمة فرق البند بالأغورة: diff × تكلفة الوحدة (نفس صيغة تقييم المخزون) */
function impactMinor(diffMilli: number, costMinor: number): number {
  return Math.round((diffMilli * costMinor) / 1000)
}

export default function StockCountScreen(props: { user: SessionUser }): ReactNode {
  const [month, setMonth] = useState<string>(() => currentMonth())
  const [view, setView] = useState<StockCountView | null>(null)
  const [rows, setRows] = useState<EditRow[]>([])
  const [months, setMonths] = useState<MonthStatusRow[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // نوافذ: اعتماد الجرد، إقفال الشهر، فك القفل، تقرير الفروق
  const [approveOpen, setApproveOpen] = useState(false)
  const [approveCosts, setApproveCosts] = useState<Record<number, number>>({})
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeNote, setCloseNote] = useState('')
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [varianceOpen, setVarianceOpen] = useState(false)
  const [variance, setVariance] = useState<VarianceReport | null>(null)

  const canEdit = props.user.perms.includes('inventory.adjust')
  const count = view?.count ?? null
  const monthInfo = view?.month ?? null
  const locked = monthInfo?.locked === true
  const approved = count?.status === 'APPROVED'
  const editable = canEdit && count !== null && !approved && !locked

  const loadView = useCallback(async (ym: string): Promise<StockCountView> => {
    const v = await call<StockCountView>('stockcount.get', { periodYm: ym })
    setView(v)
    setRows(rowsFromView(v))
    return v
  }, [])

  const loadMonths = useCallback(async (ym: string): Promise<void> => {
    try {
      setMonths(await call<MonthStatusRow[]>('stockcount.getMonthStatuses', { fromYm: shiftMonth(ym, -11), toYm: ym }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadMonths(month)
    void (async () => {
      try {
        await loadView(month)
        setError('')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [month, loadView, loadMonths])

  const pickMonth = useCallback((ym: string): void => {
    setNotice('')
    setError('')
    setMonth(ym)
  }, [])

  const openOrLoad = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const v = await call<StockCountView>('stockcount.open', { periodYm: month })
      setView(v)
      setRows(rowsFromView(v))
      setNotice(v.count?.status === 'DRAFT' ? 'تم فتح/تحميل جرد المسودة للشهر ' + month : 'الجرد الحالي للشهر ' + month + ' معتمد')
      await loadMonths(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [month, loadMonths])

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!count) return
    const items: Array<{ productId: number; actualQtyMilli: number; reason: string; note: string | null }> = []
    for (const r of rows) {
      const milli = toMilli(r.actualStr)
      if (milli === null) {
        setError(`الكمية الفعلية للمنتج «${r.productName}» غير صحيحة — أدخل رقمًا (0 مسموح)`)
        return
      }
      items.push({ productId: r.productId, actualQtyMilli: milli, reason: r.reason, note: r.note.trim() === '' ? null : r.note })
    }
    setBusy(true)
    setError('')
    try {
      const v = await call<StockCountView>('stockcount.saveItems', { countId: count.id, items })
      setView(v)
      setRows(rowsFromView(v))
      setNotice('تم حفظ المسودة')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [count, rows])

  const openApproveConfirm = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const products = await call<Array<ProductRow>>('products.list', { includeInactive: true })
      const costs: Record<number, number> = {}
      for (const p of products) costs[p.id] = p.cost_minor
      setApproveCosts(costs)
      setApproveOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const approveDiffs = rows
    .map((r) => {
      const milli = toMilli(r.actualStr)
      return { row: r, diff: milli === null ? null : milli - r.system }
    })
    .filter((x): x is { row: EditRow; diff: number } => x.diff !== null && x.diff !== 0)
  const approveLoss = approveDiffs.reduce((s, x) => (x.diff < 0 ? s + impactMinor(-x.diff, approveCosts[x.row.productId] ?? 0) : s), 0)
  const approveGain = approveDiffs.reduce((s, x) => (x.diff > 0 ? s + impactMinor(x.diff, approveCosts[x.row.productId] ?? 0) : s), 0)

  const doApprove = useCallback(async (): Promise<void> => {
    if (!count) return
    setBusy(true)
    setError('')
    try {
      const res = await call<StockCountView & { movements: number }>('stockcount.approve', { countId: count.id })
      setApproveOpen(false)
      setView(res)
      setRows(rowsFromView(res))
      setNotice(`تم اعتماد الجرد — أُنشئت ${res.movements} حركة مخزون موثقة`)
      await loadMonths(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [count, month, loadMonths])

  const doCloseMonth = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const res = await call<{ closed: boolean; periodYm: string; warning: string | null }>('stockcount.closeMonth', {
        periodYm: month,
        note: closeNote.trim() === '' ? null : closeNote
      })
      setCloseOpen(false)
      setCloseNote('')
      setNotice(res.warning ? `⚠ ${res.warning}` : `تم إقفال الشهر ${res.periodYm}`)
      await Promise.all([loadMonths(month), loadView(month)])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [month, closeNote, loadMonths, loadView])

  const doUnlock = useCallback(async (): Promise<void> => {
    if (unlockReason.trim().length < 5) {
      setUnlockError('سبب فك القفل يجب أن يكون 5 أحرف على الأقل')
      return
    }
    setBusy(true)
    setError('')
    try {
      await call<{ unlocked: boolean }>('stockcount.unlockMonth', { periodYm: month, unlockReason: unlockReason })
      setUnlockOpen(false)
      setUnlockReason('')
      setUnlockError('')
      setNotice('تم فك القفل عن الشهر ' + month)
      await Promise.all([loadMonths(month), loadView(month)])
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [month, unlockReason, loadMonths, loadView])

  const showVariances = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setVariance(await call<VarianceReport>('stockcount.variances', { periodYm: month }))
      setVarianceOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [month])

  const setRow = (productId: number, patch: Partial<EditRow>): void => {
    setRows((rs) => rs.map((r) => (r.productId === productId ? { ...r, ...patch } : r)))
  }

  const diffCount = rows.filter((r) => {
    const m = toMilli(r.actualStr)
    return m !== null && m - r.system !== 0
  }).length

  return (
    <div>
      <h1>الجرد الشهري</h1>

      {error ? <Banner kind="error" text={error} /> : null}
      {!error && notice ? <Banner kind="ok" text={notice} /> : null}

      {/* شريط حالة الشهر */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>شهر {month}</strong>
          {monthInfo ? (
            locked ? (
              <Badge kind="err" text="مقفل 🔒" />
            ) : monthInfo.closed_at ? (
              <Badge kind="muted" text="فُك القفل" />
            ) : (
              <Badge kind="ok" text="مفتوح" />
            )
          ) : (
            <Badge kind="muted" text="—" />
          )}
          {count ? approved ? <Badge kind="ok" text="جرد معتمد" /> : <Badge kind="warn" text="جرد مسودة" /> : <Badge kind="muted" text="لا جرد بعد" />}
          {monthInfo?.closed_at ? (
            <span className="hint">
              أقفله {monthInfo.closed_by ?? '؟'} في {fmtDateTime(monthInfo.closed_at)}
              {monthInfo.unlocked_at ? ` — فُك القفل في ${fmtDateTime(monthInfo.unlocked_at)}` : ''}
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          type="month"
          dir="ltr"
          value={month}
          onChange={(e) => {
            if (e.target.value) pickMonth(e.target.value)
          }}
          style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', background: '#fff' }}
        />
        {canEdit ? (
          <button className="btn primary small" disabled={busy || locked} onClick={() => void openOrLoad()}>
            فتح/تحميل الجرد
          </button>
        ) : null}
        <button className="btn ghost small" disabled={busy} onClick={() => void showVariances()}>
          تقرير الفروق 📊
        </button>
        {canEdit && count && !approved && !locked ? (
          <button className="btn primary small" disabled={busy} onClick={() => void saveDraft()}>
            حفظ المسودة
          </button>
        ) : null}
        {canEdit && count && !approved && !locked ? (
          <button className="btn primary small" disabled={busy} onClick={() => void openApproveConfirm()}>
            اعتماد الجرد ✓
          </button>
        ) : null}
        {canEdit && !locked ? (
          <button className="btn ghost small" disabled={busy} onClick={() => setCloseOpen(true)}>
            إقفال الشهر 🔒
          </button>
        ) : null}
        {canEdit && locked ? (
          <button className="btn ghost small" disabled={busy} onClick={() => { setUnlockReason(''); setUnlockError(''); setUnlockOpen(true) }}>
            فك القفل 🔓
          </button>
        ) : null}
      </div>

      {view === null ? (
        <EmptyState icon="⏳" text="جارٍ تحميل الجرد…" />
      ) : count === null ? (
        <EmptyState
          icon="📋"
          text={`لا يوجد جرد لشهر ${month} — اضغط «فتح/تحميل الجرد» لالتقاط لقطة الأرصدة النظامية وبدء العدّ${canEdit ? '' : ' (تتطلب صلاحية تعديل المخزون)'}.`}
        />
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>المنتج</th>
              <th>الرصيد النظامي</th>
              <th>الكمية الفعلية</th>
              <th className="num">الفرق</th>
              <th>السبب</th>
              <th>ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const milli = toMilli(r.actualStr)
              const diff = milli === null ? null : milli - r.system
              return (
                <tr key={r.productId}>
                  <td>{r.productName}</td>
                  <td className="num">{qty(r.system)}</td>
                  <td>
                    <input
                      dir="ltr"
                      style={{ width: 110, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px' }}
                      disabled={!editable}
                      placeholder="0"
                      value={r.actualStr}
                      onChange={(e) => setRow(r.productId, { actualStr: e.target.value })}
                    />
                  </td>
                  <td
                    className="num"
                    style={{ color: diff === null || diff === 0 ? 'var(--muted)' : diff > 0 ? 'var(--ok)' : 'var(--err)', fontWeight: 700 }}
                  >
                    {diff === null ? '—' : qty(diff)}
                  </td>
                  <td>
                    <select
                      disabled={!editable}
                      value={r.reason}
                      onChange={(e) => setRow(r.productId, { reason: e.target.value })}
                      style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px' }}
                    >
                      {STOCK_COUNT_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      disabled={!editable}
                      maxLength={300}
                      style={{ width: '100%', minWidth: 140, border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px' }}
                      placeholder="اختياري"
                      value={r.note}
                      onChange={(e) => setRow(r.productId, { note: e.target.value })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ fontWeight: 700, color: 'var(--brown-900)' }}>
                بنود ذات فروق
              </td>
              <td className="num" style={{ fontWeight: 800 }}>
                {diffCount}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      )}

      {/* أشهر سابقة: حالة الجرد والإقفال */}
      {months.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 17 }}>حالة الأشهر (12 شهرًا حتى {month})</h2>
          <table className="data">
            <thead>
              <tr>
                <th>الشهر</th>
                <th>الجرد</th>
                <th>الحالة</th>
                <th>تفاصيل الإقفال</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.period_ym} style={{ cursor: 'pointer' }} onClick={() => pickMonth(m.period_ym)}>
                  <td dir="ltr" style={{ textAlign: 'start' }}>
                    {m.period_ym}
                  </td>
                  <td>
                    {m.count_id === null ? (
                      <Badge kind="muted" text="لا جرد" />
                    ) : m.count_status === 'APPROVED' ? (
                      <Badge kind="ok" text="معتمد" />
                    ) : (
                      <Badge kind="warn" text="مسودة" />
                    )}
                  </td>
                  <td>{m.locked ? <Badge kind="err" text="مقفل" /> : m.closed_at ? <Badge kind="muted" text="فُك القفل" /> : <Badge kind="ok" text="مفتوح" />}</td>
                  <td className="hint">
                    {m.closed_at
                      ? `أقفله ${m.closed_by ?? '؟'} في ${fmtDateTime(m.closed_at)}${m.unlocked_at ? ` — فُك في ${fmtDateTime(m.unlocked_at)}` : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* تأكيد اعتماد الجرد */}
      {approveOpen ? (
        <Modal title="اعتماد الجرد" onClose={() => setApproveOpen(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            الاعتماد يُنشئ حركة مخزون موثقة لكل فرق (WASTE للهالك/التلف/الفقدان، ADJUSTMENT لغيرها) — لا يمكن التراجع إلا بحركات عكسية.
          </p>
          {approveDiffs.length === 0 ? (
            <p>لا توجد أي فروق — الجرد مطابق للرصيد النظامي.</p>
          ) : (
            <>
              <p>
                عدد البنود ذات الفروق: <strong>{approveDiffs.length}</strong>
              </p>
              <p>
                قيمة العجز (تُخصم): <strong style={{ color: 'var(--err)' }}>{money(approveLoss)}</strong>
              </p>
              <p>
                قيمة الفائض (تُضاف): <strong style={{ color: 'var(--ok)' }}>{money(approveGain)}</strong>
              </p>
            </>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void doApprove()}>
              {busy ? 'جارٍ الاعتماد…' : 'تأكيد الاعتماد'}
            </button>
            <button className="btn ghost" onClick={() => setApproveOpen(false)}>
              رجوع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* تأكيد إقفال الشهر */}
      {closeOpen ? (
        <Modal title={`إقفال الشهر ${month}`} onClose={() => setCloseOpen(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            بعد الإقفال تُرفض كل الحركات الرجعية على هذا الشهر (تصحيح/هالك/افتتاحي/فواتير بتاريخه) حتى يُفك القفل بسبب موثق.
          </p>
          <Field label="ملاحظة (اختياري)">
            <input value={closeNote} maxLength={300} onChange={(e) => setCloseNote(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void doCloseMonth()}>
              {busy ? 'جارٍ الإقفال…' : 'تأكيد الإقفال'}
            </button>
            <button className="btn ghost" onClick={() => setCloseOpen(false)}>
              رجوع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* فك القفل */}
      {unlockOpen ? (
        <Modal title={`فك قفل الشهر ${month}`} onClose={() => setUnlockOpen(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            السبب إلزامي (5 أحرف على الأقل) ويُسجل في سجل التدقيق مع اسمك ووقت الفك.
          </p>
          {unlockError ? <Banner kind="error" text={unlockError} /> : null}
          <Field label="سبب فك القفل">
            <input value={unlockReason} maxLength={300} onChange={(e) => setUnlockReason(e.target.value)} placeholder="مثال: تصحيح فاتورة نسيان تسجيلها" />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void doUnlock()}>
              {busy ? 'جارٍ فك القفل…' : 'تأكيد فك القفل'}
            </button>
            <button className="btn ghost" onClick={() => setUnlockOpen(false)}>
              رجوع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* تقرير الفروق */}
      {varianceOpen && variance ? (
        <Modal title={`تقرير الفروق — ${variance.count.period_ym}`} onClose={() => setVarianceOpen(false)} wide>
          <p className="hint" style={{ marginTop: 0 }}>
            جرد #{variance.count.id} — {variance.count.status === 'APPROVED' ? 'معتمد' : 'مسودة'} — الأثر المالي = الفرق × تكلفة الوحدة.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>المنتج</th>
                <th className="num">النظامي</th>
                <th className="num">الفعلي</th>
                <th className="num">الفرق</th>
                <th>السبب</th>
                <th>ملاحظة</th>
                <th className="num">الأثر المالي</th>
              </tr>
            </thead>
            <tbody>
              {variance.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.product_name}</td>
                  <td className="num">{qty(it.system_qty_milli)}</td>
                  <td className="num">{qty(it.actual_qty_milli)}</td>
                  <td className="num" style={{ color: it.diff_milli === 0 ? 'var(--muted)' : it.diff_milli > 0 ? 'var(--ok)' : 'var(--err)' }}>
                    {qty(it.diff_milli)}
                  </td>
                  <td>{it.reason}</td>
                  <td>{it.note ?? '—'}</td>
                  <td className="num" style={{ color: it.impact_minor === 0 ? 'var(--muted)' : it.impact_minor > 0 ? 'var(--ok)' : 'var(--err)' }}>
                    {money(it.impact_minor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} style={{ fontWeight: 700 }}>
                  إجمالي العجز
                </td>
                <td className="num" style={{ fontWeight: 800, color: 'var(--err)' }}>
                  {money(variance.lossMinor)}
                </td>
              </tr>
              <tr>
                <td colSpan={6} style={{ fontWeight: 700 }}>
                  إجمالي الفائض
                </td>
                <td className="num" style={{ fontWeight: 800, color: 'var(--ok)' }}>
                  {money(variance.gainMinor)}
                </td>
              </tr>
              <tr>
                <td colSpan={6} style={{ fontWeight: 700 }}>
                  الصافي
                </td>
                <td className="num" style={{ fontWeight: 800 }}>
                  {money(variance.netMinor)}
                </td>
              </tr>
            </tfoot>
          </table>
          {variance.month?.locked ? (
            <p className="hint" style={{ marginTop: 10 }}>
              🔒 هذا الشهر مقفل — أقفله {variance.month.closed_by ?? '؟'} في {fmtDateTime(variance.month.closed_at ?? '')}.
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  )
}

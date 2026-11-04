// =============================================================
// مخبز الولاء الحديث — شاشة الجرد الشهري وإقفال الشهر (P0-D)
// لقطة أرصدة ← فعلي + سبب إلزامي ← اعتماد يولّد حركات موثقة
// ← إقفال/فك قفل الشهر + تقرير الفروق بالأثر المالي.
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AppSettings,
  MonthStatusRow,
  SessionUser,
  StockCountView,
  VarianceReport
} from '../../../shared/types'
import { STOCK_COUNT_REASONS } from '../../../shared/types'
import { fromMilli, toMilli } from '../../../shared/money'
import { call, fmtDateTime, money, qty } from '../api'
import { Badge, Banner, EmptyState, Modal } from '../components/ui'

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
    actualStr: String(fromMilli(it.actual_qty_milli)),
    reason: it.reason,
    note: it.note ?? ''
  }))
}

export default function StockCountScreen(props: {
  user: SessionUser
  settings: AppSettings | null
}): ReactNode {
  const cur = props.settings?.currencySymbol ?? '₪'
  const [month, setMonth] = useState<string>(() => currentMonth())
  const [view, setView] = useState<StockCountView | null>(null)
  const [rows, setRows] = useState<EditRow[]>([])
  const [months, setMonths] = useState<MonthStatusRow[]>([])
  const [variance, setVariance] = useState<VarianceReport | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [approveOpen, setApproveOpen] = useState(false)
  const [approveEst, setApproveEst] = useState<{ loss: number; gain: number; diffs: number } | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeNote, setCloseNote] = useState('')
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [varianceOpen, setVarianceOpen] = useState(false)

  const count = view?.count ?? null
  const locked = view?.month?.locked ?? false
  const approved = count?.status === 'APPROVED'
  const canEdit = props.user.perms.includes('inventory.adjust')
  const canAdmin = props.user.perms.includes('settings.manage')
  const editable = canEdit && count !== null && !approved && !locked

  const loadView = useCallback(async (ym: string): Promise<void> => {
    try {
      const v = await call<StockCountView>('stockcount.get', { periodYm: ym })
      setView(v)
      setRows(rowsFromView(v))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const loadMonths = useCallback(async (ym: string): Promise<void> => {
    try {
      setMonths(await call<MonthStatusRow[]>('stockcount.getMonthStatuses', { fromYm: shiftMonth(ym, -11), toYm: ym }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadView(month)
    void loadMonths(month)
  }, [month, loadView, loadMonths])

  const pickMonth = (ym: string): void => {
    setError('')
    setNotice('')
    setVariance(null)
    setMonth(ym)
  }

  const setRow = (productId: number, patch: Partial<EditRow>): void => {
    setRows((rs) => rs.map((r) => (r.productId === productId ? { ...r, ...patch } : r)))
  }

  const openOrLoad = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const v = await call<StockCountView>('stockcount.open', { periodYm: month })
      setView(v)
      setRows(rowsFromView(v))
      setNotice(v.count?.status === 'DRAFT' ? 'جرد جارٍ — عدّل الكميات الفعلية واحفظ المسودة' : 'تم تحميل الجرد القائم')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async (): Promise<boolean> => {
    if (count === null) return false
    const items = rows.map((r) => {
      const milli = toMilli(r.actualStr)
      if (milli === null) throw new Error(`الكمية الفعلية للمنتج «${r.productName}» غير صالحة`)
      return { productId: r.productId, actualQtyMilli: milli, reason: r.reason, note: r.note.trim() || undefined }
    })
    const v = await call<StockCountView>('stockcount.saveItems', { countId: count.id, items })
    setView(v)
    setRows(rowsFromView(v))
    return true
  }

  const onSaveDraft = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await saveDraft()
      setNotice('تم حفظ المسودة')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** اعتماد: يحفظ المسودة أولًا ثم يجلب الفروق لتقدير الأثر المالي قبل التأكيد */
  const openApproveConfirm = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await saveDraft()
      const rep = await call<VarianceReport>('stockcount.variances', { periodYm: month })
      let loss = 0
      let gain = 0
      let diffs = 0
      for (const it of rep.items) {
        if (it.diff_milli !== 0) diffs++
        if (it.impact_minor < 0) loss += -it.impact_minor
        else if (it.impact_minor > 0) gain += it.impact_minor
      }
      setApproveEst({ loss, gain, diffs })
      setApproveOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doApprove = async (): Promise<void> => {
    if (count === null) return
    setBusy(true)
    setError('')
    try {
      const res = await call<StockCountView & { movements: number }>('stockcount.approve', { countId: count.id })
      setView(res)
      setRows(rowsFromView(res))
      setApproveOpen(false)
      setNotice(`تم اعتماد الجرد — أُنشئت ${res.movements} حركة مخزون موثقة`)
      void loadMonths(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doClose = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const res = await call<{ closed: boolean; periodYm: string; warning: string | null }>('stockcount.closeMonth', {
        periodYm: month,
        note: closeNote.trim() || undefined
      })
      setCloseOpen(false)
      setCloseNote('')
      setNotice(res.warning ? `أُقفل الشهر — تنبيه: ${res.warning}` : `أُقفل شهر ${res.periodYm} — لا تعديل رجعي حتى فك القفل`)
      await loadView(month)
      void loadMonths(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doUnlock = async (): Promise<void> => {
    if (unlockReason.trim().length < 5) {
      setUnlockError('سبب فك القفل يجب أن يكون 5 أحرف على الأقل — يُوثق في سجل التدقيق')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await call<{ unlocked: boolean; periodYm: string }>('stockcount.unlockMonth', {
        periodYm: month,
        unlockReason: unlockReason.trim()
      })
      setUnlockOpen(false)
      setUnlockReason('')
      setUnlockError('')
      setNotice(`فُك قفل شهر ${res.periodYm} — أصبح الشهر قابلًا للتعديل`)
      await loadView(month)
      void loadMonths(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const showVariances = async (): Promise<void> => {
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
  }

  const diffCount = useMemo(
    () =>
      rows.filter((r) => {
        const m = toMilli(r.actualStr)
        return m !== null && m - r.system !== 0
      }).length,
    [rows]
  )

  return (
    <div>
      <h1>الجرد الشهري وإقفال الشهر</h1>

      {error ? <Banner kind="error" text={error} /> : null}
      {!error && notice ? <Banner kind="ok" text={notice} /> : null}

      {/* شريط حالة الشهر */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>شهر {month}</strong>
          {view?.month ? (
            locked ? (
              <Badge kind="err" text="مقفل 🔒" />
            ) : view.month.closed_at ? (
              <Badge kind="muted" text="فُك القفل" />
            ) : (
              <Badge kind="ok" text="مفتوح" />
            )
          ) : (
            <Badge kind="muted" text="—" />
          )}
          {count ? (
            approved ? (
              <Badge kind="ok" text="جرد معتمد" />
            ) : (
              <Badge kind="warn" text="جرد مسودة" />
            )
          ) : (
            <Badge kind="muted" text="لا جرد بعد" />
          )}
          {view?.month?.closed_at ? (
            <span className="hint">
              أقفله {view.month.closed_by ?? '؟'} في {fmtDateTime(view.month.closed_at)}
              {view.month.unlocked_at ? ` — فُك القفل في ${fmtDateTime(view.month.unlocked_at)}` : ''}
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
        {editable ? (
          <button className="btn primary small" disabled={busy} onClick={() => void onSaveDraft()}>
            حفظ المسودة
          </button>
        ) : null}
        {editable ? (
          <button className="btn primary small" disabled={busy} onClick={() => void openApproveConfirm()}>
            اعتماد الجرد ✓
          </button>
        ) : null}
        {canAdmin && !locked ? (
          <button className="btn ghost small" disabled={busy} onClick={() => setCloseOpen(true)}>
            إقفال الشهر 🔒
          </button>
        ) : null}
        {canAdmin && locked ? (
          <button
            className="btn ghost small"
            disabled={busy}
            onClick={() => {
              setUnlockReason('')
              setUnlockError('')
              setUnlockOpen(true)
            }}
          >
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
                  <td className="num">
                    {qty(r.system)} {r.unit ?? ''}
                  </td>
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
                    style={{
                      color: diff === null || diff === 0 ? 'var(--muted)' : (diff ?? 0) > 0 ? 'var(--ok)' : 'var(--err)',
                      fontWeight: 700
                    }}
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
              <td colSpan={3} style={{ fontWeight: 700 }}>
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

      {/* حالة الأشهر السابقة */}
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
                  <td>
                    {m.locked ? <Badge kind="err" text="مقفل" /> : m.closed_at ? <Badge kind="muted" text="فُك القفل" /> : <Badge kind="ok" text="مفتوح" />}
                  </td>
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
          {approveEst === null ? null : approveEst.diffs === 0 ? (
            <p>لا توجد أي فروق — الجرد مطابق للرصيد النظامي.</p>
          ) : (
            <>
              <p>
                عدد البنود ذات الفروق: <strong>{approveEst.diffs}</strong>
              </p>
              <p>
                قيمة العجز المتوقعة (تُخصم):{' '}
                <strong style={{ color: 'var(--err)' }}>{money(approveEst.loss, cur)}</strong>
              </p>
              {approveEst.gain > 0 ? (
                <p>
                  قيمة الفائض المتوقعة: <strong style={{ color: 'var(--ok)' }}>{money(approveEst.gain, cur)}</strong>
                </p>
              ) : null}
            </>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn primary" disabled={busy} onClick={() => void doApprove()}>
              تأكيد الاعتماد ✓
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setApproveOpen(false)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* إقفال الشهر */}
      {closeOpen ? (
        <Modal title={`إقفال شهر ${month}`} onClose={() => setCloseOpen(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            الإقفال يمنع أي بيع/شراء/تعديل مخزون بتاريخ داخل هذا الشهر حتى يُفك القفل بسبب موثق. يُفضّل اعتماد الجرد قبل الإقفال.
          </p>
          <div style={{ margin: '10px 0' }}>
            <input
              maxLength={300}
              placeholder="ملاحظة اختيارية"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void doClose()}>
              تأكيد الإقفال 🔒
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setCloseOpen(false)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* فك القفل */}
      {unlockOpen ? (
        <Modal title={`فك قفل شهر ${month}`} onClose={() => setUnlockOpen(false)}>
          <p className="hint" style={{ marginTop: 0 }}>
            سبب فك القفل إلزامي (5 أحرف على الأقل) ويُوثق في سجل التدقيق وفي سجل الإقفال.
          </p>
          <div style={{ margin: '10px 0' }}>
            <input
              maxLength={300}
              placeholder="السبب — مثال: تسوية جرد بعد مراجعة المحاسب"
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}
            />
            {unlockError ? (
              <div style={{ color: 'var(--err)', fontSize: 12, marginTop: 6 }}>{unlockError}</div>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => void doUnlock()}>
              تأكيد فك القفل 🔓
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setUnlockOpen(false)}>
              تراجع
            </button>
          </div>
        </Modal>
      ) : null}

      {/* تقرير الفروق */}
      {varianceOpen && variance ? (
        <Modal title={`تقرير الفروق — جرد ${variance.count.period_ym}`} onClose={() => setVarianceOpen(false)} wide>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
            <span>
              خسائر: <strong style={{ color: 'var(--err)' }}>{money(variance.lossMinor, cur)}</strong>
            </span>
            <span>
              أرباح (فائض): <strong style={{ color: 'var(--ok)' }}>{money(variance.gainMinor, cur)}</strong>
            </span>
            <span>
              الصافي:{' '}
              <strong style={{ color: variance.netMinor < 0 ? 'var(--err)' : 'var(--ok)' }}>{money(variance.netMinor, cur)}</strong>
            </span>
            <span>
              الحالة: {variance.month.locked ? 'الشهر مقفل 🔒' : 'الشهر مفتوح'}
            </span>
          </div>
          <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th className="num">نظامي</th>
                  <th className="num">فعلي</th>
                  <th className="num">الفرق</th>
                  <th>السبب</th>
                  <th className="num">تكلفة الوحدة</th>
                  <th className="num">الأثر المالي</th>
                </tr>
              </thead>
              <tbody>
                {variance.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product_name}</td>
                    <td className="num">{qty(it.system_qty_milli)}</td>
                    <td className="num">{qty(it.actual_qty_milli)}</td>
                    <td className="num" style={{ color: it.diff_milli === 0 ? 'var(--muted)' : it.diff_milli > 0 ? 'var(--ok)' : 'var(--err)', fontWeight: 700 }}>
                      {qty(it.diff_milli)}
                    </td>
                    <td>{it.reason}</td>
                    <td className="num">{money(it.cost_minor, cur)}</td>
                    <td className="num" style={{ color: it.impact_minor < 0 ? 'var(--err)' : it.impact_minor > 0 ? 'var(--ok)' : 'var(--muted)' }}>
                      {money(it.impact_minor, cur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

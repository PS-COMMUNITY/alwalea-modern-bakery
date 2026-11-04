// =============================================================
// مخبز الولاء الحديث — سجل التدقيق
// القناة: audit.list (الخادم يعيد آخر 500 حركة مع فلاتر from/to/action)
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { call, fmtDateTime } from '../api'
import { Banner, EmptyState } from '../components/ui'

interface AuditRow {
  id: number
  date: string
  user_id: number | null
  username: string | null
  action: string
  entity: string | null
  entity_id: number | null
  details: string | null
  created_at: string
}

const PAGE_SIZE = 50

const ACTION_LABELS: Record<string, string> = {
  'sale.create': 'إنشاء فاتورة بيع',
  'sale.cancel': 'إلغاء فاتورة بيع',
  'purchase.create': 'إنشاء فاتورة شراء',
  'purchase.cancel': 'إلغاء فاتورة شراء',
  'customer.create': 'إضافة عميل',
  'customer.update': 'تعديل عميل',
  'customer.payment': 'دفعة عميل',
  'customer.adjust': 'تسوية عميل',
  'supplier.create': 'إضافة مورد',
  'supplier.update': 'تعديل مورد',
  'supplier.payment': 'دفعة مورد',
  'recipe.create': 'إضافة وصفة',
  'recipe.update': 'تعديل وصفة',
  'production.create': 'ترحيل دفعة إنتاج',
  'production.cancel': 'إلغاء دفعة إنتاج',
  'distribution.rep_create': 'إضافة مندوب',
  'distribution.rep_update': 'تعديل مندوب',
  'distribution.route_create': 'إضافة خط',
  'distribution.route_update': 'تعديل خط',
  'distribution.trip_create': 'فتح جولة',
  'distribution.trip_load': 'تحميل جولة',
  'distribution.trip_sale': 'بيع جولة',
  'distribution.trip_return': 'مرتجع جولة',
  'distribution.trip_settle': 'تسوية جولة',
  'distribution.trip_cancel': 'إلغاء جولة',
  'expense.create': 'تسجيل مصروف',
  'expense.cancel': 'إلغاء مصروف',
  'expense_category.create': 'إضافة فئة مصروف',
  'shift.open': 'فتح وردية',
  'shift.close': 'إغلاق وردية',
  'cash.record': 'تسوية صندوق',
  'settings.update': 'تحديث إعدادات',
  'users.create': 'إنشاء مستخدم',
  'users.update': 'تحديث مستخدم',
  'users.password_change': 'تغيير كلمة مرور',
  'users.pin_change': 'تغيير رمز PIN',
  'backup.export': 'تصدير نسخة احتياطية',
  'backup.restore': 'استعادة نسخة احتياطية',
  LOGIN: 'تسجيل دخول',
  LOGIN_FAILED: 'محاولة دخول فاشلة',
  LOGOUT: 'تسجيل خروج'
}

const ENTITY_LABELS: Record<string, string> = {
  sale: 'فاتورة بيع',
  purchase: 'فاتورة شراء',
  customer: 'عميل',
  supplier: 'مورد',
  product: 'منتج',
  category: 'فئة',
  recipe: 'وصفة',
  batch: 'دفعة إنتاج',
  trip: 'جولة توزيع',
  rep: 'مندوب',
  route: 'خط توزيع',
  expense: 'مصروف',
  expense_category: 'فئة مصروف',
  shift: 'وردية',
  cash: 'صندوق',
  user: 'مستخدم',
  settings: 'إعدادات',
  backup: 'نسخة احتياطية',
  stock: 'مخزون'
}

function actionLabel(a: string): string {
  return ACTION_LABELS[a] ?? a
}

function entityLabel(e: string | null): string {
  if (!e) return '—'
  return ENTITY_LABELS[e] ?? e
}

/** تنسيق تفاصيل القيد (JSON) لعرض مقروء */
function formatDetails(raw: string | null): string {
  if (!raw) return '—'
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') {
      return JSON.stringify(parsed, null, 1)
    }
    return raw
  } catch {
    return raw
  }
}

export default function AuditScreen(): ReactNode {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      if (from) payload.from = from
      if (to) payload.to = to
      if (action.trim()) payload.action = action.trim()
      setRows(await call<AuditRow[]>('audit.list', payload))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [from, to, action])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [from, to, action])

  const all = rows ?? []
  const pageCount = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ marginRight: 'auto' }}>سجل التدقيق</h1>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>من تاريخ</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>إلى تاريخ</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>الإجراء</label>
          <input
            dir="ltr"
            placeholder="مثال: sale.cancel"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px', minWidth: 160 }}
          />
        </div>
      </div>

      {error ? <Banner kind="error" text={error} /> : null}

      {rows === null ? (
        <EmptyState icon="⏳" text="جارٍ التحميل…" />
      ) : all.length === 0 ? (
        <EmptyState icon="🛡️" text="لا حركات تدقيق مطابقة للفلاتر الحالية — كل إجراء حساس في النظام يُوثق هنا تلقائيًا." />
      ) : (
        <>
          <div style={{ maxHeight: 520, overflowY: 'auto', borderRadius: 'var(--radius)' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المستخدم</th>
                  <th>الإجراء</th>
                  <th>الكيان</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                    <td>{r.username ?? 'النظام'}</td>
                    <td>
                      {actionLabel(r.action)}
                      <div dir="ltr" style={{ fontSize: 11, color: 'var(--muted)' }}>{r.action}</div>
                    </td>
                    <td>
                      {entityLabel(r.entity)}
                      {r.entity_id !== null ? <span style={{ color: 'var(--muted)', fontSize: 12 }}> #{r.entity_id}</span> : null}
                    </td>
                    <td>
                      <code dir="ltr" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: 'block', maxWidth: 340, color: 'var(--brown-700)' }}>
                        {formatDetails(r.details)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              {all.length} حركة — يعرض الخادم آخر 500 حركة كحد أقصى
            </span>
            <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn ghost small" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ‹ السابق
              </button>
              <span style={{ fontSize: 13 }}>
                صفحة {safePage} من {pageCount}
              </span>
              <button className="btn ghost small" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                التالي ›
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

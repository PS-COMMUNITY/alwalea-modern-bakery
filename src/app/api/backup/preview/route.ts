import { NextRequest } from 'next/server'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

const EXPECTED_TABLES = [
  'settings', 'users', 'categories', 'products', 'customers', 'customerLedgerEntries',
  'suppliers', 'supplierLedgerEntries', 'sales', 'saleItems', 'salePayments',
  'purchases', 'purchaseItems', 'purchasePayments', 'stockMovements', 'recipes',
  'recipeItems', 'productionBatches', 'expenseCategories', 'expenses', 'shifts',
  'cashMovements', 'distributionReps', 'distributionRoutes', 'distributionTrips',
  'tripLoads', 'tripSales', 'tripReturns', 'auditLogs', 'sequences', 'backupRecords',
]

// دعم التسميتين: snake_case (التصدير الموثق) وcamelCase
const ALIASES: Record<string, string[]> = {
  settings: ['settings'], users: ['users'], categories: ['categories'], products: ['products'],
  customers: ['customers'], customerLedgerEntries: ['customer_ledger', 'customerLedgerEntries'],
  suppliers: ['suppliers'], supplierLedgerEntries: ['supplier_ledger', 'supplierLedgerEntries'],
  sales: ['sales'], saleItems: ['sale_items', 'saleItems'], salePayments: ['sale_payments', 'salePayments'],
  purchases: ['purchases'], purchaseItems: ['purchase_items', 'purchaseItems'], purchasePayments: ['purchase_payments', 'purchasePayments'],
  stockMovements: ['stock_movements', 'stockMovements'], recipes: ['recipes'], recipeItems: ['recipe_items', 'recipeItems'],
  productionBatches: ['production_batches', 'productionBatches'], expenseCategories: ['expense_categories', 'expenseCategories'],
  expenses: ['expenses'], shifts: ['shifts'], cashMovements: ['cash_movements', 'cashMovements'],
  distributionReps: ['distribution_reps', 'distributionReps'], distributionRoutes: ['distribution_routes', 'distributionRoutes'],
  distributionTrips: ['distribution_trips', 'distributionTrips'], tripLoads: ['trip_loads', 'tripLoads'],
  tripSales: ['trip_sales', 'tripSales'], tripReturns: ['trip_returns', 'tripReturns'],
  auditLogs: ['audit_log', 'auditLogs'], sequences: ['sequences'], backupRecords: ['backup_records', 'backupRecords'],
}

function pickTables(tables: Record<string, unknown[]>, name: string): unknown[] {
  for (const key of ALIASES[name] ?? [name]) {
    if (Array.isArray(tables[key])) return tables[key] as unknown[]
  }
  return []
}

type PreviewTable = { table: string; rows: number }

/** فحص ملف نسخة احتياطية وعرض معاينة قبل الاستعادة */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'backup.manage')
    if ('response' in r) return r.response

    const body = await req.json().catch(() => null)
    const raw = body && typeof body.data === 'string' ? body.data : null
    if (!raw) return fail(400, 'لم يُرسل محتوى الملف')

    let parsed: { schemaVersion?: unknown; exportedAt?: unknown; tables?: Record<string, unknown[]> }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return fail(400, 'الملف ليس JSON صالحًا')
    }
    if (!parsed || typeof parsed !== 'object') return fail(400, 'بنية الملف غير صالحة')
    if (parsed.schemaVersion !== '1.0.0') {
      return fail(400, `إصدار المخطط غير متوافق (المتوقع 1.0.0، الموجود ${String(parsed.schemaVersion ?? 'غير موجود')})`)
    }
    const tables = parsed.tables
    if (!tables || typeof tables !== 'object') return fail(400, 'قسم الجداول مفقود من الملف')

    const summary: PreviewTable[] = []
    const warnings: string[] = []
    for (const t of EXPECTED_TABLES) {
      const rows = pickTables(tables, t).length
      summary.push({ table: t, rows })
    }
    const knownAliasKeys = new Set(Object.values(ALIASES).flat())
    const unknownTables = Object.keys(tables).filter(t => !knownAliasKeys.has(t))
    for (const t of unknownTables) warnings.push(`جدول غير معروف في الملف: ${t} — سيُتجاهل`)

    return ok({
      exportedAt: parsed.exportedAt ?? null,
      schemaVersion: parsed.schemaVersion,
      tables: summary,
      totalRows: summary.reduce((a, b) => a + b.rows, 0),
      warnings,
      confirmRequired: true,
      message: 'الاستعادة ستستبدل كل البيانات الحالية بالكامل. تأكد من وجود نسخة احتياطية حديثة أولًا.',
    })
  })
}

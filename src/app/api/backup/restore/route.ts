import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'
import { analyzeBackupUsers, hasValidAuthMaterial, MIN_OWNER_PASSWORD_LENGTH, transformBackupUsers, type TableRow } from '@/lib/bakery/backup-auth'

/** استعادة نسخة احتياطية — تستبدل كل البيانات بعد فحص الإصدار */
export const dynamic = 'force-dynamic'

/**
 * استعادة نسخة احتياطية — تستبدل كل البيانات بعد فحص الإصدار وفحص جاهزية بيانات المصادقة.
 *
 * سياسة المصادقة (فحص مسبق قبل أي تغيير):
 * - نسخة بكل المستخدمين ببيانات تحقق صالحة (هاش+ملح scrypt سليمان) → تُستعاد كما هي.
 * - نسخة فيها أي مستخدم بهاش/ملح فارغ أو غير صالح (كالنسخ المغقّمة القابلة للتداول) →
 *   تُرفض برسالة واضحة ما لم يُرسل newOwnerPassword (≥ 4 محارف) لتعيينه للمالك
 *   عبر آلية المصادقة الحالية (scrypt + ملح مستقل) — وبقية المستخدمين بلا بيانات
 *   صالحة يُدخلون ببيانات اعتماد مقفلة عشوائية (لا كلمة ثابتة ولا باب خلفي).
 * - كل الاستعادة داخل معاملة واحدة: أي فشل يُرجع القاعدة كما كانت دون حالة جزئية.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'backup.manage')
    if ('response' in r) return r.response

    const body = await req.json().catch(() => null)
    const raw = body && typeof body.data === 'string' ? body.data : null
    if (!raw) return fail(400, 'لم يُرسل محتوى الملف')
    if (body.confirm !== true) return fail(400, 'يجب تأكيد الاستعادة (confirm: true) بعد مراجعة المعاينة')
    const newOwnerPassword = typeof body.newOwnerPassword === 'string' ? body.newOwnerPassword : null
    if (newOwnerPassword !== null && newOwnerPassword.length < MIN_OWNER_PASSWORD_LENGTH) {
      return fail(422, `كلمة مرور المالك الجديدة يجب ألا تقل عن ${MIN_OWNER_PASSWORD_LENGTH} أحرف/أرقام`)
    }

    let parsed: { schemaVersion?: unknown; tables?: Record<string, TableRow[]> }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return fail(400, 'الملف ليس JSON صالحًا')
    }
    if (parsed.schemaVersion !== '1.0.0') return fail(400, 'إصدار المخطط غير متوافق — تم رفض الاستعادة دون أي تغيير')
    const t = parsed.tables
    if (!t || typeof t !== 'object') return fail(400, 'قسم الجداول مفقود')

    // دعم التسميات: camelCase وsnake_case ومختصرات المفاتيح في صيغة التصدير
    const EXTRA_ALIASES: Record<string, string[]> = {
      customerLedgerEntries: ['customer_ledger'],
      supplierLedgerEntries: ['supplier_ledger'],
      auditLogs: ['audit_log'],
    }
    const pick = (name: string): TableRow[] => {
      const candidates = [name, name.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), ...(EXTRA_ALIASES[name] ?? [])]
      for (const key of candidates) {
        if (Array.isArray(t[key])) return t[key] as TableRow[]
      }
      return []
    }
    const dates = (row: TableRow, keys: string[]): TableRow => {
      const c: TableRow = { ...row }
      for (const k of keys) if (typeof c[k] === 'string') c[k] = new Date(c[k] as string)
      return c
    }

    const restored: Record<string, number> = {}

    // ===== فحص جاهزية المصادقة قبل أي تغيير — الرفض هنا لا يلمس القاعدة إطلاقًا =====
    const usersRaw = pick('users') as TableRow[]
    if (usersRaw.length === 0) return fail(422, 'النسخة لا تحتوي مستخدمين — رُفضت الاستعادة دون أي تغيير')
    const readiness = analyzeBackupUsers(usersRaw)
    if (!readiness.authReady) {
      if (!newOwnerPassword) {
        return fail(422,
          `النسخة لا تتضمن بيانات تحقق صالحة (${readiness.invalid} من ${readiness.total} مستخدمًا بلا هاش كلمة مرور) — ` +
          'لا يمكن استعادتها كما هي منعًا لقفل الحسابات. عيّن كلمة مرور جديدة للمالك (حقل «كلمة مرور المالك الجديدة») ثم أعد الاستعادة، أو استخدم نسخة تتضمن بيانات تحقق صالحة.'
        )
      }
    }
    let userRows: TableRow[]
    let ownerResetUsername: string | null = null
    let lockedUsers = 0
    try {
      const t = transformBackupUsers(usersRaw, newOwnerPassword)
      userRows = t.rows
      ownerResetUsername = t.ownerResetUsername
      lockedUsers = t.lockedCount
    } catch (e) {
      return fail(422, e instanceof Error ? e.message : 'بيانات المصادقة في النسخة غير جاهزة — رُفضت الاستعادة دون أي تغيير')
    }

    await db.$transaction(async tx => {
      // حذف بترتيب يحترم المفاتيح الأجنبية (الأبناء أولًا)
      await tx.session.deleteMany({})
      await tx.auditLog.deleteMany({})
      await tx.salePayment.deleteMany({})
      await tx.saleItem.deleteMany({})
      await tx.purchasePayment.deleteMany({})
      await tx.purchaseItem.deleteMany({})
      await tx.customerLedgerEntry.deleteMany({})
      await tx.supplierLedgerEntry.deleteMany({})
      await tx.tripSale.deleteMany({})
      await tx.tripReturn.deleteMany({})
      await tx.tripLoad.deleteMany({})
      await tx.cashMovement.deleteMany({})
      await tx.stockMovement.deleteMany({})
      await tx.productionBatch.deleteMany({})
      await tx.expense.deleteMany({})
      await tx.expenseCategory.deleteMany({})
      await tx.recipeItem.deleteMany({})
      await tx.recipe.deleteMany({})
      await tx.distributionTrip.deleteMany({})
      await tx.distributionRoute.deleteMany({})
      await tx.distributionRep.deleteMany({})
      await tx.shift.deleteMany({})
      await tx.sale.deleteMany({})
      await tx.purchase.deleteMany({})
      await tx.product.deleteMany({})
      await tx.category.deleteMany({})
      await tx.customer.deleteMany({})
      await tx.supplier.deleteMany({})
      await tx.backupRecord.deleteMany({})
      await tx.sequence.deleteMany({})
      await tx.user.deleteMany({})
      await tx.settings.deleteMany({})

      // ===== المرحلة 1: إنشاء كل الصفوف (تجاهل المراجع الدائرية sales↔trips مؤقتًا) =====
      const settingsRows = pick('settings')
      if (settingsRows.length > 0) await tx.settings.create({ data: dates(settingsRows[0], ['createdAt', 'updatedAt']) as never })
      restored.settings = Math.min(settingsRows.length, 1)

      const users = userRows
      for (const u of users) {
        // دفاع نهائي داخل المعاملة: لا يُدخل مستخدم بهاش أو ملح مفقود/فارغ — أي إخلال يُرجع المعاملة كاملة
        if (!hasValidAuthMaterial(u)) throw new Error('محاولة إدخال مستخدم ببيانات تحقق غير صالحة — أُلغيت الاستعادة')
        await tx.user.create({ data: dates(u, ['createdAt', 'updatedAt', 'lockedUntil', 'lastLoginAt']) as never })
      }
      restored.users = users.length

      const categories = pick('categories')
      for (const c of categories) await tx.category.create({ data: dates(c, ['createdAt']) as never })
      restored.categories = categories.length

      const products = pick('products')
      for (const p of products) await tx.product.create({ data: dates(p, ['createdAt', 'updatedAt']) as never })
      restored.products = products.length

      const customers = pick('customers')
      for (const c of customers) await tx.customer.create({ data: dates(c, ['createdAt', 'updatedAt']) as never })
      restored.customers = customers.length

      const suppliers = pick('suppliers')
      for (const s of suppliers) await tx.supplier.create({ data: dates(s, ['createdAt', 'updatedAt']) as never })
      restored.suppliers = suppliers.length

      const cLedger = pick('customerLedgerEntries')
      for (const e of cLedger) await tx.customerLedgerEntry.create({ data: dates(e, ['date', 'createdAt']) as never })
      restored.customerLedgerEntries = cLedger.length

      const sLedger = pick('supplierLedgerEntries')
      for (const e of sLedger) await tx.supplierLedgerEntry.create({ data: dates(e, ['date', 'createdAt']) as never })
      restored.supplierLedgerEntries = sLedger.length

      const shifts = pick('shifts')
      for (const s of shifts) await tx.shift.create({ data: dates(s, ['openedAt', 'closedAt']) as never })
      restored.shifts = shifts.length

      // المبيعات: تجاهل tripId مؤقتًا (الجولات تُنشأ لاحقًا)
      const sales = pick('sales')
      for (const s of sales) {
        const { tripId: _omit, ...rest } = s as TableRow & { tripId?: string }
        void _omit
        await tx.sale.create({ data: dates(rest, ['date', 'createdAt', 'voidedAt']) as never })
      }
      restored.sales = sales.length

      const saleItems = pick('saleItems')
      for (const i of saleItems) await tx.saleItem.create({ data: i as never })
      restored.saleItems = saleItems.length

      const salePayments = pick('salePayments')
      for (const p of salePayments) {
        const { tripId: _omit, ...rest } = p as TableRow & { tripId?: string }
        void _omit
        await tx.salePayment.create({ data: dates(rest, ['date']) as never })
      }
      restored.salePayments = salePayments.length

      const purchases = pick('purchases')
      for (const p of purchases) await tx.purchase.create({ data: dates(p, ['date', 'createdAt', 'voidedAt']) as never })
      restored.purchases = purchases.length

      const purchaseItems = pick('purchaseItems')
      for (const i of purchaseItems) await tx.purchaseItem.create({ data: i as never })
      restored.purchaseItems = purchaseItems.length

      const purchasePayments = pick('purchasePayments')
      for (const p of purchasePayments) await tx.purchasePayment.create({ data: dates(p, ['date']) as never })
      restored.purchasePayments = purchasePayments.length

      const movements = pick('stockMovements')
      for (const m of movements) await tx.stockMovement.create({ data: dates(m, ['date', 'createdAt']) as never })
      restored.stockMovements = movements.length

      const recipes = pick('recipes')
      for (const rc of recipes) await tx.recipe.create({ data: dates(rc, ['createdAt', 'updatedAt']) as never })
      restored.recipes = recipes.length

      const recipeItems = pick('recipeItems')
      for (const i of recipeItems) await tx.recipeItem.create({ data: i as never })
      restored.recipeItems = recipeItems.length

      const batches = pick('productionBatches')
      for (const b of batches) await tx.productionBatch.create({ data: dates(b, ['date', 'createdAt', 'voidedAt']) as never })
      restored.productionBatches = batches.length

      const expCats = pick('expenseCategories')
      for (const c of expCats) await tx.expenseCategory.create({ data: c as never })
      restored.expenseCategories = expCats.length

      const expenses = pick('expenses')
      for (const e of expenses) await tx.expense.create({ data: dates(e, ['date', 'createdAt', 'voidedAt']) as never })
      restored.expenses = expenses.length

      const cashMoves = pick('cashMovements')
      for (const m of cashMoves) await tx.cashMovement.create({ data: dates(m, ['date']) as never })
      restored.cashMovements = cashMoves.length

      const reps = pick('distributionReps')
      for (const d of reps) await tx.distributionRep.create({ data: d as never })
      restored.distributionReps = reps.length

      const routes = pick('distributionRoutes')
      for (const d of routes) await tx.distributionRoute.create({ data: d as never })
      restored.distributionRoutes = routes.length

      const trips = pick('distributionTrips')
      for (const d of trips) await tx.distributionTrip.create({ data: dates(d, ['date', 'createdAt', 'settledAt']) as never })
      restored.distributionTrips = trips.length

      const loads = pick('tripLoads')
      for (const d of loads) await tx.tripLoad.create({ data: d as never })
      restored.tripLoads = loads.length

      // مبيعات الجولة: تجاهل saleId مؤقتًا (الفواتير أُنشئت قبل الجولات)
      const tripSales = pick('tripSales')
      for (const d of tripSales) {
        const { saleId: _omit, ...rest } = d as TableRow & { saleId?: string }
        void _omit
        await tx.tripSale.create({ data: dates(rest, ['createdAt']) as never })
      }
      restored.tripSales = tripSales.length

      const returns = pick('tripReturns')
      for (const d of returns) await tx.tripReturn.create({ data: dates(d, ['createdAt']) as never })
      restored.tripReturns = returns.length

      const seqs = pick('sequences')
      for (const s of seqs) await tx.sequence.create({ data: s as never })
      restored.sequences = seqs.length

      const audits = pick('auditLogs')
      for (const a of audits) await tx.auditLog.create({ data: dates(a, ['date', 'createdAt']) as never })
      restored.auditLogs = audits.length

      const backups = pick('backupRecords')
      for (const b of backups) await tx.backupRecord.create({ data: dates(b, ['createdAt']) as never })
      restored.backupRecords = backups.length

      // ===== المرحلة 2: استعادة المراجع الدائرية =====
      for (const s of sales) {
        const row = s as TableRow & { id?: string; tripId?: string }
        if (row.id && row.tripId) await tx.sale.update({ where: { id: row.id }, data: { tripId: row.tripId } })
      }
      for (const p of salePayments) {
        const row = p as TableRow & { id?: string; tripId?: string }
        if (row.id && row.tripId) await tx.salePayment.update({ where: { id: row.id }, data: { tripId: row.tripId } })
      }
      for (const d of tripSales) {
        const row = d as TableRow & { id?: string; saleId?: string }
        if (row.id && row.saleId) await tx.tripSale.update({ where: { id: row.id }, data: { saleId: row.saleId } })
      }
    })

    // الحفاظ على جلسة المستخدم الحالي بعد تفريغ الجلسات
    let sessionNote = 'تم الحفاظ على جلستك الحالية'
    const meStillThere = await db.user.findUnique({ where: { id: r.user.id } })
    const token = req.cookies.get('bakery_session')?.value ?? ''
    if (meStillThere && token) {
      const exists = await db.session.findUnique({ where: { token } })
      if (!exists) {
        try {
          await db.session.create({ data: { token, userId: r.user.id, expiresAt: new Date(Date.now() + 12 * 3600_000) } })
        } catch {
          sessionNote = 'الجلسة الحالية انتهت — سجل الدخول من جديد'
        }
      }
    } else {
      sessionNote = 'الجلسة الحالية انتهت — سجل الدخول من جديد'
    }

    // ملاحظة المصادقة: ماذا حدث لبيانات الدخول أثناء الاستعادة
    const authParts: string[] = []
    if (ownerResetUsername) authParts.push(`أُسندت كلمة مرور جديدة لحساب المالك «${ownerResetUsername}» — استخدمها عند الدخول القادم`)
    if (lockedUsers > 0) authParts.push(`${lockedUsers} مستخدمًا دُخلوا بلا كلمة مرور فعّالة (مقفلون حتى يعيد المدير ضبط كلمتهم من شاشة المستخدمين)`)
    if (authParts.length === 0) authParts.push('كلمات مرور المستخدمين المستعادين تعمل كما كانت')
    const authNote = authParts.join(' — ')
    if (!meStillThere) sessionNote = 'جلستك الحالية لم تعد موجودة في البيانات المستعادة — سجل الدخول من جديد'

    await audit({ userId: r.user.id, username: r.user.username, action: 'RESTORE', entityType: 'Backup', details: { restored, ownerReset: ownerResetUsername !== null, lockedUsers, authReady: readiness.authReady } })

    return ok({ restored, sessionNote, authNote, message: 'تمت الاستعادة بنجاح' })
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handle, ok, requirePerm } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

/**
 * GET /api/backup/export — تصدير نسخة احتياطية كاملة JSON (صلاحية: backup.manage)
 * ممنوع تصدير تجزئات كلمات المرور — تُستبدل بقيم فارغة، والجلسات لا تُصدَّر أبدًا.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'backup.manage')
    if ('response' in r) return r.response

    const [
      settings, users, categories, products, customers, suppliers,
      customerLedger, supplierLedger,
      sales, saleItems, salePayments,
      purchases, purchaseItems, purchasePayments,
      stockMovements,
      recipes, recipeItems, productionBatches,
      expenseCategories, expenses,
      shifts, cashMovements,
      distributionReps, distributionRoutes, distributionTrips, tripLoads, tripSales, tripReturns,
      auditLog, sequences, backupRecords,
    ] = await Promise.all([
      db.settings.findMany({ orderBy: { id: 'asc' } }),
      db.user.findMany({ orderBy: { createdAt: 'asc' } }),
      db.category.findMany({ orderBy: { createdAt: 'asc' } }),
      db.product.findMany({ orderBy: { createdAt: 'asc' } }),
      db.customer.findMany({ orderBy: { createdAt: 'asc' } }),
      db.supplier.findMany({ orderBy: { createdAt: 'asc' } }),
      db.customerLedgerEntry.findMany({ orderBy: { createdAt: 'asc' } }),
      db.supplierLedgerEntry.findMany({ orderBy: { createdAt: 'asc' } }),
      db.sale.findMany({ orderBy: { date: 'asc' } }),
      db.saleItem.findMany({ orderBy: { id: 'asc' } }),
      db.salePayment.findMany({ orderBy: { date: 'asc' } }),
      db.purchase.findMany({ orderBy: { date: 'asc' } }),
      db.purchaseItem.findMany({ orderBy: { id: 'asc' } }),
      db.purchasePayment.findMany({ orderBy: { date: 'asc' } }),
      db.stockMovement.findMany({ orderBy: { date: 'asc' } }),
      db.recipe.findMany({ orderBy: { createdAt: 'asc' } }),
      db.recipeItem.findMany({ orderBy: { id: 'asc' } }),
      db.productionBatch.findMany({ orderBy: { date: 'asc' } }),
      db.expenseCategory.findMany({ orderBy: { name: 'asc' } }),
      db.expense.findMany({ orderBy: { date: 'asc' } }),
      db.shift.findMany({ orderBy: { openedAt: 'asc' } }),
      db.cashMovement.findMany({ orderBy: { date: 'asc' } }),
      db.distributionRep.findMany({ orderBy: { name: 'asc' } }),
      db.distributionRoute.findMany({ orderBy: { name: 'asc' } }),
      db.distributionTrip.findMany({ orderBy: { date: 'asc' } }),
      db.tripLoad.findMany({ orderBy: { id: 'asc' } }),
      db.tripSale.findMany({ orderBy: { createdAt: 'asc' } }),
      db.tripReturn.findMany({ orderBy: { createdAt: 'asc' } }),
      db.auditLog.findMany({ orderBy: { date: 'asc' } }),
      db.sequence.findMany({ orderBy: { id: 'asc' } }),
      db.backupRecord.findMany({ orderBy: { createdAt: 'asc' } }),
    ])

    // تعقيم المستخدمين: بلا تجزئات كلمات مرور أو PIN
    const safeUsers = users.map(u => ({
      id: u.id, username: u.username, displayName: u.displayName, role: u.role,
      passwordHash: '', passwordSalt: '', pinHash: null, pinSalt: null,
      active: u.active, failedAttempts: 0, lockedUntil: null, lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt, updatedAt: u.updatedAt,
    }))

    const exportedAt = new Date()
    const payload = {
      schemaVersion: '1.0.0',
      exportedAt,
      tables: {
        settings, users: safeUsers, categories, products, customers, suppliers,
        customer_ledger: customerLedger, supplier_ledger: supplierLedger,
        sales, sale_items: saleItems, sale_payments: salePayments,
        purchases, purchase_items: purchaseItems, purchase_payments: purchasePayments,
        stock_movements: stockMovements,
        recipes, recipe_items: recipeItems, production_batches: productionBatches,
        expense_categories: expenseCategories, expenses,
        shifts, cash_movements: cashMovements,
        distribution_reps: distributionReps, distribution_routes: distributionRoutes,
        distribution_trips: distributionTrips, trip_loads: tripLoads, trip_sales: tripSales, trip_returns: tripReturns,
        audit_log: auditLog, sequences, backup_records: backupRecords,
      },
    }

    const json = JSON.stringify(payload, null, 2)
    const sizeBytes = Buffer.byteLength(json, 'utf8')
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${exportedAt.getFullYear()}${pad(exportedAt.getMonth() + 1)}${pad(exportedAt.getDate())}-${pad(exportedAt.getHours())}${pad(exportedAt.getMinutes())}${pad(exportedAt.getSeconds())}`
    const fileName = `bakery-backup-${stamp}.json`

    await db.backupRecord.create({
      data: { fileName, sizeBytes, schemaVersion: '1.0.0', kind: 'MANUAL', note: 'تصدير يدوي' },
    })
    const totalRecords = Object.values(payload.tables).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0)
    await audit({ userId: r.user.id, username: r.user.username, action: 'BACKUP', entityType: 'Backup', details: { fileName, sizeBytes, totalRecords } })

    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  })
}

// ok مستخدمة لتعريف موحد — تُترك للتوافق
void ok

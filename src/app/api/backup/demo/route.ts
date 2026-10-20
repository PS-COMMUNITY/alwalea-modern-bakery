import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, handle, ok, requirePerm } from '@/lib/bakery/auth'
import { audit, getSettings, nextNumber } from '@/lib/bakery/core'
import { hashPassword } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

/** بيانات تجريبية اصطناعية واضحة العلامة — لا تعمل إذا وُجدت بيانات فعلية */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePerm(req, 'settings.manage')
    if ('response' in r) return r.response

    const [salesCount, purchasesCount, productsCount] = await Promise.all([
      db.sale.count(), db.purchase.count(), db.product.count(),
    ])
    if (salesCount > 0 || purchasesCount > 0) return fail(409, 'توجد عمليات فعلية في قاعدة البيانات — لا يمكن تحميل بيانات تجريبية فوقها')
    if (productsCount > 0) return fail(409, 'توجد منتجات مسجلة بالفعل — امسح البيانات أولًا أو ابدأ بقاعدة جديدة')

    const s = await getSettings()

    await db.$transaction(async tx => {
      // تصنيفات
      const catBread = await tx.category.create({ data: { name: 'خبز (تجريبي)' } })
      const catSweet = await tx.category.create({ data: { name: 'معجنات وحلويات (تجريبي)' } })
      const catRaw = await tx.category.create({ data: { name: 'مواد خام (تجريبي)' } })

      // مواد خام
      const flour = await tx.product.create({
        data: { code: 'RAW-001', name: 'دقيق فاخر (تجريبي)', categoryId: catRaw.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 250, minStockMilli: 10000 },
      })
      const salt = await tx.product.create({
        data: { code: 'RAW-002', name: 'ملح طعام (تجريبي)', categoryId: catRaw.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 100, minStockMilli: 2000 },
      })
      const yeast = await tx.product.create({
        data: { code: 'RAW-003', name: 'خميرة فورية (تجريبي)', categoryId: catRaw.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 900, minStockMilli: 1000 },
      })

      // منتجات جاهزة
      const bread = await tx.product.create({
        data: { code: 'PRD-001', name: 'خبز عادي (تجريبي)', categoryId: catBread.id, type: 'FINISHED', baseUnit: 'كغ', priceMinor: 300, wholesalePriceMinor: 250, costMinor: 200, minStockMilli: 5000 },
      })
      const breadDark = await tx.product.create({
        data: { code: 'PRD-002', name: 'خبز أسمر (تجريبي)', categoryId: catBread.id, type: 'FINISHED', baseUnit: 'كغ', priceMinor: 400, costMinor: 250, minStockMilli: 3000 },
      })
      const cake = await tx.product.create({
        data: { code: 'PRD-003', name: 'كعك سمسم (تجريبي)', categoryId: catSweet.id, type: 'FINISHED', baseUnit: 'قطعة', priceMinor: 500, costMinor: 300, minStockMilli: 2000 },
      })

      // أرصدة افتتاحية للمواد
      const opening = [
        { productId: flour.id, qtyMilli: 200000, cost: 250 },
        { productId: salt.id, qtyMilli: 30000, cost: 100 },
        { productId: yeast.id, qtyMilli: 10000, cost: 900 },
      ]
      for (const o of opening) {
        await tx.stockMovement.create({ data: { productId: o.productId, qtyMilli: o.qtyMilli, type: 'OPENING', note: 'رصيد افتتاحي تجريبي', unitCostMinor: o.cost, userId: r.user.id } })
      }

      // عملاء ومورد تجريبيان
      const cust1 = await tx.customer.create({ data: { name: 'بقالة الأمل (تجريبي)', phone: '0599000111', creditLimitMinor: 50000 } })
      const cust2 = await tx.customer.create({ data: { name: 'سوبرماركت الهدى (تجريبي)', phone: '0599000222', defaultPriceType: 'WHOLESALE' } })
      const sup1 = await tx.supplier.create({ data: { name: 'مطاحن الجنوب (تجريبي)', phone: '0599000333' } })

      // وصفة خبز
      const recipe = await tx.recipe.create({
        data: { name: 'وصفة خبز عادي (تجريبي)', outputProductId: bread.id, outputQtyMilli: 20000, notes: 'تجريبية' },
      })
      await tx.recipeItem.createMany({
        data: [
          { recipeId: recipe.id, productId: flour.id, qtyMilli: 13000 },
          { recipeId: recipe.id, productId: salt.id, qtyMilli: 200 },
          { recipeId: recipe.id, productId: yeast.id, qtyMilli: 200 },
        ],
      })

      // دفعة إنتاج: 20 كغ خبز → استهلاك 13 كغ دقيق + 0.2 ملح + 0.2 خميرة
      const matCost = Math.round((13000 * 250) / 1000) + Math.round((200 * 100) / 1000) + Math.round((200 * 900) / 1000)
      await tx.stockMovement.createMany({
        data: [
          { productId: flour.id, qtyMilli: -13000, type: 'PRODUCTION_OUT', note: 'إنتاج تجريبي', unitCostMinor: 250, userId: r.user.id },
          { productId: salt.id, qtyMilli: -200, type: 'PRODUCTION_OUT', note: 'إنتاج تجريبي', unitCostMinor: 100, userId: r.user.id },
          { productId: yeast.id, qtyMilli: -200, type: 'PRODUCTION_OUT', note: 'إنتاج تجريبي', unitCostMinor: 900, userId: r.user.id },
        ],
      })
      const unitCost = Math.round((matCost * 1000) / 20000)
      await tx.stockMovement.create({ data: { productId: bread.id, qtyMilli: 20000, type: 'PRODUCTION_IN', note: 'إنتاج تجريبي', unitCostMinor: unitCost, userId: r.user.id } })
      const batchNo = await nextNumber('PRD')
      await tx.productionBatch.create({
        data: { batchNo, recipeId: recipe.id, plannedQtyMilli: 20000, actualQtyMilli: 20000, wasteQtyMilli: 0, materialsCostMinor: matCost, unitCostMinor: unitCost, userId: r.user.id, notes: 'دفعة تجريبية' },
      })
      await tx.product.update({ where: { id: bread.id }, data: { costMinor: unitCost } })

      // فاتورة شراء دقيق (آجلة جزئيًا)
      const purTotal = 100000 // 100 كغ × 250
      const pNo = await nextNumber('P')
      const purchase = await tx.purchase.create({
        data: { invoiceNo: pNo, supplierId: sup1.id, supplierName: sup1.name, subtotalMinor: purTotal, totalMinor: purTotal, paidMinor: 40000, paymentStatus: 'PARTIAL', userId: r.user.id, note: 'تجريبي' },
      })
      await tx.purchaseItem.create({ data: { purchaseId: purchase.id, productId: flour.id, productName: flour.name, qtyMilli: 100000, costMinor: 250, lineTotalMinor: purTotal } })
      await tx.stockMovement.create({ data: { productId: flour.id, qtyMilli: 100000, type: 'PURCHASE', refType: 'Purchase', refId: purchase.id, unitCostMinor: 250, userId: r.user.id } })
      await tx.supplierLedgerEntry.create({ data: { supplierId: sup1.id, type: 'INVOICE', amountMinor: purTotal, refType: 'Purchase', refId: purchase.id, userId: r.user.id } })
      await tx.purchasePayment.create({ data: { purchaseId: purchase.id, supplierId: sup1.id, method: 'CASH', amountMinor: 40000, userId: r.user.id } })
      await tx.supplierLedgerEntry.create({ data: { supplierId: sup1.id, type: 'PAYMENT', amountMinor: -40000, refType: 'PurchasePayment', refId: purchase.id, userId: r.user.id } })
      // متوسط مرجح للدقيق: (200×250 + 100×250)/300 = 250
      await tx.product.update({ where: { id: flour.id }, data: { costMinor: 250 } })

      // بيع نقدي
      const sNo1 = await nextNumber('S')
      const sale1 = await tx.sale.create({
        data: { invoiceNo: sNo1, customerName: 'عميل نقدي', subtotalMinor: 6000, totalMinor: 6000, paidMinor: 6000, creditMinor: 0, paymentStatus: 'PAID', source: 'POS', userId: r.user.id, note: 'تجريبي' },
      })
      await tx.saleItem.create({ data: { saleId: sale1.id, productId: bread.id, productName: bread.name, qtyMilli: 20000, priceMinor: 300, costMinor: unitCost, lineTotalMinor: 6000 } })
      await tx.stockMovement.create({ data: { productId: bread.id, qtyMilli: -20000, type: 'SALE', refType: 'Sale', refId: sale1.id, unitCostMinor: unitCost, userId: r.user.id } })
      await tx.salePayment.create({ data: { saleId: sale1.id, method: 'CASH', amountMinor: 6000, userId: r.user.id } })

      // بيع آجل للعميل الأول
      const sNo2 = await nextNumber('S')
      const sale2 = await tx.sale.create({
        data: { invoiceNo: sNo2, customerId: cust1.id, customerName: cust1.name, subtotalMinor: 5000, discountMinor: 0, totalMinor: 5000, paidMinor: 2000, creditMinor: 3000, paymentStatus: 'PARTIAL', source: 'POS', userId: r.user.id, note: 'تجريبي' },
      })
      await tx.saleItem.create({ data: { saleId: sale2.id, productId: cake.id, productName: cake.name, qtyMilli: 10000, priceMinor: 500, costMinor: 300, lineTotalMinor: 5000 } })
      await tx.stockMovement.create({ data: { productId: cake.id, qtyMilli: -10000, type: 'SALE', refType: 'Sale', refId: sale2.id, unitCostMinor: 300, userId: r.user.id } })
      await tx.customerLedgerEntry.create({ data: { customerId: cust1.id, type: 'INVOICE', amountMinor: 3000, refType: 'Sale', refId: sale2.id, userId: r.user.id } })
      await tx.salePayment.create({ data: { saleId: sale2.id, method: 'CASH', amountMinor: 2000, userId: r.user.id } })
      await tx.stockMovement.create({ data: { productId: cake.id, qtyMilli: 10000, type: 'OPENING', note: 'رصيد افتتاحي تجريبي', unitCostMinor: 300, userId: r.user.id } })
      await tx.stockMovement.create({ data: { productId: breadDark.id, qtyMilli: 8000, type: 'OPENING', note: 'رصيد افتتاحي تجريبي', unitCostMinor: 250, userId: r.user.id } })

      // مصروف
      const cat1 = await tx.expenseCategory.create({ data: { name: 'وقود وسفر (تجريبي)' } })
      await tx.expense.create({ data: { categoryId: cat1.id, amountMinor: 2500, method: 'CASH', beneficiary: 'محطة الوقود', note: 'تجريبي', userId: r.user.id } })
    })

    await db.settings.update({ where: { id: 1 }, data: { demoDataLoaded: true } })
    await audit({ userId: r.user.id, username: r.user.username, action: 'IMPORT', entityType: 'DemoData', details: { note: 'تحميل بيانات تجريبية اصطناعية' } })

    return ok({ demoLoaded: true, message: 'تم تحميل البيانات التجريبية بنجاح — كل السجلات موسومة بـ (تجريبي)' })
  })
}

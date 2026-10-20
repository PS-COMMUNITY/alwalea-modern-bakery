// =============================================================
// QA Seed — تهيئة قاعدة معزولة ببيانات اصطناعية عبر المسارات الحقيقية
// DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/seed.ts
// =============================================================
import { call, captureSession, state } from './harness'
import { db } from '@/lib/db'

async function main() {
  // تنظيف كامل (قاعدة الاختبار فقط)
  const tables = ['cashMovement', 'shift', 'tripReturn', 'tripSale', 'tripLoad', 'distributionTrip', 'distributionRoute', 'distributionRep',
    'expense', 'expenseCategory', 'productionBatch', 'recipeItem', 'recipe', 'stockMovement', 'purchasePayment', 'purchaseItem', 'purchase',
    'salePayment', 'saleItem', 'sale', 'customerLedgerEntry', 'supplierLedgerEntry', 'customer', 'supplier', 'product', 'category',
    'auditLog', 'backupRecord', 'session', 'user', 'sequence', 'settings']
  for (const t of tables) await (db as any)[t].deleteMany({})
  console.log('✓ قاعدة الاختبار نظيفة (معزولة في /tmp)')

  // 1) التهيئة عبر POST /api/setup
  const setup = await call('POST', '/api/setup', { body: { businessName: 'مخبز QA', ownerName: 'مالك الاختبار', password: '1234' } })
  console.log('setup:', setup.status)
  if (setup.status !== 200) { console.error(setup.json); process.exit(1) }
  captureSession(setup)

  // 2) تصنيفات
  const cats: Record<string, string> = {}
  for (const n of ['خبز', 'حلويات', 'مواد خام', 'مشروبات']) {
    const r = await call('POST', '/api/categories', { body: { name: n } })
    if (r.status !== 200) { console.error('category', n, r.status, r.json); process.exit(1) }
    cats[n] = r.json.id
  }

  // 3) منتجات — خام ونهائي وتجاري
  const p: Record<string, string> = {}
  const mk = async (name: string, body: Record<string, unknown>) => {
    const r = await call('POST', '/api/products', { body })
    if (r.status !== 200) { console.error('product', name, r.status, r.json); process.exit(1) }
    p[name] = r.json.id
  }
  await mk('دقيق', { name: 'دقيق', categoryId: cats['مواد خام'], type: 'RAW', baseUnit: 'كغ', priceMinor: 300, costMinor: 250 })
  await mk('سكر', { name: 'سكر', categoryId: cats['مواد خام'], type: 'RAW', baseUnit: 'كغ', priceMinor: 400, costMinor: 300 })
  await mk('خميرة', { name: 'خميرة', categoryId: cats['مواد خام'], type: 'RAW', baseUnit: 'كغ', priceMinor: 800, costMinor: 600 })
  await mk('خبز عادي', { name: 'خبز عادي', categoryId: cats['خبز'], type: 'FINISHED', baseUnit: 'كغ', priceMinor: 1000, wholesalePriceMinor: 900, costMinor: 600, minStockMilli: 5000 })
  await mk('خبز أسود', { name: 'خبز أسود', categoryId: cats['خبز'], type: 'FINISHED', baseUnit: 'كغ', priceMinor: 1400, costMinor: 800, minStockMilli: 3000 })
  await mk('كيك', { name: 'كيك', categoryId: cats['حلويات'], type: 'FINISHED', baseUnit: 'قطعة', priceMinor: 3000, costMinor: 1500 })
  await mk('شاي', { name: 'شاي', categoryId: cats['مشروبات'], type: 'TRADE', baseUnit: 'عبوة', priceMinor: 500, costMinor: 120 })
  await mk('خبز قديم', { name: 'خبز قديم', categoryId: cats['خبز'], type: 'FINISHED', baseUnit: 'كغ', priceMinor: 1000, active: false })

  // 4) عملاء وموردون
  const c: Record<string, string> = {}
  const mkC = async (name: string, body: Record<string, unknown>) => {
    const r = await call('POST', '/api/customers', { body })
    if (r.status !== 200) { console.error('customer', name, r.status, r.json); process.exit(1) }
    c[name] = r.json.id
  }
  await mkC('عميل نقدي نموذجي', { name: 'عميل نقدي نموذجي' })
  await mkC('متجر الأمل', { name: 'متجر الأمل', creditLimitMinor: 20000, defaultPriceType: 'RETAIL' })
  await mkC('مطعم الضيافة', { name: 'مطعم الضيافة', defaultPriceType: 'WHOLESALE' })

  const s: Record<string, string> = {}
  for (const n of ['مطحنة الشمال', 'شركة السكر']) {
    const r = await call('POST', '/api/suppliers', { body: { name: n } })
    if (r.status !== 200) { console.error('supplier', n, r.status, r.json); process.exit(1) }
    s[n] = r.json.id
  }

  // 5) رصيد افتتاني للمواد والتجاري
  const open = await call('POST', '/api/inventory/opening', { body: { items: [
    { productId: p['دقيق'], qtyMilli: 100000, unitCostMinor: 250 },
    { productId: p['سكر'], qtyMilli: 40000, unitCostMinor: 300 },
    { productId: p['خميرة'], qtyMilli: 10000, unitCostMinor: 600 },
    { productId: p['شاي'], qtyMilli: 20000, unitCostMinor: 120 },
    { productId: p['كيك'], qtyMilli: 5000, unitCostMinor: 1500 },
  ] } })
  console.log('opening:', open.status)
  if (open.status !== 200) { console.error(open.json); process.exit(1) }

  // 6) وصفة إنتاج خبز عادي
  const rec = await call('POST', '/api/recipes', { body: { name: 'وصفة خبز عادي', outputProductId: p['خبز عادي'], outputQtyMilli: 20000,
    items: [ { productId: p['دقيق'], qtyMilli: 15000 }, { productId: p['سكر'], qtyMilli: 2000 }, { productId: p['خميرة'], qtyMilli: 500 } ] } })
  console.log('recipe:', rec.status)
  if (rec.status !== 200) { console.error(rec.json); process.exit(1) }

  // 7) وردية مفتوحة + فاتورة شراء دقيق
  const sh = await call('POST', '/api/shifts/open', { body: { openingCashMinor: 10000 } })
  console.log('shift open:', sh.status)
  if (sh.status !== 200) { console.error(sh.json); process.exit(1) }
  const shiftId = sh.json.id
  const buy = await call('POST', '/api/purchases', { body: {
    supplierId: s['مطحنة الشمال'],
    items: [ { productId: p['دقيق'], qtyMilli: 50000, costMinor: 240 } ],
    payments: [ { amountMinor: 5000, method: 'CASH' } ],
  } })
  console.log('purchase:', buy.status)
  if (buy.status !== 200) { console.error(buy.json); process.exit(1) }

  const me = await call('GET', '/api/auth/me')
  const owner = me.json.user

  // حفظ المعرفات للاختبارات اللاحقة
  const ids = { cats, p, c, s, shiftId, recipeId: rec.json.id, purchaseId: buy.json.id, ownerId: owner.id }
  await Bun.write('/tmp/qa-bakery/ids.json', JSON.stringify(ids, null, 2))
  console.log('✓ اكتملت التهيئة — المعرفات في /tmp/qa-bakery/ids.json — session', state.token.slice(0, 8) + '…')
  process.exit(0)
}
main().catch(e => { console.error('SEED FAIL', e); process.exit(1) })

// =============================================================
// QA الأداء — بذر حجم واقعي + قياس زمن واجهات API (p50/p95)
// DATABASE_URL=file:/tmp/qa-bakery/qa.db bun scripts/qa/perf.ts
// =============================================================
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { call, captureSession } from './harness'



const PRODUCT_COUNT = Number(process.env.PERF_PRODUCTS ?? 2000)

async function seedVolume() {
  const existing = await db.product.count()
  if (existing >= PRODUCT_COUNT) {
    console.log(`الحجم موجود مسبقًا: ${existing} منتجًا`)
    return
  }
  console.log(`بذر حجم واقعي: ${PRODUCT_COUNT - existing} منتجًا إضافيًا…`)
  const cat = await db.category.findFirst({ where: { name: 'خبز' } })
  const cats = await db.category.findMany()
  const catIds = cats.map(c => c.id)
  const batch = []
  for (let i = existing; i < PRODUCT_COUNT; i++) {
    batch.push({
      code: `BULK-${String(i).padStart(5, '0')}`,
      barcode: `BC${String(i).padStart(8, '0')}`,
      name: `منتج بالجملة ${i}`,
      categoryId: catIds[i % catIds.length] ?? cat?.id,
      type: i % 7 === 0 ? 'RAW' : i % 3 === 0 ? 'TRADE' : 'FINISHED',
      baseUnit: i % 2 ? 'كغ' : 'قطعة',
      priceMinor: 500 + (i % 9000),
      costMinor: 300 + (i % 4000),
      minStockMilli: (i % 5) * 1000,
    })
  }
  // إدخال على دفعات
  for (let i = 0; i < batch.length; i += 200) {
    await db.product.createMany({ data: batch.slice(i, i + 200) })
  }
  const customers = await db.customer.count()
  const cBatch = []
  for (let i = customers; i < 300; i++) {
    cBatch.push({ name: `عميل بالجملة ${i}`, phone: `05${String(10000000 + i).slice(0, 8)}` })
  }
  if (cBatch.length) await db.customer.createMany({ data: cBatch })
  console.log('✓ البذر انتهى')
}

function stats(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b)
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return { p50: p(0.5), p95: p(0.95), max: sorted[sorted.length - 1] }
}

async function timeRoute(label: string, n: number, fn: () => Promise<unknown>) {
  // إحماء
  await fn()
  const times: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    await fn()
    times.push(performance.now() - t0)
  }
  const s = stats(times)
  console.log(`${label}: p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms max=${s.max.toFixed(1)}ms`)
  return s
}

async function main() {
  await seedVolume()
  const l = await call('POST', '/api/auth/login', { body: { password: '1234' } })
  captureSession(l)

  const N = 20
  console.log(`\n===== قياس واجهات API (${N} استدعاء لكل منها) =====`)
  await timeRoute('قائمة المنتجات كاملة (2000)', N, () => call('GET', '/api/products'))
  await timeRoute('بحث المنتجات q=بالجملة 12', N, () => call('GET', '/api/products', { query: { q: 'بالجملة 12' } }))
  await timeRoute('قائمة المخزون (2000)', N, () => call('GET', '/api/inventory'))
  await timeRoute('قائمة العملاء (300)', N, () => call('GET', '/api/customers'))
  await timeRoute('لوحة التحكم', N, () => call('GET', '/api/reports/dashboard'))
  await timeRoute('تقرير المبيعات', N, () => call('GET', '/api/reports/sales'))
  await timeRoute('قائمة الفواتير صفحة', N, () => call('GET', '/api/sales', { query: { page: '1', pageSize: '20' } }))
  await timeRoute('سجل التدقيق صفحة', N, () => call('GET', '/api/audit', { query: { page: '1', pageSize: '50' } }))
  // حفظ فاتورة (كتابة حقيقية)
  const ids = await Bun.file('/tmp/qa-bakery/ids.json').json()
  const tea = await db.product.findUnique({ where: { id: ids.p['شاي'] } })
  if (tea) {
    const stock = await db.stockMovement.aggregate({ where: { productId: tea.id }, _sum: { qtyMilli: true } })
    if ((stock._sum.qtyMilli ?? 0) > 50000) {
      await timeRoute('حفظ فاتورة بيع (كتابة)', 10, () => call('POST', '/api/sales', { body: { items: [{ productId: tea.id, qtyMilli: 100 }], payments: [{ amountMinor: 50 + 9, method: 'CASH' }] } }))
    } else {
      console.log('حفظ فاتورة بيع: تخطي (الرصيد غير كافٍ للقياس المتكرر)')
    }
  }
  console.log('\nالأهداف: البحث p95 < 200ms — بقية الشاشات تُقارن بخط الأساس الموثق في التقرير.')
  process.exit(0)
}
main().catch(e => { console.error('PERF FAIL', e); process.exit(1) })

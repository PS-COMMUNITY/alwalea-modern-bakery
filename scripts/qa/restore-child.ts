// =============================================================
// restore-child — يعمل في عملية فرعية على قاعدة مستهدفة معزولة:
// ي_preview_ النسخة، يرفض غير الجاهزة، يستعيد بكلمة مالك جديدة، ويتحقق من العدادات
// DATABASE_URL=file:/tmp/qa-bakery/restore-target.db bun scripts/qa/restore-child.ts
// =============================================================
import { NextRequest } from 'next/server'
import { POST as setupPOST } from '@/app/api/setup/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { POST as previewPOST } from '@/app/api/backup/preview/route'
import { POST as restorePOST } from '@/app/api/backup/restore/route'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

function fail(msg: string): never {
  console.error('CHILD FAIL: ' + msg)
  process.exit(1)
}

/** استخراج كوكي الجلسة من استجابة */
function tokenOf(res: Response): string {
  const sc = res.headers.get('set-cookie') ?? ''
  const m = sc.match(/bakery_session=([^;]+)/)
  if (!m) fail('لا كوكي جلسة')
  return m[1]
}

async function main() {
  const data = await Bun.file('/tmp/qa-bakery/export.json').text()
  const snapshot = await Bun.file('/tmp/qa-bakery/snapshot.json').json()

  // 0) مسار المستخدم الحقيقي: تثبيت جديد → تهيئة → دخول → استعادة
  const su = await setupPOST(new NextRequest('http://localhost/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName: 'قاعدة الاستعادة', ownerName: 'مالك الاستعادة', password: '1234' }) }))
  if (su.status !== 200) fail('التهيئة في القاعدة المستهدفة فشلت: ' + JSON.stringify(await su.json()))
  const t0 = tokenOf(su)
  const H = { 'content-type': 'application/json', cookie: `bakery_session=${t0}` }

  // 1) معاينة
  const pv = await previewPOST(new NextRequest('http://localhost/api/backup/preview', { method: 'POST', headers: H, body: JSON.stringify({ data }) }))
  const pvj = await pv.json()
  if (pv.status !== 200) fail('المعاينة: ' + JSON.stringify(pvj))
  if (pvj.auth.needsOwnerPassword !== true) fail('المعاينة يجب أن تشترط كلمة مالك')

  // 2) رفض الاستعادة بلا كلمة (قبل أي تغيير)
  const noPw = await restorePOST(new NextRequest('http://localhost/api/backup/restore', { method: 'POST', headers: H, body: JSON.stringify({ data, confirm: true }) }))
  if (noPw.status !== 422) fail(`رفض غير الجاهزة يجب أن يكون 422 والفعلي ${noPw.status}`)
  const countsBeforeReject = await db.sale.count()
  if (countsBeforeReject !== 0) fail('قاعدة مستهدفة يجب أن تكون فارغة قبل الاستعادة')

  // 3) استعادة بكلمة مالك جديدة
  const rs = await restorePOST(new NextRequest('http://localhost/api/backup/restore', { method: 'POST', headers: H, body: JSON.stringify({ data, confirm: true, newOwnerPassword: '9999' }) }))
  if (rs.status !== 200) fail('الاستعادة فشلت: ' + JSON.stringify(await rs.json()))

  // 4) مطابقة العدادات والأرصدة مع الأصل
  const checks: [string, number, number][] = [
    ['sales', await db.sale.count(), snapshot.sales],
    ['saleItems', await db.saleItem.count(), snapshot.saleItems],
    ['purchases', await db.purchase.count(), snapshot.purchases],
    ['stockMovements', await db.stockMovement.count(), snapshot.stockMovements],
    ['ledger', await db.customerLedgerEntry.count(), snapshot.ledger],
    ['products', await db.product.count(), snapshot.products],
    ['users', await db.user.count(), snapshot.users],
  ]
  for (const [name, got, want] of checks) {
    if (got !== want) fail(`${name}: المتوقع ${want} والفعلي ${got}`)
  }
  // رصيد العميل
  const amal = await db.customer.findFirst({ where: { name: 'متجر الأمل' } })
  if (!amal) fail('عميل مفقود بعد الاستعادة')
  const debt = await db.customerLedgerEntry.aggregate({ where: { customerId: amal!.id }, _sum: { amountMinor: true } })
  if ((debt._sum.amountMinor ?? 0) !== snapshot.debtAmal) fail(`دين العميل: المتوقع ${snapshot.debtAmal} والفعلي ${debt._sum.amountMinor}`)
  // رصيد الدقيق
  const flour = await db.product.findFirst({ where: { name: 'دقيق' } })
  const flourStock = await db.stockMovement.aggregate({ where: { productId: flour!.id }, _sum: { qtyMilli: true } })
  if ((flourStock._sum.qtyMilli ?? 0) !== snapshot.flourStock) fail(`رصيد الدقيق: المتوقع ${snapshot.flourStock} والفعلي ${flourStock._sum.qtyMilli}`)

  // 5) الدخول بالكلمة الجديدة (عبر آلية المصادقة القائمة) وفشل القديمة
  const oldLogin = await loginPOST(new NextRequest('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '1234' }) }))
  if (oldLogin.status !== 401) fail('كلمة 1234 القديمة يجب أن تُرفض بعد الاستعادة')
  const newLogin = await loginPOST(new NextRequest('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '9999' }) }))
  if (newLogin.status !== 200) fail('الدخول بالكلمة الجديدة فشل: ' + JSON.stringify(await newLogin.json()))

  // 6) التحقق من صحة هاشت المالك الجديد (scrypt + ملح مستقل، بلا نص مكشوف)
  const owner = await db.user.findFirst({ where: { role: 'OWNER' } })
  if (!owner || owner.passwordHash.length !== 128 || owner.passwordSalt.length !== 32) fail('معاملات تحقق المالك غير سليمة')

  console.log(`CHILD OK: استعادة كاملة متطابقة (${checks.length} عدادًا) + دخول بالكلمة الجديدة`)
  await db.$disconnect()
  process.exit(0)
}
main().catch(e => fail(String(e)))

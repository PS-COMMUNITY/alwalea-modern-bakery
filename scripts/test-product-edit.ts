// =============================================================
// اختبار انحدار rc.12 — بلاغ المالك: «خطأ غير متوقع» عند تعديل سعر منتج
// الجذر: updateProduct كان يختار category_name من جدول products (عمود مشتق
// عبر JOIN فقط) -> كل تعديل يرمي no such column. هذا السكربت يحاكي تدفق
// المالك بالضبط: إنشاء منتج بسعر -> فتحه وتعديل السعر -> حفظ.
// التشغيل: bun scripts/test-product-edit.ts
// =============================================================
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { BakeryDb } from '../src/main/db'
import { dispatch } from '../src/main/registry'

const TEST_DIR = `/tmp/bakery-product-edit-${Date.now()}`
const DB_PATH = `${TEST_DIR}/data/bakery.db`
const WASM = 'node_modules/sql.js/dist/sql-wasm.wasm'

let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log(`PASS | ${name}${extra ? ' | ' + extra : ''}`)
  } else {
    fail++
    failures.push(`${name}${extra ? ' :: ' + extra : ''}`)
    console.log(`FAIL | ${name}${extra ? ' | ' + extra : ''}`)
  }
}

type Env = { ok: boolean; data?: unknown; error?: string; code?: number }
async function invoke(db: BakeryDb, channel: string, payload: Record<string, unknown> = {}): Promise<Env> {
  const r = await dispatch(db, channel, payload)
  if (r.ok) return { ok: true, data: r.data }
  return { ok: false, error: r.error, code: r.code }
}

async function openDb(filePath: string): Promise<BakeryDb> {
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new BakeryDb({ filePath, wasmCandidates: [WASM] })
  await db.init()
  db.setPersistFn(() => db.persist())
  return db
}

async function main(): Promise<void> {
  const db = await openDb(DB_PATH)

  const setup = await invoke(db, 'setup.run', { businessName: 'مخبز الولاء الحديث', ownerName: 'قصي', password: '1234' })
  check('تهيئة المخبز', setup.ok === true, setup.error ?? '')
  const login = (await invoke(db, 'auth.login', { password: '1234' })) as Env & { data?: { token: string } }
  const token = login.data?.token ?? ''
  check('جلسة المالك', token.length >= 16)

  const cat = (await invoke(db, 'categories.create', { token, name: 'خبوزات خاصة' })) as Env & { data?: { id: number } }
  const catId = (cat.data?.id ?? 0) as number
  check('فئة أُنشئت', cat.ok === true && catId >= 1, cat.error ?? '')

  // 1) المالك يضيف منتجًا ويحدد سعره (نفس فيديو البلاغ)
  const created = (await invoke(db, 'products.create', {
    token, name: 'خبز عربي', sku: 'ARB-001', categoryId: catId, type: 'FINISHED',
    baseUnit: 'كيس', priceMinor: 500, costMinor: 200, minStockMilli: 5000, trackStock: true, active: true
  })) as Env & { data?: { id: number } }
  check('المنتج أُنشئ بسعر 500 أغورة', created.ok === true && created.data?.id === 1, created.error ?? '')
  const pid = created.data?.id as number

  // 2) بلاغ المالك: فتح المنتج وتعديل السعر فقط
  const priceEdit = await invoke(db, 'products.update', { token, id: pid, priceMinor: 750 })
  check('تعديل السعر فقط نجح بلا «خطأ غير متوقع»', priceEdit.ok === true, priceEdit.error ?? '')

  // 3) النتيجة: السعر تغير والبقية حُفظت
  const after = (await invoke(db, 'products.get', { token, id: pid })) as Env & { data?: Record<string, unknown> }
  const d = after.data ?? {}
  check('السعر الجديد 750 مُطبق', d.price_minor === 750, `actual=${String(d.price_minor)}`)
  check('الفئة حُفظت (لم تُمس بالتعديل الجزئي)', d.category_id === catId, `actual=${String(d.category_id)}`)
  check('اسم الفئة ظاهر عبر JOIN', d.category_name === 'خبوزات خاصة', `actual=${String(d.category_name)}`)
  check('SKU حُفظ', d.sku === 'ARB-001', `actual=${String(d.sku)}`)
  check('الاسم حُفظ', d.name === 'خبز عربي')
  check('تتبع المخزون حُفظ', d.track_stock === 1)

  // 4) تعديل جزئي ثانٍ (الاسم فقط)
  const nameEdit = await invoke(db, 'products.update', { token, id: pid, name: 'خبز عربي فاخر' })
  check('تعديل الاسم فقط نجح', nameEdit.ok === true, nameEdit.error ?? '')
  const after2 = (await invoke(db, 'products.get', { token, id: pid })) as Env & { data?: Record<string, unknown> }
  const d2 = after2.data ?? {}
  check('الاسم تحدث', d2.name === 'خبز عربي فاخر')
  check('السعر بقي 750 بعد تعديل الاسم', d2.price_minor === 750, `actual=${String(d2.price_minor)}`)
  check('الفئة بقي بعد تعديل الاسم', d2.category_id === catId)

  // 5) فتح/حفظ متكرر
  let repeatOk = true
  for (let i = 0; i < 3; i++) {
    const r = await invoke(db, 'products.update', { token, id: pid, priceMinor: 750 + i })
    if (!r.ok) { repeatOk = false; check(`فتح/حفظ متكرر ${i + 1}`, false, r.error ?? ''); break }
  }
  if (repeatOk) check('فتح/حفظ متكرر 3 مرات بلا خطأ', true)
  const after3 = (await invoke(db, 'products.get', { token, id: pid })) as Env & { data?: Record<string, unknown> }
  check('السعر النهائي 752', (after3.data as Record<string, unknown>)?.price_minor === 752)

  // 6) تعطيل عبر تعديل جزئي — SKU/الفئة لا تُمحى (ثغرة المحو الصامت القديمة)
  const deact = await invoke(db, 'products.update', { token, id: pid, active: false })
  check('تعطيل جزئي نجح', deact.ok === true, deact.error ?? '')
  const afterDeact = (await invoke(db, 'products.get', { token, id: pid })) as Env & { data?: Record<string, unknown> }
  const dd = afterDeact.data ?? {}
  check('معطّل بعد التعطيل', dd.active === 0)
  check('SKU حُفظ بعد التعطيل', dd.sku === 'ARB-001')
  check('الفئة حُفظت بعد التعطيل', dd.category_id === catId)

  console.log('==============================================')
  console.log(`النتيجة: PASS=${pass} FAIL=${fail}`)
  if (failures.length) {
    console.log('إخفاقات:')
    for (const f of failures) console.log('  -', f)
  }
  console.log(fail === 0 ? 'PRODUCT-EDIT-REGRESSION: ALL PASS' : 'PRODUCT-EDIT-REGRESSION: FAILURES')
  process.exit(fail === 0 ? 0 : 1)
}

void main()

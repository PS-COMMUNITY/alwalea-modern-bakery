// =============================================================
// اختبار إطلاق شامل لتطبيق Electron — مخبز الولاء الحديث
// يشغَّل: bun scripts/e2e/release-e2e.ts <phase1|phase2> [debugPort]
// يتطلب تطبيقًا يعمل مع --remote-debugging-port=<port> وHOME معزول.
// يغطي: الإعداد الأول، دخول، تنقل كل الشاشات، شراء/إلغاء، إنتاج مع clientRef
// (منع التكرار)، بيع POS عبر الواجهة الحقيقية، بيع آجل، هالك، مصروف،
// ورديات، نسخ احتياطي/معاينة، لقطات شاشة، ثم إعادة التشغيل والتحقق من البقاء.
// =============================================================
const PORT = Number(process.argv[3] ?? '9333')
const PHASE = process.argv[2] ?? 'phase1'
const SHOT_DIR = process.env.E2E_SHOT_DIR ?? '/tmp/e2e-shots'
const STATE_FILE = process.env.E2E_STATE_FILE ?? '/tmp/e2e-state.json'
const fs = await import('node:fs')

let TOKEN: string | null = null

interface CdpTarget { webSocketDebuggerUrl: string; type: string; title: string }

async function getPageWs(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      const targets = (await res.json()) as CdpTarget[]
      const page = targets.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* لم يجهز بعد */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('لم يُعثر على هدف CDP للصفحة')
}

let ws: WebSocket | null = null
let msgId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const consoleErrors: string[] = []

function connect(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url)
    ws.onopen = () => resolve()
    ws.onerror = (e) => reject(new Error('ws error: ' + String(e)))
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number
        result?: unknown
        error?: { message: string }
        method?: string
        params?: { type?: string; args?: Array<{ value?: unknown; description?: string }> }
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)
        if (text) consoleErrors.push(text)
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      }
    }
  })
}

function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws!.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)) }
    }, 20000)
  })
}

async function evaluate(expr: string): Promise<unknown> {
  const r = (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as {
    result: { value: unknown; subtype?: string }
    exceptionDetails?: { text: string; exception?: { description?: string } }
  }
  if (r.exceptionDetails) throw new Error('JS eval error: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
  return r.result.value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`PASS | ${name}${detail ? ' — ' + detail : ''}`) }
  else { failed++; console.log(`FAIL | ${name}${detail ? ' — ' + detail : ''}`) }
}

function fillReactInput(selector: string, value: string): string {
  const el = document.querySelector(selector) as HTMLInputElement | null
  if (!el) return 'NO_INPUT'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return 'OK'
}

async function shot(name: string): Promise<void> {
  try {
    const r = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string }
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    fs.writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(r.data, 'base64'))
    console.log(`SHOT | ${SHOT_DIR}/${name}.png`)
  } catch (e) { console.log('WARN | screenshot failed: ' + String(e)) }
}

/** استدعاء قناة IPC من سياق الـ renderer — نفس مسار الواجهة تمامًا (مع رمز الجلسة) */
async function invoke<T>(channel: string, payload: Record<string, unknown> = {}): Promise<T> {
  const full = TOKEN ? { token: TOKEN, ...payload } : { ...payload }
  return (await evaluate(`window.bakery.invoke(${JSON.stringify(channel)}, ${JSON.stringify(full)}).then(r => { if (!r.ok) throw new Error(r.error); return r.data })`)) as T
}

/** انتظار ظهور عنصر بمحدد */
async function waitFor(selector: string, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) === true) return true
    await sleep(500)
  }
  return false
}

async function clickNav(label: string): Promise<void> {
  await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.trim().includes(${JSON.stringify(label)}));
    if (btn) btn.click();
    return btn ? 'OK' : 'NO_NAV';
  })()`)
  await sleep(700)
}

// ---------- Phase 1: إعداد كامل + دورات مالية ----------
async function phase1(): Promise<void> {
  await send('Page.enable')
  await send('Runtime.enable')
  await sleep(1500)

  // S01: شاشة الإعداد
  check('S01 شاشة الإعداد الأولى ظهرت', await waitFor('.auth-card input', 40))
  await shot('01-setup')

  // S02: إتمام الإعداد عبر الواجهة (الإعداد يسجّل المالك دخولًا تلقائيًا)
  await evaluate(`(${fillReactInput})('.auth-card input[placeholder*="مخبز"]', 'مخبز الولاء الحديث')`)
  await evaluate(`(${fillReactInput})('.auth-card input[placeholder="الاسم الكامل"]', 'صاحب المخبز')`)
  const pwInputs = await evaluate(`Array.from(document.querySelectorAll('.auth-card input[type=password]')).length`)
  check('S02a حقلا كلمة المرور ظاهران', pwInputs === 2, `count=${pwInputs}`)
  await evaluate(`(() => {
    const els = document.querySelectorAll('.auth-card input[type=password]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(els[0], '1234'); els[0].dispatchEvent(new Event('input', {bubbles:true}));
    setter.call(els[1], '1234'); els[1].dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await evaluate(`document.querySelector('.auth-card button.btn.primary')?.click()`)
  check('S02 الإعداد اكتمل ودخل الهيكل تلقائيًا (وضع الحساب الواحد)', await waitFor('.app-shell .sidebar', 30))
  const dir = await evaluate(`document.documentElement.getAttribute('dir') + '/' + document.documentElement.getAttribute('lang')`)
  check('S02a الوثيقة RTL عربية', dir === 'rtl/ar', dir)
  await shot('02-dashboard-fresh')

  // جلسة CDP مستقلة عن الجلسة المدمجة: نحصل على رمز عبر auth.login (قناة عامة)
  const login = await invoke<{ token: string }>('auth.login', { password: '1234' })
  TOKEN = login.token
  check('S02b جلسة CDP جاهزة عبر auth.login', TOKEN !== null && TOKEN.length > 10)

  // S04: تنقل عبر كل الشاشات وفحص ظهورها
  const navLabels = await evaluate(`Array.from(document.querySelectorAll('.nav-item')).map(b => b.textContent.trim())`) as string[]
  check('S04a القائمة الجانبية تحتوي 15 عنصرًا', navLabels.length === 15, `count=${navLabels.length}`)
  let navFailures = 0
  for (const label of navLabels) {
    await clickNav(label.split(' ')[0].length > 0 ? label : label)
    const hasContent = (await evaluate(`(document.querySelector('.content h1')?.textContent ?? '') !== '' || !!document.querySelector('.content .card, .content table, .content .stat')`)) === true
    const hasFatal = (await evaluate(`Array.from(document.querySelectorAll('.banner.error')).some(b => b.textContent.includes('خطأ غير متوقع'))`)) === true
    if (!hasContent || hasFatal) { navFailures++; console.log(`FAIL | S04 شاشة «${label}» (محتوى=${hasContent}, خطأ=${hasFatal})`) }
  }
  check('S04 كل الشاشات تُعرض بمحتوى دون أخطاء', navFailures === 0, `فشل ${navFailures} من ${navLabels.length}`)

  // S05: بيانات أساسية عبر قنوات IPC الحقيقية
  const cat = await invoke<{ id: number }>('categories.create', { name: 'مواد أساسية' })
  const flour = await invoke<{ id: number }>('products.create', { name: 'دقيق', categoryId: cat.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 250, costMinor: 200, trackStock: true, minStockMilli: 10000 })
  const bread = await invoke<{ id: number }>('products.create', { name: 'خبز أبيض', categoryId: cat.id, type: 'FINISHED', baseUnit: 'كغ', priceMinor: 500, costMinor: 0, trackStock: true, minStockMilli: 5000 })
  const sugar = await invoke<{ id: number }>('products.create', { name: 'سكر', categoryId: cat.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 300, trackStock: true })
  const yeast = await invoke<{ id: number }>('products.create', { name: 'خميرة', categoryId: cat.id, type: 'RAW', baseUnit: 'قطعة', priceMinor: 0, costMinor: 1400, trackStock: true })
  check('S05 منتجات أُنشئت', flour.id > 0 && bread.id > 0 && sugar.id > 0 && yeast.id > 0)
  await invoke('inventory.opening', { items: [
    { productId: flour.id, qtyMilli: 100000, unitCostMinor: 200 },
    { productId: sugar.id, qtyMilli: 20000, unitCostMinor: 300 },
    { productId: yeast.id, qtyMilli: 50000, unitCostMinor: 1400 }
  ] })
  const flourBal0 = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'دقيق' }))[0]
  check('S05a الأرصدة الافتتاحية سُجلت', flourBal0.balance_milli === 100000, `دقيق=${flourBal0.balance_milli}`)

  // S06: فتح وردية بنقدية افتتاحية 200.00
  const sh = await invoke<{ shift: { id: number; expectedMinor: number } }>('shifts.open', { openingCashMinor: 20000 })
  check('S06 وردية مفتوحة', sh.shift.id > 0 && sh.shift.expectedMinor === 20000, `expected=${sh.shift.expectedMinor}`)

  // S07 (البوابة B): شراء نقدي كامل + فحص الدرج والمخزون
  const sup = await invoke<{ id: number }>('suppliers.create', { name: 'مطحنة النور' })
  const pur = await invoke<{ id: number; total_minor: number }>('purchases.create', {
    supplierId: sup.id,
    items: [{ productId: flour.id, qtyMilli: 50000, unitCostMinor: 200 }],
    paidMinor: 10000,
    clientRef: 'e2e-purchase-1'
  })
  const flourBal1 = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'دقيق' }))[0]
  check('S07 شراء نقدي رفع المخزون', flourBal1.balance_milli === 150000, `دقيق=${flourBal1.balance_milli}`)
  const afterPur = await invoke<{ shift: { expectedMinor: number } }>('shifts.current')
  check('S07a الشراء النقدي خرج من الدرج', afterPur.shift.expectedMinor === 20000 - 10000, `expected=${afterPur.shift.expectedMinor}`)

  // S07b: تكرار نفس clientRef للشراء يُرجع نفس الفاتورة (لا تكرار)
  const pur2 = await invoke<{ id: number }>('purchases.create', {
    supplierId: sup.id,
    items: [{ productId: flour.id, qtyMilli: 50000, unitCostMinor: 200 }],
    paidMinor: 10000,
    clientRef: 'e2e-purchase-1'
  })
  const flourBal1b = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'دقيق' }))[0]
  check('S07b منع تكرار الشراء بclientRef', pur2.id === pur.id && flourBal1b.balance_milli === 150000, `id=${pur2.id}`)

  // S08 (البوابة C): إنتاج — الوصفة ثم دفعة بclientRef مكرر
  const recipe = await invoke<{ id: number }>('recipes.create', {
    name: 'خبز أبيض قياسي',
    productId: bread.id,
    outputQtyMilli: 9000,
    items: [
      { productId: flour.id, qtyMilli: 10000 },
      { productId: sugar.id, qtyMilli: 200 },
      { productId: yeast.id, qtyMilli: 100 }
    ]
  })
  const cr = 'e2e-batch-dup-' + Date.now()
  const b1 = await invoke<{ id: number; batch_no: string }>('production.create', {
    recipeId: recipe.id, actualQtyMilli: 8500, wasteQtyMilli: 500, clientRef: cr
  })
  const b2 = await invoke<{ id: number }>('production.create', {
    recipeId: recipe.id, actualQtyMilli: 8500, wasteQtyMilli: 500, clientRef: cr
  })
  check('S08 إعادة إرسال الدفعة نفسها أرجعت الدفعة ذاتها', b1.id === b2.id, `b1=${b1.id} b2=${b2.id}`)
  const flourBal2 = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'دقيق' }))[0]
  // المواد: (8500+500)/9000 × 10000 = 10000 دقيق
  check('S08a المواد خُصمت مرة واحدة بالضبط', flourBal2.balance_milli === 140000, `دقيق=${flourBal2.balance_milli}`)
  const breadBal = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'خبز أبيض' }))[0]
  check('S08b الناتج أُضيف والهالك لم يدخل البيعable (9 → 8.5 صالح)', breadBal.balance_milli === 8500, `خبز=${breadBal.balance_milli}`)
  const wasteMoves = await invoke<{ qty_milli: number }[]>('inventory.movements', { type: 'WASTE' })
  check('S08c الهالك موثق بحركة WASTE', wasteMoves.some((m) => m.qty_milli === -500))

  // S09 (البوابة J/A): بيع نقدي عبر واجهة POS الحقيقية
  await clickNav('نقطة البيع')
  await evaluate(`(${fillReactInput})('.content input[placeholder*="بحث سريع"]', 'خبز أبيض')`)
  await sleep(500)
  await evaluate(`document.querySelector('.pos-product')?.click()`)
  await sleep(400)
  const cartRows = await evaluate(`document.querySelectorAll('.cart tbody tr').length`)
  check('S09a إضافة للسلة عبر النقر', cartRows === 1, `rows=${cartRows}`)
  // الكمية 2 كغ
  await evaluate(`(() => {
    const inp = document.querySelector('.cart tbody tr .qty-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '2'); inp.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await sleep(300)
  await evaluate(`Array.from(document.querySelectorAll('.content button')).find(b => b.textContent.includes('ترحيل الفاتورة') || b.textContent.includes('ترحيل'))?.click()`)
  await sleep(1500)
  const posNotice = await evaluate(`document.querySelector('.banner.ok')?.textContent ?? ''`)
  check('S09 ترحيل البيع النقدي من الواجهة', String(posNotice).includes('تم ترحيل الفاتورة'), String(posNotice))
  await shot('03-pos-receipt')
  // إغلاق نافذة الإيصال إن ظهرت
  await evaluate(`document.querySelector('.modal-back')?.click()`)
  await sleep(300)
  const salesList = await invoke<{ id: number }[]>('sales.list')
  check('S09b الفاتورة مسجلة في القائمة', salesList.length === 1, `count=${salesList.length}`)
  const afterSale = await invokeSafe<{ shift: { expectedMinor: number } }>('shifts.current')
  check('S09c نقدية البيع دخلت الدرج', afterSale.shift.expectedMinor === 20000 - 10000 + 1000, `expected=${afterSale.shift.expectedMinor}`)

  // S10 (البوابة A): بيع آجل لعميل + تحصيل جزئي
  const cust = await invoke<{ id: number }>('customers.create', { name: 'محمد أبو سامر', phone: '0599000001' })
  const creditSale = await invoke<{ id: number; total_minor: number; credit_minor: number }>('sales.create', {
    items: [{ productId: bread.id, qtyMilli: 3000 }],
    customerId: cust.id
  })
  check('S10 بيع آجل أضاف دينًا', creditSale.credit_minor === 1500, `credit=${creditSale.credit_minor}`)
  await invoke('customers.payment', { customerId: cust.id, amountMinor: 500, method: 'CASH' })
  const stmt = await invoke<{ balanceMinor: number }>('customers.statement', { id: cust.id })
  check('S10a تحصيل جزئي خفّض الرصيد', stmt.balanceMinor === 1000, `balance=${stmt.balanceMinor}`)

  // S11 (البوابة E): مرتجع/هالك لا يعود لمخزون البيع
  // الرصيد قبل الإعدام: 8500 (إنتاج) − 2000 (بيع نقدي) − 3000 (بيع آجل) = 3500
  await invoke('inventory.waste', { productId: bread.id, qtyMilli: 500, reason: 'تلف من طلبية' })
  const breadBal2 = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'خبز أبيض' }))[0]
  check('S11 الإعدام خفّض الرصيد (3 كغ)', breadBal2.balance_milli === 3000, `خبز=${breadBal2.balance_milli}`)

  // S12: مصروف نقدي
  const expCat = await invoke<{ id: number }>('expenses.categories.create', { name: 'كهرباء' })
  await invoke('expenses.create', { categoryId: expCat.id, amountMinor: 2500, note: 'فاتورة كهرباء' })
  const afterExp = await invokeSafe<{ shift: { expectedMinor: number } }>('shifts.current')
  check('S12 المصروف خرج من الدرج', afterExp.shift.expectedMinor === 20000 - 10000 + 1000 + 500 - 2500, `expected=${afterExp.shift.expectedMinor}`)

  // S13: نسخة احتياطية + معاينة (بوابة I جزئيًا — الاستعادة الكاملة مختبَرة في سكربت 48/48 المعزول)
  const bk = await invoke<{ path: string; sizeBytes: number }>('backup.export', { note: 'نسخة اختبار الإطلاق' })
  check('S13 نسخة احتياطية أُنشئت', bk.sizeBytes > 1000, `path=${bk.path}`)
  const bkList = await invoke<{ id: number }[]>('backup.list')
  check('S13a قائمة النسخ تحتويها', bkList.length >= 1)
  const content = fs.readFileSync(bk.path, 'utf8')
  // تصدير Electron مغقّم عمدًا (بلا هاشات) → authReady=false وneedsOwnerPassword=true صحيحان
  // (الاستعادة تُطلب فيها كلمة مالك جديدة — نفس سياسة الويب، مختبَرة 48/48 في السكربت المعزول)
  const preview = await invoke<{ auth: { authReady: boolean; needsOwnerPassword: boolean; valid: number; total: number }; counts: Record<string, number> }>('backup.preview', { json: content })
  check('S13b معاينة النسخة: مغقّمة وتتطلب كلمة مالك جديدة',
    preview.auth?.authReady === false && preview.auth?.needsOwnerPassword === true && (preview.counts?.products ?? 0) >= 4,
    `valid=${preview.auth?.valid}/${preview.auth?.total} products=${preview.counts?.products}`)

  // S14 (البوابة G): إغلاق الوردية بالفرق المحسوب
  const cur = await invokeSafe<{ shift: { expectedMinor: number } }>('shifts.current')
  const closed = await invoke<{ differenceMinor: number; expectedMinor: number }>('shifts.close', {
    countedCashMinor: cur.shift.expectedMinor,
    notes: 'إغلاق اختبار'
  })
  check('S14 إغلاق الوردية بفرق صفر', closed.differenceMinor === 0 && closed.expectedMinor === cur.shift.expectedMinor, `diff=${closed.differenceMinor}`)

  // S15: لقطات الشاشات النهائية
  await clickNav('لوحة التحكم')
  await sleep(800)
  await shot('04-dashboard-data')
  await clickNav('المشتريات')
  await sleep(600)
  await shot('05-purchases')
  await clickNav('الإنتاج')
  await sleep(600)
  await shot('06-production')
  await clickNav('التقارير')
  await sleep(800)
  await shot('07-reports')
  await clickNav('الورديات')
  await sleep(600)
  await shot('08-shifts')

  // S16: حالة للمرحلة الثانية (إعادة عدّ كل شيء الآن)
  const state = {
    sales: (await invoke<{ id: number }[]>('sales.list')).length,
    batches: (await invoke<{ id: number }[]>('production.list')).length,
    products: (await invoke<{ id: number }[]>('products.list', { includeInactive: true })).length,
    purchases: (await invoke<{ id: number }[]>('purchases.list')).length,
    backups: (await invoke<{ id: number }[]>('backup.list')).length
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8')
  check('S16 حالة المرحلة الثانية حُفظت', true, JSON.stringify(state))
}

async function invokeSafe<T>(ch: string, p: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(ch, p)
}

// ---------- Phase 2: إعادة التشغيل والتحقق من بقاء البيانات ----------
async function phase2(): Promise<void> {
  await send('Page.enable')
  await send('Runtime.enable')
  await sleep(1500)

  // P01: لا شاشة إعداد — دخول مباشر
  check('P01 الدخول ظهر مباشرة (الإعداد اكتمل سابقًا)', await waitFor('.auth-card input', 40))
  await evaluate(`(${fillReactInput})('.auth-card input', '1234')`)
  await evaluate(`document.querySelector('.auth-card form button[type=submit], .auth-card button.btn')?.click()`)
  check('P02 دخول بنفس كلمة المرور بعد إعادة التشغيل', await waitFor('.app-shell .sidebar', 20))

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Record<string, number>
  const login = await invoke<{ token: string }>('auth.login', { password: '1234' })
  TOKEN = login.token
  const sales = await invoke<{ id: number }[]>('sales.list')
  const batches = await invoke<{ id: number }[]>('production.list')
  const products = await invoke<{ id: number }[]>('products.list', { includeInactive: true })
  const purchases = await invoke<{ id: number }[]>('purchases.list')
  const backups = await invoke<{ id: number }[]>('backup.list')
  check('P03 الفواتير بقيت بعد الإعادة', sales.length === state.sales, `${sales.length}/${state.sales}`)
  check('P04 دفعات الإنتاج بقيت', batches.length === state.batches, `${batches.length}/${state.batches}`)
  check('P05 المنتجات بقيت', products.length === state.products, `${products.length}/${state.products}`)
  check('P06 المشتريات بقيت', purchases.length === state.purchases, `${purchases.length}/${state.purchases}`)
  check('P07 سجل النسخ الاحتياطي بقي', backups.length === state.backups, `${backups.length}/${state.backups}`)

  // P08: فتح وردية جديدة والتنقل السريع
  await invoke('shifts.open', { openingCashMinor: 2000 })
  await clickNav('لوحة التحكم')
  await sleep(700)
  const dash = await evaluate(`document.querySelector('.content')?.textContent?.includes('مبيعات') || document.querySelector('.content')?.textContent?.includes('لوحة')`)
  check('P08 لوحة التحكم تعرض بيانات بعد الإعادة', dash === true)
  await shot('09-after-restart')
}

void (async () => {
  await connect(await getPageWs())
  if (PHASE === 'phase1') await phase1()
  else await phase2()
  const errs = consoleErrors.filter((e) => !e.includes('Autofocus processing') && !e.includes('Download the React DevTools'))
  console.log(`CONSOLE_ERRORS | ${errs.length}${errs.length ? ' :: ' + errs.slice(0, 3).join(' || ') : ''}`)
  console.log(`SUMMARY | PASS=${passed} FAIL=${failed}`)
  process.exit(failed > 0 ? 1 : 0)
})().catch((e) => {
  console.log('FATAL | ' + String(e))
  console.log(`SUMMARY | PASS=${passed} FAIL=${failed + 1}`)
  process.exit(1)
})

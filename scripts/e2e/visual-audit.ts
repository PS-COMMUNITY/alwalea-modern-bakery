// =============================================================
// الجرد البصري الإلزامي — لقطات 15 شاشة ببيانات واقعية
// يشغَّل: bun scripts/e2e/visual-audit.ts [debugPort]
// يتطلب تطبيقًا يعمل مع --remote-debugging-port وHOME معزول وXvfb
// الناتج: shot-NN-name.png في E2E_SHOT_DIR + تصنيف كل لقطة في الأطراف
// =============================================================
const PORT = Number(process.argv[2] ?? '9445')
const SHOT_DIR = process.env.E2E_SHOT_DIR ?? '/tmp/va-shots'
const fs = await import('node:fs')
fs.mkdirSync(SHOT_DIR, { recursive: true })

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
    }, 30000)
  })
}

async function evaluate(expr: string): Promise<unknown> {
  const r = (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as {
    result: { value: unknown }
    exceptionDetails?: { text: string; exception?: { description?: string } }
  }
  if (r.exceptionDetails) throw new Error('JS eval error: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
  return r.result.value
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let TOKEN: string | null = null
async function invoke<T>(channel: string, payload: Record<string, unknown> = {}): Promise<T> {
  const full: Record<string, unknown> = TOKEN ? { token: TOKEN, ...payload } : payload
  return (await evaluate(`window.bakery.invoke(${JSON.stringify(channel)}, ${JSON.stringify(full)}).then(r => { if (!r.ok) throw new Error(r.error); return r.data })`)) as T
}

async function shot(name: string): Promise<void> {
  const r = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string }
  fs.writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(r.data, 'base64'))
  console.log(`SHOT | ${name}`)
}

/** تعبئة حقل React بشكل صحيح (setter أصلي + حدث input) */
const fillReactInput = `(el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value); el.dispatchEvent(new Event('input', {bubbles:true}));
}`
const fillReactTextarea = `(el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, value); el.dispatchEvent(new Event('input', {bubbles:true}));
}`

async function clickNav(label: string): Promise<void> {
  await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.trim().includes(${JSON.stringify(label)}));
    if (btn) btn.click();
  })()`)
  await sleep(700)
}

async function clickButtonByText(text: string): Promise<void> {
  await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes(${JSON.stringify(text)}));
    if (btn) btn.click();
  })()`)
  await sleep(700)
}

async function waitForText(text: string, tries = 15): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const ok = (await evaluate(`document.querySelector('.content')?.textContent?.includes(${JSON.stringify(text)}) || Array.from(document.querySelectorAll('.modal')).some(m => m.textContent.includes(${JSON.stringify(text)}))`)) as boolean
    if (ok) return true
    await sleep(400)
  }
  return false
}

async function closeAllModals(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const open = (await evaluate(`document.querySelectorAll('.modal-back').length`)) as number
    if (open === 0) return
    await evaluate(`(() => {
      const m = Array.from(document.querySelectorAll('.modal-back')).pop();
      const btn = m?.querySelector('button');
      if (btn) btn.click();
    })()`)
    await sleep(400)
  }
}

// =============================================================

const wsUrl = await getPageWs()
await connect(wsUrl)
await send('Page.enable')
await send('Runtime.enable')
await sleep(1500)

const MONTH_LOCKED_SHOTS: string[] = []
let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`)
}

// ---------- 1) شاشة الإعداد (أول تشغيل) ----------
const dir = (await evaluate(`document.documentElement.getAttribute('dir') + '/' + document.documentElement.getAttribute('lang')`)) as string
check('VA00 RTL على html', dir.startsWith('rtl/'), dir)
const fontOk = (await evaluate(`document.fonts.check('15px Cairo')`)) as boolean
check('VA00b خط Cairo محمّل offline', fontOk === true, `check=${fontOk}`)
await shot('01-setup-wizard')

// إكمال الإعداد عبر الواجهة الحقيقية
await evaluate(`(${fillReactInput})(document.querySelector('.auth-card input[placeholder*="مخبز"]'), 'مخبز الولاء الحديث')`)
await evaluate(`(${fillReactInput})(document.querySelector('.auth-card input[placeholder="الاسم الكامل"]'), 'أبو أحمد')`)
await evaluate(`document.querySelector('.auth-card button.btn.primary')?.click()`)
await sleep(2000)
const login = await invoke<{ token: string }>('auth.login', { password: '1234' })
TOKEN = login.token
check('VA01 دخول بعد الإعداد', !!TOKEN)

// ---------- 2) بذر بيانات واقعية ----------
const cats = await invoke<{ id: number; name: string }[]>('categories.list', {})
const catBread = cats.find((c) => c.name === 'خبز ومعجنات') ?? (await invoke<{ id: number }>('categories.create', { name: 'خبز ومعجنات' }))
const catRaw = cats.find((c) => c.name === 'مواد خام') ?? (await invoke<{ id: number }>('categories.create', { name: 'مواد خام' }))
// الإعداد الأولي يبذر 8 منتجات أساسية — نعيد استخدامها بالاسم بدل تكرارها
const existing = await invoke<{ id: number; name: string }[]>('products.list', { includeInactive: true })
const ensureProduct = async (name: string, create: () => Promise<{ id: number }>): Promise<{ id: number }> => {
  const found = existing.find((p) => p.name === name)
  return found ?? (await create())
}
const pWhite = await ensureProduct('خبز أبيض', () => invoke<{ id: number }>('products.create', { name: 'خبز أبيض', categoryId: catBread.id, type: 'FINISHED', baseUnit: 'كغ', priceMinor: 500, costMinor: 320, trackStock: true, minStockMilli: 8000 }))
const pDark = await ensureProduct('خبز أسمر', () => invoke<{ id: number }>('products.create', { name: 'خبز أسمر', categoryId: catBread.id, type: 'FINISHED', baseUnit: 'كغ', priceMinor: 650, costMinor: 400, trackStock: true, minStockMilli: 5000 }))
const pFlour = await ensureProduct('طحين', () => invoke<{ id: number }>('products.create', { name: 'طحين', categoryId: catRaw.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 200, trackStock: true, minStockMilli: 30000 }))
const pSugar = await ensureProduct('سكر', () => invoke<{ id: number }>('products.create', { name: 'سكر', categoryId: catRaw.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 350, trackStock: true, minStockMilli: 10000 }))
const pSalt = await ensureProduct('ملح', () => invoke<{ id: number }>('products.create', { name: 'ملح', categoryId: catRaw.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 120, trackStock: true, minStockMilli: 5000 }))
const pYeast = await ensureProduct('خميرة', () => invoke<{ id: number }>('products.create', { name: 'خميرة', categoryId: catRaw.id, type: 'RAW', baseUnit: 'قطعة', priceMinor: 0, costMinor: 1400, trackStock: true, minStockMilli: 20 }))
const pImpr = await ensureProduct('محسن خبز', () => invoke<{ id: number }>('products.create', { name: 'محسن خبز', categoryId: catRaw.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 8000, trackStock: true, minStockMilli: 2000 }))
const pBags = await ensureProduct('أكياس تغليف', () => invoke<{ id: number }>('products.create', { name: 'أكياس تغليف', categoryId: catRaw.id, type: 'RAW', baseUnit: 'قطعة', priceMinor: 0, costMinor: 60, trackStock: true, minStockMilli: 200 }))
check('VA02 منتجات واقعية أُنشئت', pWhite.id > 0 && pBags.id > 0)

await invoke('inventory.opening', { items: [
  { productId: pFlour.id, qtyMilli: 150000, unitCostMinor: 200 },
  { productId: pSugar.id, qtyMilli: 80000, unitCostMinor: 350 },
  { productId: pSalt.id, qtyMilli: 40000, unitCostMinor: 120 },
  { productId: pYeast.id, qtyMilli: 25000, unitCostMinor: 1400 },
  { productId: pImpr.id, qtyMilli: 15000, unitCostMinor: 8000 },
  { productId: pBags.id, qtyMilli: 300000, unitCostMinor: 60 },
  { productId: pWhite.id, qtyMilli: 20000, unitCostMinor: 320 },
  { productId: pDark.id, qtyMilli: 10000, unitCostMinor: 400 }
]})
const c1 = await invoke<{ id: number }>('customers.create', { name: 'أبو أحمد (موزع)', phone: '0599000001' })
await invoke<{ id: number }>('customers.create', { name: 'مخبز السلام', phone: '0599000002' })
await invoke<{ id: number }>('customers.create', { name: 'مؤسسة الرزق', phone: '0599000003' })
const s1 = await invoke<{ id: number }>('suppliers.create', { name: 'مطحنة القمح الذهبي', phone: '0598000001' })
await invoke<{ id: number }>('suppliers.create', { name: 'مؤسسة التوريد العامة', phone: '0598000002' })
const pur = await invoke<{ id: number }>('purchases.create', {
  supplierId: s1.id,
  items: [{ productId: pFlour.id, qtyMilli: 100000, unitCostMinor: 200 }],
  payments: [{ method: 'CASH', amountMinor: 15000 }]
})
await invoke('shifts.open', { openingCashMinor: 20000 })
const sale1 = await invoke<{ invoice_no: string }>('sales.create', {
  items: [{ productId: pWhite.id, qtyMilli: 1500 }, { productId: pDark.id, qtyMilli: 2000 }],
  payments: [{ method: 'CASH', amountMinor: 2050 }]
})
await invoke('sales.create', {
  items: [{ productId: pWhite.id, qtyMilli: 5000 }],
  customerId: c1.id,
  note: 'بيع آجل — موزع'
})
await invoke('customers.payment', { customerId: c1.id, amountMinor: 1000, method: 'CASH', note: 'دفعة جزئية' })
const expCats = await invoke<{ id: number; name: string }[]>('expenses.categories.list', {})
const catGas = expCats.find((c) => c.name === 'كهرباء وماء') ?? expCats[0]
const catMisc = expCats.find((c) => c.name === 'متنوعة') ?? expCats[0]
await invoke('expenses.create', { categoryId: catMisc.id, title: 'غاز الطهي', amountMinor: 4500, method: 'CASH', beneficiary: 'مؤسسة الغاز', date: new Date().toISOString().slice(0, 10) })
await invoke('expenses.create', { categoryId: catGas.id, title: 'كهرباء', amountMinor: 12000, method: 'CASH', beneficiary: 'شركة الكهرباء', date: new Date().toISOString().slice(0, 10) })
await invoke('inventory.waste', { productId: pWhite.id, qtyMilli: 500, reason: 'هالك — لم يُبع خلال اليوم' })
check('VA03 دورة تشغيلية كاملة بُذرت', pur.id > 0 && !!sale1.invoice_no)

// ---------- 3) لقطات الشاشات الخمس عشرة ----------
await shot('03-dashboard')

// POS: قبل وبعد إضافة سلة
await clickNav('نقطة البيع')
await sleep(500)
await shot('04-pos-empty')
await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.pos-product'));
  cards.find(c => c.textContent.includes('خبز أبيض'))?.click();
  cards.find(c => c.textContent.includes('خبز أسمر'))?.click();
})()`)
await sleep(600)
await shot('05-pos-cart')

// المنتجات
await clickNav('المنتجات')
await shot('06-products')

// المخزون
await clickNav('المخزون')
await shot('07-inventory')

// المشتريات
await clickNav('المشتريات')
await shot('08-purchases')

// الموردون
await clickNav('الموردون')
await shot('09-suppliers')

// الجرد والإقفال
await clickNav('الجرد والإقفال')
await sleep(400)
await shot('10-period-count')
await clickButtonByText('ورقة جرد جديدة')
await sleep(500)
await clickButtonByText('إنشاء الورقة')
check('VA10 إنشاء ورقة جرد', await waitForText('أُنشئت ورقة الجرد'))
await sleep(400)
await clickButtonByText('تفاصيل')
await sleep(600)
await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('.modal table.data tbody tr')).find(r => r.textContent.includes('خبز أبيض'));
  const inp = row?.querySelector('input');
  if (inp) { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(inp, '14.2'); inp.dispatchEvent(new Event('input', {bubbles:true})); }
})()`)
await sleep(300)
await shot('11-period-count-detail')
await closeAllModals()
await clickButtonByText('تقرير الفروق')
await sleep(600)
await closeAllModals()
// إقفال الشهر: نافذة التأكيد
await evaluate(`(() => {
  const inp = document.querySelector('.card input[type=month]');
  if (inp) { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(inp, ${JSON.stringify(new Date().toISOString().slice(0, 7))}); inp.dispatchEvent(new Event('input', {bubbles:true})); }
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('إقفال الشهر'));
  btn?.click();
})()`)
await sleep(600)
await shot('12-period-close-confirm')
await closeAllModals()

// المبيعات (قائمة إضافية للتوثيق)
await clickNav('المبيعات')
await shot('13-sales')

// المصروفات
await clickNav('المصروفات')
await shot('14-expenses')

// الورديات والصندوق
await clickNav('الورديات والصندوق')
await shot('15-cash-shifts')

// التقارير
await clickNav('التقارير')
await sleep(700)
await shot('16-reports')

// الإعدادات
await clickNav('الإعدادات')
await sleep(400)
await shot('17-settings')

// النسخ الاحتياطي (داخل الإعدادات)
await clickButtonByText('النسخ الاحتياطي')
await sleep(500)
await shot('18-backup')

// تسجيل الخروج → شاشة الدخول
await clickButtonByText('تسجيل الخروج')
await sleep(800)
await shot('02-login')
await evaluate(`(() => {
  const els = document.querySelectorAll('.auth-card input[type=password]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  if (els[0]) { setter.call(els[0], '1234'); els[0].dispatchEvent(new Event('input', {bubbles:true})); }
})()`)
await evaluate(`document.querySelector('.auth-card button.btn.primary')?.click()`)
await sleep(1500)

console.log(`CONSOLE_ERRORS | ${consoleErrors.length}`)
consoleErrors.slice(0, 5).forEach((e) => console.log('CERR | ' + e))
console.log(`=== VA DONE | failures=${failures} ===`)
process.exit(failures === 0 ? 0 : 1)

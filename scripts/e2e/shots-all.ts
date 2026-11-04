// =============================================================
// CDP Screenshot Harness — AFTER evidence for UI parity audit (Task V-2)
// Run via scripts/e2e/run-shots.sh
//   bun scripts/e2e/shots-all.ts [debugPort]   (SHOT_DIR env = output dir)
// Flow: first-run wizard (or login) → auth.login session token →
//   idempotent demo-data seeding via IPC → SEED VERIFICATION GATE
//   (reports.dashboard via IPC must show the seeded invoices before any
//   navigation happens) → forced DashboardScreen remount (setTab بنفس
//   القيمة لا يُعيد التصيير فتبقى اللوحة بأصفار ما قبل البذر) →
//   tour ALL 16 screens → extra detail shots (count modal / new-product
//   modal / POS toast) → final '21-dashboard-final' proving real numbers.
// Honest evidence: no src/ modifications, real UI clicks, every seed step
// try/caught and logged (SKIPPED steps stay visible).
// =============================================================
const PORT = Number(process.argv[2] ?? '9555')
const path = await import('node:path')
const fs = await import('node:fs')
const SHOT_DIR = process.env.SHOT_DIR ?? path.resolve(process.cwd(), '../release-evidence/parity/before')

let TOKEN: string | null = null
let shotsTaken = 0
const seedNotes: string[] = []
const seedFails: string[] = []
const wizardLog: string[] = []

interface CdpTarget { webSocketDebuggerUrl: string; type: string; title: string }

async function getPageWs(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      const targets = (await res.json()) as CdpTarget[]
      const page = targets.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* not ready yet */ }
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
    }, 25000)
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

function log(line: string): void {
  console.log(line)
}
function note(msg: string): void {
  seedNotes.push(msg)
  log(`NOTE | ${msg}`)
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
    shotsTaken++
    log(`SHOT | ${SHOT_DIR}/${name}.png`)
  } catch (e) { log('WARN | screenshot failed: ' + String(e)) }
}

/** استدعاء قناة IPC من سياق الـ renderer — نفس مسار الواجهة تمامًا */
async function invoke<T>(channel: string, payload: Record<string, unknown> = {}): Promise<T> {
  const full = TOKEN ? { token: TOKEN, ...payload } : { ...payload }
  return (await evaluate(`window.bakery.invoke(${JSON.stringify(channel)}, ${JSON.stringify(full)}).then(r => { if (!r.ok) throw new Error(r.error); return r.data })`)) as T
}

async function waitFor(selector: string, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) === true) return true
    await sleep(500)
  }
  return false
}

async function waitForText(text: string, tries = 24): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await evaluate(`document.querySelector('.content')?.textContent?.includes(${JSON.stringify(text)}) ?? false`)) === true) return true
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
  await sleep(800)
}

async function clickButtonByText(text: string): Promise<unknown> {
  return evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes(${JSON.stringify(text)}));
    if (btn) { btn.click(); return 'OK' }
    return 'NO_BUTTON'
  })()`)
}

/** إغلاق كل النوافذ المفتوحة */
async function closeAllModals(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const open = (await evaluate(`document.querySelectorAll('.modal-back').length`)) as number
    if (!open) return
    await evaluate(`(() => {
      const m = Array.from(document.querySelectorAll('.modal-back')).pop();
      const btn = Array.from(m.querySelectorAll('button')).find(b => b.textContent.includes('إغلاق') || b.textContent.includes('تراجع'));
      if (btn) { btn.click(); return 'BTN' }
      m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return 'BACK'
    })()`)
    await sleep(500)
  }
}

/** غلاف بذر متسامح: كل خطوة مستقلة — الفشل يُسجل ولا يوقف التدفق */
async function seedStep(label: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn()
    log(`SEED | ${label} — ${detail}`)
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 220)
    seedFails.push(`${label}: ${msg}`)
    log(`SEED_FAIL | ${label} — ${msg}`)
  }
}

// ---------- 1) إعداد أول تشغيل / دخول ----------
async function ensureSession(): Promise<void> {
  // انتظار جهوزية التطبيق: إما هيكل التطبيق أو بطاقة المصادقة
  let ready = false
  for (let i = 0; i < 60; i++) {
    const st = (await evaluate(`({
      shell: !!document.querySelector('.app-shell .sidebar'),
      auth: !!document.querySelector('.auth-card input'),
      wizard: !!document.querySelector('.auth-card input[placeholder="الاسم الكامل"]')
    })`)) as { shell: boolean; auth: boolean; wizard: boolean }
    if (st.shell || st.auth) { ready = true; break }
    await sleep(1000)
  }
  if (!ready) throw new Error('التطبيق لم يجهز: لا شاشة دخول ولا هيكل تطبيق')

  const wizardVisible = (await evaluate(`!!document.querySelector('.auth-card input[placeholder="الاسم الكامل"]')`)) === true
  const shellVisible = (await evaluate(`!!document.querySelector('.app-shell .sidebar')`)) === true

  if (wizardVisible) {
    // 00-firstrun-setup — معالج الإعداد الأول (نفس تدفق release-e2e.ts حرفيًا)
    await shot('00-firstrun-setup')
    wizardLog.push('fill .auth-card input[placeholder*="مخبز"] = "مخبز الولاء الحديث" (React setter + input event)')
    wizardLog.push('fill .auth-card input[placeholder="الاسم الكامل"] = "صاحب المخبز" (React setter + input event)')
    wizardLog.push('fill both .auth-card input[type=password] = "1234" (HTMLInputElement.prototype.value setter)')
    wizardLog.push('click .auth-card button.btn.primary (text: إنشاء النشاط وبدء العمل)')
    await evaluate(`(${fillReactInput})('.auth-card input[placeholder*="مخبز"]', 'مخبز الولاء الحديث')`)
    await evaluate(`(${fillReactInput})('.auth-card input[placeholder="الاسم الكامل"]', 'صاحب المخبز')`)
    await evaluate(`(() => {
      const els = document.querySelectorAll('.auth-card input[type=password]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(els[0], '1234'); els[0].dispatchEvent(new Event('input', {bubbles:true}));
      setter.call(els[1], '1234'); els[1].dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    await evaluate(`document.querySelector('.auth-card button.btn.primary')?.click()`)
    const inShell = await waitFor('.app-shell .sidebar', 30)
    if (!inShell) throw new Error('لم يدخل هيكل التطبيق بعد إتمام معالج الإعداد')
    log(`WIZARD | completed via UI clicks: ${wizardLog.join(' ; ')}`)
    await sleep(1000)
  } else if (!shellVisible) {
    // شاشة دخول (الإعداد منجز سابقًا) — كلمة مرور واحدة
    await shot('01-login-empty')
    wizardLog.push('login: fill .auth-card input[type=password] = "1234" then click .auth-card button[type=submit] (دخول)')
    await evaluate(`(() => {
      const el = document.querySelector('.auth-card input[type=password]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '1234'); el.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    await evaluate(`document.querySelector('.auth-card button[type=submit]')?.click()`)
    const inShell = await waitFor('.app-shell .sidebar', 30)
    if (!inShell) throw new Error('لم يدخل هيكل التطبيق بعد تسجيل الدخول')
    log(`WIZARD | login screen flow: ${wizardLog.join(' ; ')}`)
  } else {
    log('WIZARD | app shell already active (session persisted) — skipping auth flow')
  }
  await sleep(600)
}

// ---------- 2) بذر بيانات تجريبية واقعية (كل خطوة مستقلة) ----------
interface ProductLite { id: number; name: string }
interface PartyLite { id: number; name: string }

async function ensureProduct(map: Map<string, number>, name: string): Promise<number> {
  const known = map.get(name)
  if (known) return known
  const cats = await invoke<{ id: number; name: string }[]>('categories.list', { includeInactive: true })
  const cat = cats[0]
  const created = await invoke<{ id: number }>('products.create', {
    name, categoryId: cat?.id ?? null, type: 'RAW', baseUnit: 'كغ', priceMinor: 0, costMinor: 0, trackStock: true
  })
  map.set(name, created.id)
  return created.id
}

async function seedData(): Promise<void> {
  // قائمة المنتجات المبذورة من الإعداد الأولي (setup.ts يبذر 8 منتجات)
  const products = await invoke<ProductLite[]>('products.list', { includeInactive: true })
  const pmap = new Map<string, number>(products.map((p) => [p.name, p.id]))
  log(`SEED | products.list — ${products.length} products (setup-starter)`)

  const pid = async (name: string): Promise<number> => {
    const id = pmap.get(name)
    if (!id) throw new Error(`المنتج «${name}» غير موجود في الكتالوج`)
    return id
  }

  // --- أرصدة افتتاحية (لكل منتج استدعاء مستقل — الافتتاحي يُمنع تكراره لكل منتج) ---
  const openings: Array<[string, number, number]> = [
    ['طحين', 250000, 250],
    ['سكر', 40000, 350],
    ['ملح', 15000, 120],
    ['خميرة', 30000, 1400],
    ['محسن خبز', 5000, 8000],
    ['أكياس تغليف', 500000, 60]
  ]
  for (const [name, qtyMilli, cost] of openings) {
    await seedStep(`inventory.opening ${name} ${qtyMilli / 1000}kg @${cost}`, async () => {
      const id = await pid(name)
      await invoke('inventory.opening', { items: [{ productId: id, qtyMilli, unitCostMinor: cost }] })
      return 'OK'
    })
  }
  // منتجات نهائية بكمية 0: reqMilli يرفض 0 — الرصيد يظل 0 تلقائيًا (لا حركات)
  note('inventory.opening for خبز أبيض/خبز أسمر qty=0 SKIPPED — isMilliValid requires qtyMilli > 0; balance is 0 by absence of movements')

  // --- وردية مفتوحة ---
  await seedStep('shifts.open openingCashMinor=20000', async () => {
    await invoke('shifts.open', { openingCashMinor: 20000 })
    return 'OK'
  })

  // --- مورد + شراء نقدي كامل (طحين 100كغ × 250) ---
  await seedStep('suppliers.create مطحنة النور', async () => {
    const list = await invoke<PartyLite[]>('suppliers.list', {})
    if (list.some((s) => s.name === 'مطحنة النور')) return 'ALREADY_EXISTS'
    await invoke('suppliers.create', { name: 'مطحنة النور' })
    return 'OK'
  })
  await seedStep('purchases.create طحين 100kg @250 paid CASH 25000', async () => {
    const sup = (await invoke<PartyLite[]>('suppliers.list', {})).find((s) => s.name === 'مطحنة النور')
    if (!sup) throw new Error('المورد مطحنة النور غير موجود')
    await invoke('purchases.create', {
      supplierId: sup.id,
      items: [{ productId: await pid('طحين'), qtyMilli: 100000, unitCostMinor: 250 }],
      paidMinor: 25000,
      clientRef: 'shots-purchase-1'
    })
    return 'OK (clientRef=shots-purchase-1 idempotent)'
  })

  // --- وصفة + دفعة إنتاج 20كغ خبز أبيض (قبل البيع — assertStock يمنع البيع بمخزون صفر) ---
  await seedStep('recipes.create خبز أبيض 1kg ← 0.55 طحين + 0.02 سكر + 0.01 ملح', async () => {
    const recipes = await invoke<Array<{ id: number; name: string }>>('recipes.list', { includeInactive: true })
    if (recipes.some((r) => r.name === 'خبز أبيض قياسي')) return 'ALREADY_EXISTS'
    await invoke('recipes.create', {
      name: 'خبز أبيض قياسي',
      productId: await pid('خبز أبيض'),
      outputQtyMilli: 1000,
      items: [
        { productId: await pid('طحين'), qtyMilli: 550 },
        { productId: await pid('سكر'), qtyMilli: 20 },
        { productId: await pid('ملح'), qtyMilli: 10 }
      ]
    })
    return 'OK'
  })
  await seedStep('production.create batch 20kg خبز أبيض', async () => {
    const recipes = await invoke<Array<{ id: number; name: string }>>('recipes.list', {})
    const r = recipes.find((x) => x.name === 'خبز أبيض قياسي')
    if (!r) throw new Error('الوصفة خبز أبيض قياسي غير موجودة')
    // ملاحظة: wasteQtyMilli يُحذف كليًا — reqMilli يرفض 0 والخدمة تعامل غيابه كصفر
    await invoke('production.create', { recipeId: r.id, actualQtyMilli: 20000, clientRef: 'shots-batch-white-1' })
    return 'OK (clientRef=shots-batch-white-1 idempotent)'
  })
  // خبز أسمر: البيع النقدي المطلوب أدناه يفشل assertStock برصيد 0 → دفعة إنتاج صغيرة واقعية
  note('خبز أسمر has 0 stock (per spec) but the prescribed cash sale needs stock (assertStock, allow_negative_stock=0) → seeding a realistic 3kg batch via its own recipe')
  await seedStep('recipes.create خبز أسمر + production.create batch 3kg', async () => {
    const recipes = await invoke<Array<{ id: number; name: string }>>('recipes.list', { includeInactive: true })
    let r = recipes.find((x) => x.name === 'خبز أسمر قياسي')
    if (!r) {
      await invoke('recipes.create', {
        name: 'خبز أسمر قياسي',
        productId: await pid('خبز أسمر'),
        outputQtyMilli: 1000,
        items: [
          { productId: await pid('طحين'), qtyMilli: 550 },
          { productId: await pid('سكر'), qtyMilli: 20 },
          { productId: await pid('ملح'), qtyMilli: 10 }
        ]
      })
      r = (await invoke<Array<{ id: number; name: string }>>('recipes.list', {})).find((x) => x.name === 'خبز أسمر قياسي')
    }
    if (!r) throw new Error('تعذر تجهيز وصفة خبز أسمر')
    await invoke('production.create', { recipeId: r.id, actualQtyMilli: 3000, clientRef: 'shots-batch-brown-1' })
    return 'OK (clientRef=shots-batch-brown-1 idempotent)'
  })

  // --- عميل + بيع آجل 5كغ خبز أبيض + تحصيل جزئي ---
  await seedStep('customers.create مؤسسة الرزق', async () => {
    const list = await invoke<PartyLite[]>('customers.list', {})
    if (list.some((c) => c.name === 'مؤسسة الرزق')) return 'ALREADY_EXISTS'
    await invoke('customers.create', { name: 'مؤسسة الرزق', phone: '0599111222' })
    return 'OK'
  })
  let creditCustomerId = 0
  await seedStep('sales.create CREDIT خبز أبيض 5kg → مؤسسة الرزق', async () => {
    const cust = (await invoke<PartyLite[]>('customers.list', {})).find((c) => c.name === 'مؤسسة الرزق')
    if (!cust) throw new Error('العميل مؤسسة الرزق غير موجود')
    creditCustomerId = cust.id
    await invoke('sales.create', {
      items: [{ productId: await pid('خبز أبيض'), qtyMilli: 5000, unitPriceMinor: null, discountMinor: 0 }],
      customerId: cust.id,
      clientRef: 'shots-sale-credit-1'
    })
    return 'OK (auto unit price 500/kg → total 2500 minor, status CREDIT)'
  })
  await seedStep('customers.payment partial → مؤسسة الرزق', async () => {
    if (!creditCustomerId) {
      const cust = (await invoke<PartyLite[]>('customers.list', {})).find((c) => c.name === 'مؤسسة الرزق')
      if (!cust) throw new Error('العميل غير موجود')
      creditCustomerId = cust.id
    }
    // المطلوب حرفيًا 5000 أغورة لكن إجمالي الآجل 2500 فقط (5كغ × 500) — دفعة 5000 ليست "جزئية"
    // وتجعل الرصيد سالبًا؛ دفعنا 1000 (جزئية حقيقية تترك 1500 دينًا).
    await invoke('customers.payment', { customerId: creditCustomerId, amountMinor: 1000, method: 'CASH', note: 'دفعة جزئية' })
    return 'OK (1000 minor — spec said 5000 but credit total is only 2500)'
  })
  note('customers.payment amount: spec asked 5000 minor but the 5kg credit sale totals 2500 minor (5kg × 500) — paid 1000 minor to keep it a genuine PARTIAL payment')

  // --- بيع نقدي خبز أسمر 2كغ ---
  await seedStep('sales.create CASH خبز أسمر 2kg', async () => {
    await invoke('sales.create', {
      items: [{ productId: await pid('خبز أسمر'), qtyMilli: 2000, unitPriceMinor: null, discountMinor: 0 }],
      payments: [{ method: 'CASH', amountMinor: 1300 }],
      clientRef: 'shots-sale-brown-1'
    })
    return 'OK (2kg × 650 = 1300 minor)'
  })

  // --- مصروفات: غاز 8000 (متنوعة) + كهرباء 12000 (كهرباء وماء) ---
  await seedStep('expenses.create غاز 8000 + كهرباء 12000', async () => {
    let cats = await invoke<Array<{ id: number; name: string }>>('expenses.categories.list', {})
    const ensureCat = async (name: string): Promise<number> => {
      let c = cats.find((x) => x.name === name)
      if (!c) {
        await invoke('expenses.categories.create', { name })
        cats = await invoke<Array<{ id: number; name: string }>>('expenses.categories.list', {})
        c = cats.find((x) => x.name === name)
      }
      if (!c) throw new Error(`فئة المصروفات ${name} غير متوفرة`)
      return c.id
    }
    const gasCat = await ensureCat('متنوعة')
    await invoke('expenses.create', { categoryId: gasCat, amountMinor: 8000, note: 'غاز — أسطوانة' })
    const elecCat = await ensureCat('كهرباء وماء')
    await invoke('expenses.create', { categoryId: elecCat, amountMinor: 12000, note: 'فاتورة كهرباء' })
    return 'OK'
  })

  // --- هالك: طحين 0.5كغ سبب تلف ---
  await seedStep('inventory.waste طحين 500 (0.5kg) reason تلف', async () => {
    await invoke('inventory.waste', { productId: await pid('طحين'), qtyMilli: 500, reason: 'تلف' })
    return 'OK'
  })

  // --- توزيع: مندوب + خط + جولة تحميل 10كغ + بيع 6كغ نقدي + تسوية ---
  // (الأشكال مطابقة لـ src/main/services/distribution.ts: trips.load {tripId,productId,qtyMilli})
  await seedStep('distribution reps/routes/trips (أبو أحمد / خط الشمال)', async () => {
    const reps = await invoke<Array<{ id: number; name: string }>>('distribution.reps.list', {})
    let rep = reps.find((r) => r.name === 'أبو أحمد')
    if (!rep) await invoke('distribution.reps.create', { name: 'أبو أحمد' })
    rep = (await invoke<Array<{ id: number; name: string }>>('distribution.reps.list', {})).find((r) => r.name === 'أبو أحمد')
    if (!rep) throw new Error('تعذر تجهيز المندوب')

    const routes = await invoke<Array<{ id: number; name: string }>>('distribution.routes.list', {})
    let route = routes.find((r) => r.name === 'خط الشمال')
    if (!route) await invoke('distribution.routes.create', { name: 'خط الشمال' })
    route = (await invoke<Array<{ id: number; name: string }>>('distribution.routes.list', {})).find((r) => r.name === 'خط الشمال')
    if (!route) throw new Error('تعذر تجهيز الخط')

    const trips = await invoke<Array<{ id: number; trip_no: string; rep_id: number; status: string }>>('distribution.trips.list', {})
    let trip = trips.find((t) => t.rep_id === rep.id)
    if (!trip) {
      await invoke('distribution.trips.create', { repId: rep.id, routeId: route.id, notes: 'جولة تجريبية' })
      trip = (await invoke<Array<{ id: number; trip_no: string; rep_id: number; status: string }>>('distribution.trips.list', {})).find((t) => t.rep_id === rep.id)
    }
    if (!trip) throw new Error('تعذر تجهيز الجولة')

    const detail = await invoke<{ id: number; status: string; loads: unknown[]; sales: unknown[] }>('distribution.trips.get', { id: trip.id })
    if (detail.loads.length === 0) {
      await invoke('distribution.trips.load', { tripId: trip.id, productId: await pid('خبز أبيض'), qtyMilli: 10000 })
    }
    if (detail.sales.length === 0) {
      await invoke('distribution.trips.sale', {
        tripId: trip.id,
        items: [{ productId: await pid('خبز أبيض'), qtyMilli: 6000, unitPriceMinor: 500, paymentType: 'CASH' }]
      })
    }
    const after = await invoke<{ status: string }>('distribution.trips.get', { id: trip.id })
    if (after.status === 'OPEN') {
      await invoke('distribution.trips.settle', { tripId: trip.id, notes: 'تسوية جولة تجريبية' })
    }
    return 'OK (load 10kg → sale 6kg cash → settle)'
  })
}

// ---------- 2.5) بوابة جاهزية البذر + قراءة بطاقات اللوحة (Task V-2) ----------
/**
 * بوابة جاهزية البذر: نتحقق عبر IPC (نفس قناة الواجهة reports.dashboard) أن البذر
 * اكتمل فعلًا قبل التقاط أي شاشة. بعد seedData() يجب أن تكون هناك 3 فواتير اليوم
 * (آجل 2500 + نقدي أسمر 1300 + جولة توزيع 3000) = 6800 أغورة.
 * ملاحظة التشخيص: الواجهة نفسها قد تعرض أصفارًا قديمة لأنها ركّبت قبل البذر،
 * لذا الحكم يكون من القاعدة لا من الـ DOM.
 */
async function verifySeedSettled(): Promise<void> {
  let last: { count: number; minor: number; cash: number } | null = null
  for (let i = 0; i < 30; i++) {
    try {
      const d = await invoke<{ todaySalesCount: number; todaySalesMinor: number; cashBalanceMinor: number }>('reports.dashboard', {})
      last = { count: d.todaySalesCount, minor: d.todaySalesMinor, cash: d.cashBalanceMinor }
      if (d.todaySalesCount >= 3 && d.todaySalesMinor >= 6000) {
        log(`SEED_VERIFIED | reports.dashboard → todaySalesCount=${d.todaySalesCount} todaySalesMinor=${d.todaySalesMinor} cashBalanceMinor=${d.cashBalanceMinor} — البذر مكتمل قبل أي تنقل/لقطة`)
        return
      }
      log(`SEED_WAIT | todaySalesCount=${d.todaySalesCount} todaySalesMinor=${d.todaySalesMinor} — إعادة المحاولة ${i + 1}/30`)
    } catch (e) {
      log(`SEED_WAIT | reports.dashboard فشل (${String(e).slice(0, 120)}) — إعادة المحاولة ${i + 1}/30`)
    }
    await sleep(1000)
  }
  throw new Error('البذر لم يكتمل قبل بدء اللقطات — آخر قراءة reports.dashboard: ' + JSON.stringify(last))
}

/** انتظار بطاقات لوحة التحكم الحقيقية (بعد تحميل التقرير وزوال الهياكل) */
async function waitForDashboardCards(tries = 16): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const ok = (await evaluate(`document.querySelectorAll('.grid-cards .stat').length >= 4 && !document.querySelector('.skel')`)) === true
    if (ok) return true
    await sleep(500)
  }
  return false
}

/** قراءة بطاقات لوحة التحكم من الـ DOM وتسجيلها نصيًا — دليل مرافق للقطة دون فتح الصورة */
async function logDashboardKpis(tag: string): Promise<void> {
  try {
    const cards = (await evaluate(`Array.from(document.querySelectorAll('.grid-cards .stat')).map(c => ({
      label: (c.querySelector('.label')?.textContent ?? '').trim(),
      value: (c.querySelector('.value')?.textContent ?? '').trim()
    })).filter(c => c.label || c.value)`)) as Array<{ label: string; value: string }>
    for (const c of cards) log(`KPI[${tag}] | ${c.label} = ${c.value}`)
  } catch (e) { log('WARN | KPI read failed (' + tag + '): ' + String(e)) }
}

/** لقطة ختامية (Task V-2): العودة للوحة التحكم وإثبات الأرقام الحقيقية بعد البذر */
async function finalDashboardShot(): Promise<void> {
  await clickNav('لوحة التحكم')
  if (!(await waitForDashboardCards())) log('WARN | dashboard cards not detected before final shot')
  await sleep(700)
  await logDashboardKpis('21-dashboard-final')
  await shot('21-dashboard-final')
}

// ---------- 3) جولة لقطات كل الشاشات ----------
const SCREENS: Array<[string, string, string | null]> = [
  ['02-dashboard', 'لوحة التحكم', null],
  ['03-pos', 'نقطة البيع', '.pos-product'],
  ['04-products', 'المنتجات', 'table.data tbody tr'],
  ['05-inventory', 'المخزون', null],
  ['06-customers', 'العملاء', null],
  ['07-suppliers', 'الموردون', null],
  ['08-purchases', 'المشتريات', null],
  ['09-sales', 'المبيعات', 'table.data tbody tr'],
  ['10-production', 'الإنتاج', null],
  ['11-distribution', 'التوزيع', null],
  ['12-shifts', 'الورديات والصندوق', null],
  ['13-period', 'الجرد والإقفال', null],
  ['14-expenses', 'المصروفات', null],
  ['15-audit', 'سجل التدقيق', 'table.data tbody tr'],
  ['16-reports', 'التقارير', '.content table tbody tr'],
  ['17-settings', 'الإعدادات', null]
]

async function tourScreens(): Promise<void> {
  for (const [name, label, extraSel] of SCREENS) {
    await clickNav(label)
    const appeared = (await evaluate(`(document.querySelector('.content h1')?.textContent ?? '') !== '' || !!document.querySelector('.content .card, .content table, .content .stat, .content .empty, .content form')`)) === true
    if (extraSel) await waitFor(extraSel, 12)
    if (!appeared) log(`WARN | screen «${label}» content not detected before shot`)
    if (name === '02-dashboard') {
      // لوحة التحكم: ننتظر بطاقاتها الحقيقية ثم نقرأ أرقامها من الـ DOM قبل اللقطة
      if (!(await waitForDashboardCards())) log('WARN | dashboard cards not detected before 02-dashboard shot')
      await logDashboardKpis('02-dashboard')
    }
    await sleep(700)
    await shot(name)
  }
}

// ---------- 4) لقطات تفصيلية إضافية ----------
async function extraShots(): Promise<void> {
  // 18: نافذة ورقة جرد جديدة (نفس تدفق period-cdp.ts الحرفي)
  await clickNav('الجرد والإقفال')
  await sleep(400)
  try {
    const clicked = await clickButtonByText('ورقة جرد جديدة')
    if (clicked !== 'OK') throw new Error('زر «ورقة جرد جديدة» غير موجود')
    if (!(await waitFor('.modal input[type=month]', 10))) throw new Error('نافذة إنشاء الورقة لم تظهر')
    await sleep(400)
    await shot('18-period-count-modal')
    await clickButtonByText('إنشاء الورقة')
    const created = (await waitForText('أُنشئت ورقة الجرد', 10)) || (await waitForText('JC-', 6))
    log(`SEED | counts.create via UI (ورقة جرد جديدة → إنشاء الورقة) — ${created ? 'OK' : 'UNVERIFIED'}`)
    await sleep(700)
    await closeAllModals()
  } catch (e) {
    log('WARN | count-modal UI flow failed (' + String(e) + ') — shooting period screen state instead')
    await shot('18-period-count-modal')
  }

  // 19: نافذة منتج جديد من شاشة المنتجات
  await clickNav('المنتجات')
  await waitFor('table.data tbody tr', 10)
  await clickButtonByText('منتج جديد')
  if (await waitFor('.modal', 10)) {
    await sleep(400)
    await shot('19-new-product-modal')
    await closeAllModals()
  } else {
    log('WARN | new-product modal did not open — shooting products screen state')
    await shot('19-new-product-modal')
  }

  // 20: بيع نقدي من POS عبر نقرات حقيقية + التقاط toast «تم حفظ البيع»
  await clickNav('نقطة البيع')
  if (await waitFor('.pos-product', 12)) {
    const added = (await evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.pos-product')).find(b => b.textContent.includes('خبز أبيض'))
        ?? document.querySelector('.pos-product');
      if (!card) return 'NO_CARD';
      card.click(); return 'OK';
    })()`)) === 'OK'
    await sleep(400)
    if (added) {
      // الكمية 1 (الافتراضي عند الإضافة 1000 ميلي = 1) — نضبطها صراحة عبر محوّل React
      await evaluate(`(() => {
        const inp = document.querySelector('.cart tbody tr .qty-input');
        if (!inp) return 'NO_INPUT';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '1'); inp.dispatchEvent(new Event('input', {bubbles:true}));
        return 'OK';
      })()`)
      await sleep(300)
      await evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll('.content button')).find(b => b.textContent.includes('ترحيل الفاتورة'));
        if (btn) btn.click();
        return btn ? 'OK' : 'NO_BUTTON';
      })()`)
      // التقاط toast خلال 1.5 ثانية من الحفظ (poll كل 150ms)
      let toastSeen = false
      for (let i = 0; i < 10; i++) {
        toastSeen = (await evaluate(`Array.from(document.querySelectorAll('.toast-host .toast')).some(t => t.textContent.includes('تم حفظ البيع'))`)) === true
        if (toastSeen) break
        await sleep(150)
      }
      log(`SEED | POS cash sale via UI clicks (card → qty 1 → ترحيل الفاتورة) — toast «تم حفظ البيع» ${toastSeen ? 'CAPTURED' : 'NOT_SEEN'}`)
    } else {
      log('WARN | POS product card click failed')
    }
    await shot('20-pos-cash-save-toast')
    await sleep(800)
    await closeAllModals()
  } else {
    log('WARN | POS screen has no product cards — shooting current state')
    await shot('20-pos-cash-save-toast')
  }
}

// ---------- main ----------
async function main(): Promise<void> {
  await send('Page.enable')
  await send('Runtime.enable')
  // توحيد حجم العرض مع أدلة الويب (parity)
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(1500)

  await ensureSession()

  // جلسة CDP مستقلة عبر auth.login (قناة عامة)
  const login = await invoke<{ token: string }>('auth.login', { password: '1234' })
  TOKEN = login.token
  log(`SESSION | auth.login token acquired (${TOKEN.length} chars)`)

  await seedData()

  // بوابة V-2: البذر يجب أن يكتمل ويظهر في reports.dashboard قبل أي تنقل إلى أي شاشة
  await verifySeedSettled()

  // إعادة تركيب قسرية للوحة التحكم: النقر على نفس التبويب النشط لا يُعيد التصيير
  // (setTab بنفس القيمة) فتبقى الشاشة ببيانات ما قبل البذر — ننتقل لشاشة أخرى
  // أولًا ثم تبدأ الجولة بلوحة التحكم حديثة التركيب مع جلب reports.dashboard جديد.
  await clickNav('الإعدادات')
  await sleep(600)
  log('NAV | navigated away from dashboard → tour will remount DashboardScreen for a fresh reports.dashboard fetch')

  await tourScreens()
  await extraShots()
  await finalDashboardShot()
}

void (async () => {
  try {
    await connect(await getPageWs())
  } catch (e) {
    console.log('FATAL | app never became reachable: ' + String(e))
    process.exit(1)
  }
  try {
    await main()
  } catch (e) {
    console.log('FATAL | ' + String(e))
  }
  const errs = consoleErrors.filter((e) => !e.includes('Autofocus processing') && !e.includes('Download the React DevTools'))
  console.log(`CONSOLE_ERRORS | ${errs.length}${errs.length ? ' :: ' + errs.slice(0, 3).join(' || ') : ''}`)
  if (seedFails.length) console.log(`SEED_FAILED | ${seedFails.length} :: ${seedFails.join(' || ')}`)
  if (seedNotes.length) console.log(`NOTES | ${seedNotes.join(' || ')}`)
  console.log(`SUMMARY | SHOTS=${shotsTaken} ERRORS=${errs.length}`)
  process.exit(0)
})()

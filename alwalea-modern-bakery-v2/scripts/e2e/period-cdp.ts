// =============================================================
// اختبار CDP إلزامي — الجرد الشهري وإقفال الشهر (Task P1-E)
// يشغَّل: bun scripts/e2e/period-cdp.ts [debugPort]
// يتطلب تطبيقًا يعمل مع --remote-debugging-port وHOME معزول وXvfb
// (المشغّل الجاهز: scripts/e2e/run-period-e2e.sh)
// السيناريو: تهيئة → ورقة جرد (فرق مقصود) → اعتماد → تقرير فروق → بيع POS
// → إقفال الشهر → إلغاء مرفوض بالرسالة الحرفية → فك القفل → إلغاء ناجح
// → إعادة إقفال → سجل الشهور يظهر الشهر مقفلًا → لقطات period-*.png
// =============================================================
const PORT = Number(process.argv[2] ?? '9444')
const path = await import('node:path')
const fs = await import('node:fs')
const SHOT_DIR = process.env.E2E_SHOT_DIR ?? path.resolve(process.cwd(), '../release-evidence/electron-screens')

/** الرسالة الحرفية الإلزامية — يجب أن تظهر كاملة في واجهة المبيعات (بند قبول) */
const MONTH_LOCKED_MESSAGE = 'هذا الشهر مقفل. يلزم فك القفل بسبب مسجل في سجل التدقيق قبل أي تعديل.'

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

function fillReactTextarea(selector: string, value: string): string {
  const el = document.querySelector(selector) as HTMLTextAreaElement | null
  if (!el) return 'NO_TEXTAREA'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
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

/** استدعاء قناة IPC من سياق الـ renderer — نفس مسار الواجهة تمامًا */
async function invoke<T>(channel: string, payload: Record<string, unknown> = {}): Promise<T> {
  const full = TOKEN ? { token: TOKEN, ...payload } : { ...payload }
  return (await evaluate(`window.bakery.invoke(${JSON.stringify(channel)}, ${JSON.stringify(full)}).then(r => { if (!r.ok) throw new Error(r.error); return r.data })`)) as T
}

/** استدعاء متوقع الفشل — يعيد نص الخطأ من المغلف (نفس مسار الواجهة) */
async function invokeFail(channel: string, payload: Record<string, unknown> = {}): Promise<string> {
  const full = TOKEN ? { token: TOKEN, ...payload } : { ...payload }
  return (await evaluate(`window.bakery.invoke(${JSON.stringify(channel)}, ${JSON.stringify(full)}).then(r => r.ok ? 'UNEXPECTED_OK' : r.error)`)) as string
}

async function waitFor(selector: string, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) === true) return true
    await sleep(500)
  }
  return false
}

/** انتظار ظهور نص داخل محتوى الشاشة (بانرات/جداول) */
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

/** إغلاق كل النوافذ المفتوحة (زر إغلاق ثم mousedown على الغطاء) */
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

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** صف الشهر من جدول سجل الشهور (البطاقة الثانية) — مصفوفة خلايا (MONTH_KEY يُعرَّف قبل الاستدعاء) */
const periodRowCells = `(() => {
  const card = document.querySelectorAll('.card')[1];
  const row = Array.from(card?.querySelectorAll('table.data tbody tr') ?? []).find(r => r.textContent.includes(MONTH_KEY));
  return row ? Array.from(row.querySelectorAll('td')).map(td => td.textContent ?? '') : []
})()`

async function main(): Promise<void> {
  await send('Page.enable')
  await send('Runtime.enable')
  await sleep(1500)

  // ---------- 1) إعداد/دخول ----------
  check('E01 شاشة الإعداد الأولى ظهرت', await waitFor('.auth-card input', 40))
  await evaluate(`(${fillReactInput})('.auth-card input[placeholder*="مخبز"]', 'مخبز الولاء الحديث')`)
  await evaluate(`(${fillReactInput})('.auth-card input[placeholder="الاسم الكامل"]', 'صاحب المخبز')`)
  await evaluate(`(() => {
    const els = document.querySelectorAll('.auth-card input[type=password]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(els[0], '1234'); els[0].dispatchEvent(new Event('input', {bubbles:true}));
    setter.call(els[1], '1234'); els[1].dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await evaluate(`document.querySelector('.auth-card button.btn.primary')?.click()`)
  check('E02 الإعداد اكتمل ودخل الهيكل (وضع الحساب الواحد)', await waitFor('.app-shell .sidebar', 30))
  const login = await invoke<{ token: string }>('auth.login', { password: '1234' })
  TOKEN = login.token
  check('E02b جلسة CDP جاهزة عبر auth.login', TOKEN !== null && TOKEN.length > 10)

  // ---------- 2) تهيئة بيانات: منتج + رصيد افتتاحي + وردية ----------
  const cat = await invoke<{ id: number }>('categories.create', { name: 'مواد أساسية' })
  const flour = await invoke<{ id: number }>('products.create', { name: 'دقيق', categoryId: cat.id, type: 'RAW', baseUnit: 'كغ', priceMinor: 250, costMinor: 200, trackStock: true, minStockMilli: 10000 })
  check('E03 منتج «دقيق» أُنشئ بتكلفة 200 أغورة', flour.id > 0)
  await invoke('inventory.opening', { items: [{ productId: flour.id, qtyMilli: 100000, unitCostMinor: 200 }] })
  const bal0 = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'دقيق' }))[0]
  check('E03a رصيد افتتاحي 100 كغ سُجل', bal0.balance_milli === 100000, `balance=${bal0.balance_milli}`)
  await invoke('shifts.open', { openingCashMinor: 20000 })
  check('E03b وردية مفتوحة للنقدية', true)

  // ---------- الانتقال لشاشة الجرد والإقفال ----------
  await clickNav('الجرد والإقفال')
  const h1 = (await evaluate(`document.querySelector('.content h1')?.textContent ?? ''`)) as string
  check('E04 شاشة «الجرد والإقفال» ظهرت', h1.includes('الجرد والإقفال'), h1)
  const sections = (await evaluate(`document.querySelector('.content')?.textContent?.includes('الجرد الشهري') && document.querySelector('.content')?.textContent?.includes('إقفال الشهور')`)) as boolean
  check('E04a القسمان ظاهران (الجرد الشهري / إقفال الشهور)', sections === true)
  const monthVal = (await evaluate(`document.querySelector('.card input[type=month]')?.value ?? ''`)) as string
  check('E04b شهر الإقفال الافتراضي = الشهر الحالي', monthVal === currentMonth(), monthVal)
  await shot('period-01-screen')

  // ---------- 3) إنشاء ورقة جرد → حفظ فرق مقصود → اعتماد ----------
  await clickButtonByText('ورقة جرد جديدة')
  check('E05 نافذة إنشاء الورقة ظهرت', await waitFor('.modal input[type=month]'))
  await clickButtonByText('إنشاء الورقة')
  check('E05a إنشاء الورقة نجح (تنبيه + رقم JC- في الجدول)',
    (await waitForText('أُنشئت ورقة الجرد')) && (await waitForText('JC-')))
  const countNo = (await evaluate(`(document.querySelector('.content table.data tbody tr')?.textContent?.match(/JC-\\d{6}-\\d{4}/) ?? [''])[0]`)) as string
  check('E05b رقم الورقة بصيغة JC-YYYYMM-####', /^JC-\d{6}-\d{4}$/.test(countNo), countNo)
  await shot('period-02-count-created')

  await clickButtonByText('تفاصيل')
  check('E06 نافذة التفاصيل فتحت بالبنود', await waitFor('.modal table.data tbody tr'))
  const modalRows = (await evaluate(`document.querySelectorAll('.modal table.data tbody tr').length`)) as number
  check('E06a بند واحد للمنتج الوحيد', modalRows === 1, `rows=${modalRows}`)
  // حفظ كمية مجرودة بفرق مقصود: الدفتري 100 كغ → المجرود 99 كغ (فرق -1 كغ)
  await evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.modal table.data tbody tr')).find(r => r.textContent.includes('دقيق'));
    const inp = row?.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '99'); inp.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await clickButtonByText('حفظ الكميات')
  check('E07 حفظ الكمية المجرودة (99) نجح', await waitForText('حُفظت الكميات المجرودة'))
  await shot('period-03-count-filled')

  await clickButtonByText('اعتماد وترحيل الفروق')
  check('E07a نافذة تأكيد الاعتماد ظهرت', await waitForText('تأكيد الاعتماد'))
  await shot('period-04-approve-confirm')
  await clickButtonByText('تأكيد الاعتماد')
  check('E08 الاعتماد نجح وترحّل الفروق', await waitForText('اعتُمدت الورقة'))
  let approvedBadge = false
  for (let i = 0; i < 12; i++) {
    approvedBadge = (await evaluate(`Array.from(document.querySelectorAll('.modal')).some(m => m.textContent.includes('معتمدة'))`)) as boolean
    if (approvedBadge) break
    await sleep(500)
  }
  check('E08a حالة الورقة في التفاصيل = معتمدة', approvedBadge === true)

  // حركة التسوية الفعلية من الخادم
  const adj = await invoke<{ qty_milli: number; ref_type: string; ref_id: number; note: string }[]>('inventory.movements', { type: 'ADJUSTMENT' })
  const m = adj.find((x) => x.ref_type === 'StockCount' && x.qty_milli === -1000)
  check('E09 حركة ADJUSTMENT بفرق -1 كغ ومرجع StockCount', !!m, JSON.stringify(adj[0] ?? {}))
  check('E09a ملاحظة الحركة «جرد شهري {countNo}»', !!m && m.note.includes(`جرد شهري ${countNo}`), m?.note ?? '')
  await closeAllModals()

  // ---------- 4) تقرير الفروق ----------
  await clickButtonByText('تقرير الفروق')
  check('E10 تقرير الفروق فتح', await waitForText('تقرير فروق الجرد'))
  const varText = (await evaluate(`Array.from(document.querySelectorAll('.modal')).map(m => m.textContent).join(' ')`)) as string
  check('E10a الفرق -1 ظاهر بالتقرير', varText.includes('-1'), '')
  check('E10b قيمة الفرق -2000.00 (بالتكلفة) ظاهرة', varText.includes('-2000.00'), '')
  check('E10c الملخص: بند فرق واحد', varText.includes('بنود الفرق') && varText.includes('1'), '')
  await shot('period-05-variance')
  await closeAllModals()

  // ---------- 5) فاتورة بيع من شاشة POS ----------
  await clickNav('نقطة البيع')
  await evaluate(`(${fillReactInput})('.content input[placeholder*="بحث سريع"]', 'دقيق')`)
  await sleep(500)
  await evaluate(`document.querySelector('.pos-product')?.click()`)
  await sleep(400)
  await evaluate(`(() => {
    const inp = document.querySelector('.cart tbody tr .qty-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '2'); inp.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await sleep(300)
  await clickButtonByText('ترحيل الفاتورة')
  check('E11 بيع نقدي 2 كغ من واجهة POS', await waitForText('تم ترحيل الفاتورة'))
  await sleep(600)
  await closeAllModals()
  const sales = await invoke<{ id: number; status: string; date: string }[]>('sales.list')
  check('E11a الفاتورة مسجلة وغير ملغاة', sales.length === 1 && sales[0].status !== 'CANCELLED', JSON.stringify(sales))
  const saleId = sales[0]?.id ?? 0
  const flourBalAfterSale = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'دقيق' }))[0]
  // 100 − 1 (اعتماد الجرد) − 2 (بيع) = 97 كغ
  check('E11b الرصيد يعكس تسوية الجرد والبيع (97 كغ)', flourBalAfterSale.balance_milli === 97000, `balance=${flourBalAfterSale.balance_milli}`)
  await shot('period-06-pos-sale')

  // ---------- 6) إقفال الشهر الحالي من الشاشة ----------
  await clickNav('الجرد والإقفال')
  await clickButtonByText('إقفال الشهر')
  check('E12 نافذة تأكيد الإقفال ظهرت', await waitForText('تأكيد الإقفال'))
  await shot('period-07-close-confirm')
  await clickButtonByText('تأكيد الإقفال')
  check('E12a الإقفال نجح (تنبيه + شارة مقفل)', await waitForText('أُقفل الشهر'))
  await evaluate(`const MONTH_KEY = ${JSON.stringify(currentMonth())}`)
  const lockedRow = (await evaluate(periodRowCells)) as string[]
  check('E12b سجل الشهور يظهر الشهر الحالي مقفلًا', lockedRow.some((c) => c.includes('مقفل')), JSON.stringify(lockedRow))
  await shot('period-08-month-closed')

  // ---------- 7) محاولة إلغاء الفاتورة → الرسالة الحرفية ----------
  await clickNav('المبيعات')
  await clickButtonByText('إلغاء')
  check('E13 نافذة إلغاء الفاتورة ظهرت', await waitFor('.modal textarea'))
  await evaluate(`(${fillReactTextarea})('.modal textarea', 'اختبار حاجز الشهر المقفل')`)
  await clickButtonByText('تأكيد الإلغاء')
  await sleep(1200)
  const banners = (await evaluate(`Array.from(document.querySelectorAll('.banner.error')).map(b => b.textContent)`)) as string[]
  check('E13 محاولة الإلغاء رُفضت برسالة الحاجز الحرفية كاملة', banners.some((b) => b.includes(MONTH_LOCKED_MESSAGE)), (banners.find((b) => b.includes('مقفل')) ?? banners[0] ?? '').slice(0, 160))
  await shot('period-09-barrier-message')
  // تحقق مزدوج من الخدمة مباشرة: نفس الرسالة من المغلف
  const apiErr = await invokeFail('sales.cancel', { id: saleId, reason: 'اختبار حاجز مباشر' })
  check('E13a المغلف IPC يعيد الرسالة الحرفية نفسها', apiErr === MONTH_LOCKED_MESSAGE, apiErr.slice(0, 160))
  // تأكد عدم حدوث إلغاء فعلي
  const salesStill = await invoke<{ status: string }[]>('sales.list')
  check('E13b الفاتورة لم تُلغَ فعليًا', salesStill.length === 1 && salesStill[0].status !== 'CANCELLED')
  await closeAllModals()

  // ---------- 8) فك القفل بسبب من الشاشة → إعادة الإلغاء تنجح ----------
  await clickNav('الجرد والإقفال')
  await clickButtonByText('فك القفل')
  check('E14 نافذة فك القفل ظهرت والسبب إلزامي', await waitFor('.modal textarea'))
  const disabledEmpty = (await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent.includes('تأكيد فك القفل'));
    return btn ? btn.disabled : 'NO_BTN'
  })()`)) as boolean | string
  check('E14a زر التأكيد معطّل قبل إدخال السبب', disabledEmpty === true, String(disabledEmpty))
  await evaluate(`(${fillReactTextarea})('.modal textarea', 'تصحيح فاتورة بيع أُنشئت أثناء اختبار الإقفال')`)
  const disabledFilled = (await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent.includes('تأكيد فك القفل'));
    return btn ? btn.disabled : 'NO_BTN'
  })()`)) as boolean | string
  check('E14b زر التأكيد فُعّل بعد سبب ≥ 3 أحرف', disabledFilled === false, String(disabledFilled))
  await shot('period-10-unlock-reason')
  await clickButtonByText('تأكيد فك القفل')
  check('E15 فك القفل نجح (تنبيه + شارة مفتوح + السبب بالسجل)',
    (await waitForText('فُك قفل الشهر')) && (await waitForText('تصحيح فاتورة بيع')))
  await closeAllModals()

  await clickNav('المبيعات')
  await clickButtonByText('إلغاء')
  check('E15a نافذة الإلغاء ظهرت مجددًا', await waitFor('.modal textarea'))
  await evaluate(`(${fillReactTextarea})('.modal textarea', 'إلغاء فعلي بعد فك قفل الشهر')`)
  await clickButtonByText('تأكيد الإلغاء')
  check('E16 الإلغاء نجح بعد فك القفل', await waitForText('تم إلغاء الفاتورة'))
  const salesAfter = await invoke<{ status: string; credit_minor: number }[]>('sales.list')
  check('E16a حالة الفاتورة = CANCELLED', salesAfter.length === 1 && salesAfter[0].status === 'CANCELLED', JSON.stringify(salesAfter))
  const flourBalFinal = (await invoke<{ balance_milli: number }[]>('inventory.balances', { q: 'دقيق' }))[0]
  // ردّ البيع للمخزون: 97 + 2 = 99 كغ
  check('E16b ردّ كميات الفاتورة للمخزون (99 كغ)', flourBalFinal.balance_milli === 99000, `balance=${flourBalFinal.balance_milli}`)
  await shot('period-11-cancel-success')
  await closeAllModals()

  // ---------- 9) إعادة الإقفال → سجل الشهور يظهر الشهر مقفلًا ----------
  await clickNav('الجرد والإقفال')
  await clickButtonByText('إقفال الشهر')
  await waitForText('تأكيد الإقفال')
  await clickButtonByText('تأكيد الإقفال')
  check('E17 إعادة الإقفال نجحت', await waitForText('أُقفل الشهر'))
  const reClosedRow = (await evaluate(periodRowCells)) as string[]
  check('E17a سجل الشهور: الشهر مقفل بعد الإعادة', reClosedRow.some((c) => c.includes('مقفل')), JSON.stringify(reClosedRow))
  check('E17b عدد مرات الإقفال = 2', reClosedRow.some((c) => c.trim() === '2'), JSON.stringify(reClosedRow))
  await shot('period-12-reclosed')

  const audit = await invoke<{ action: string; details: string }[]>('audit.list')
  const unlockEntry = audit.find((a) => a.action === 'MONTH_UNLOCK')
  check('E18 سجل التدقيق يحوي MONTH_UNLOCK بالسبب', !!unlockEntry && (unlockEntry.details ?? '').includes('تصحيح فاتورة بيع'), unlockEntry?.details?.slice(0, 120) ?? 'NO_ENTRY')
  const closeEntries = audit.filter((a) => a.action === 'MONTH_CLOSE')
  check('E18a سجل التدقيق يحوي إقفالين MONTH_CLOSE', closeEntries.length === 2, `count=${closeEntries.length}`)
}

void (async () => {
  await connect(await getPageWs())
  await main()
  const errs = consoleErrors.filter((e) => !e.includes('Autofocus processing') && !e.includes('Download the React DevTools'))
  console.log(`CONSOLE_ERRORS | ${errs.length}${errs.length ? ' :: ' + errs.slice(0, 3).join(' || ') : ''}`)
  console.log(`SUMMARY | PASS=${passed} FAIL=${failed}`)
  process.exit(failed > 0 || errs.length > 0 ? 1 : 0)
})().catch((e) => {
  console.log('FATAL | ' + String(e))
  console.log(`SUMMARY | PASS=${passed} FAIL=${failed + 1}`)
  process.exit(1)
})

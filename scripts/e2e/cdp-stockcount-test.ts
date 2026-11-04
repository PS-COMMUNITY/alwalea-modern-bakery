// =============================================================
// اختبار CDP: الجرد الشهري + إقفال الشهر + تقرير الفروق + CSV — مخبز الولاء الحديث
// يشغَّل: bun scripts/e2e/cdp-stockcount-test.ts [debugPort=9222]
// يتطلب تطبيقًا يعمل مع --remote-debugging-port=<port> وHOME معزول (قاعدة جديدة → معالج خطوتين).
// يغطي عبر الواجهة الحقيقية: فتح جرد بلقطة، تعديل فعلي وسبب، حفظ مسودة، اعتماد،
// إقفال الشهر، ظهور حالة المقفل (زر فك القفل + تعطيل الفتح)، تقرير الفروق، زر CSV، صفر أخطاء.
// =============================================================
const PORT = Number(process.argv[2] ?? '9222')
const SHOT_DIR = process.env.CDP_SHOT_DIR ?? '/tmp/e2e-shots-mc'
const fs = await import('node:fs')

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

function connect(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url)
    ws.onopen = () => resolve()
    ws.onerror = (e) => reject(new Error('ws: ' + String(e)))
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } }
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)) } }, 15000)
  })
}

async function evaluate(expr: string): Promise<unknown> {
  const r = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })) as { result: { value: unknown } }
  return r.result.value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log(`PASS | ${name}${extra ? ' | ' + extra : ''}`) }
  else { fail++; console.log(`FAIL | ${name}${extra ? ' | ' + extra : ''}`); process.exitCode = 1 }
}

async function waitFor(expr: string, tries = 24): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (String(await evaluate(expr)) === 'true') return true
    await sleep(500)
  }
  return false
}

async function shot(name: string): Promise<void> {
  try {
    const r = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string }
    fs.writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(r.data, 'base64'))
  } catch { /* لقطة اختيارية */ }
}

function fillReactInput(selector: string, value: string): string {
  const el = document.querySelector(selector) as HTMLInputElement | null
  if (!el) return 'NO_INPUT'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return 'OK'
}

function fillReactSelect(selector: string, value: string): string {
  const el = document.querySelector(selector) as HTMLSelectElement | null
  if (!el) return 'NO_SELECT'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  setter!.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return 'OK'
}

function clickButtonByText(text: string): string {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent && x.textContent.includes(text))
  if (!b) return 'NO_BUTTON'
  b.click()
  return 'OK'
}

async function main(): Promise<void> {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  await connect(await getPageWs())
  await send('Page.enable')
  await send('Runtime.enable')
  await sleep(1500)

  // ===== 1) معالج الإعداد (قاعدة معزولة جديدة) — خطوتان =====
  check('MC01 معالج الإعداد ظهر', await waitFor(`!!document.querySelector('.auth-card input')`, 40))
  await evaluate(`(${fillReactInput})('.auth-card input[placeholder*="مخبز"]', 'مخبز اختبار الجرد CDP')`)
  await evaluate(`(${fillReactInput})('.auth-card input[placeholder="الاسم الكامل"]', 'صاحب المخبز')`)
  await evaluate(`(() => {
    const els = document.querySelectorAll('.auth-card input[type=password]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(els[0], '1234'); els[0].dispatchEvent(new Event('input', {bubbles:true}));
    setter.call(els[1], '1234'); els[1].dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await evaluate(`document.querySelector('.auth-card button.btn.primary')?.click()`)
  check('MC02 الخطوة 2 ظهرت (المنتجات الأساسية)', await waitFor(`Array.from(document.querySelectorAll('.auth-card button')).some(b => b.textContent.includes('متابعة وإنشاء النشاط'))`))
  await evaluate(`Array.from(document.querySelectorAll('.auth-card button')).find(b => b.textContent.includes('متابعة وإنشاء النشاط'))?.click()`)
  check('MC03 اكتمل الإعداد ودخل الهيكل', await waitFor(`!!document.querySelector('.app-shell .sidebar')`, 30))

  // التقاط أخطاء الوندو من هنا حتى النهاية
  await evaluate(`window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message)))`)

  // ===== 2) فتح شاشة الجرد الشهري =====
  await evaluate(`(${clickButtonByText})('جرد شهري')`)
  check('MC04 شاشة الجرد الشهري فُتحت', await waitFor(`(document.querySelector('.content h1')?.textContent ?? '').includes('الجرد الشهري')`))

  // الشهر الحالي قيمته الافتراضية — انقر فتح الجرد
  await evaluate(`(${clickButtonByText})('فتح/تحميل الجرد')`)
  check('MC05 فُتح جرد الشهر الحالي بلقطة أرصدة', await waitFor(`document.querySelectorAll('table.data tbody tr').length >= 1`))
  const rowCount = Number(await evaluate(`document.querySelectorAll('table.data tbody tr').length`))
  check('MC06 بنود الجرد = منتجات المعالج المتتبعة', rowCount >= 5, `rows=${rowCount}`)
  await shot('mc-01-count-open')

  // ===== 3) تعديل فعلي + سبب ثم حفظ المسودة =====
  const setQty = await evaluate(`(${fillReactInput})('table.data tbody tr:first-child td:nth-child(3) input', '5')`)
  check('MC07 إدخال كمية فعلية 5 لأول بند', setQty === 'OK')
  const setReason = await evaluate(`(${fillReactSelect})('table.data tbody tr:first-child td:nth-child(5) select', 'هالك')`)
  check('MC08 اختيار سبب «هالك»', setReason === 'OK')
  await evaluate(`(${clickButtonByText})('حفظ المسودة')`)
  check('MC09 حفظ المسودة نجح', await waitFor(`document.body.textContent.includes('تم حفظ المسودة')`))

  // ===== 4) اعتماد الجرد (نافذة تأكيد) =====
  await evaluate(`(${clickButtonByText})('اعتماد الجرد ✓')`)
  check('MC10 نافذة تأكيد الاعتماد ظهرت', await waitFor(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('تأكيد الاعتماد'))`))
  await shot('mc-02-approve-modal')
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('تأكيد الاعتماد'))?.click()`)
  check('MC11 اعتماد الجرد أنشأ حركات موثقة', await waitFor(`document.body.textContent.includes('تم اعتماد الجرد')`))

  // ===== 5) إقفال الشهر (نافذة تأكيد) =====
  await evaluate(`(${clickButtonByText})('إقفال الشهر 🔒')`)
  check('MC12 نافذة تأكيد الإقفال ظهرت', await waitFor(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('تأكيد الإقفال'))`))
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('تأكيد الإقفال'))?.click()`)
  check('MC13 الإقفال نجح بالرسالة', await waitFor(`document.body.textContent.includes('تم إقفال الشهر')`))

  // حالة المقفل: زر فك القفل ظهر وزر الفتح عطّل/اختفى
  check('MC14 زر «فك القفل 🔓» ظهر بعد الإقفال', await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.textContent ?? '').includes('فك القفل 🔓'))`))
  const openBtnState = String(await evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent ?? '').includes('فتح/تحميل الجرد'))
    return b ? (b.disabled ? 'DISABLED' : 'ENABLED') : 'GONE'
  })()`))
  check('MC15 زر الفتح معطل أو مختفٍ بعد الإقفال', openBtnState === 'DISABLED' || openBtnState === 'GONE', openBtnState)
  await shot('mc-03-locked')

  // ===== 6) تقرير الفروق + CSV من شاشة التقارير =====
  await evaluate(`(${clickButtonByText})('التقارير')`)
  check('MC16 شاشة التقارير فُتحت', await waitFor(`(document.querySelector('.content h1')?.textContent ?? '').includes('التقارير')`))
  await evaluate(`(${clickButtonByText})('فروق الجرد')`)
  const month = await evaluate(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') })()`)
  await evaluate(`(${fillReactInput})('#rep-month', '${month}')`)
  await evaluate(`(${clickButtonByText})('عرض التقرير')`)
  check('MC17 تقرير الفروق يعرض بنودًا', await waitFor(`document.querySelectorAll('table.data tbody tr').length >= 1`))
  const varianceRows = Number(await evaluate(`document.querySelectorAll('table.data tbody tr').length`))
  check('MC18 بند الفرق المعتمد ظاهر في التقرير', varianceRows >= 1, `rows=${varianceRows}`)
  const hasCsv = String(await evaluate(`Array.from(document.querySelectorAll('button')).some(b => (b.textContent ?? '').includes('تصدير CSV'))`))
  check('MC19 زر تصدير CSV موجود لتقرير الفروق', hasCsv === 'true')
  await shot('mc-04-variance-report')

  // ===== 7) صفر أخطاء وندو =====
  const errs = (await evaluate(`(window.__errs ?? []).length`)) as number
  check('MC20 صفر أخطاء JavaScript أثناء السيناريو', errs === 0, `errors=${errs}`)

  console.log('----------------------------------------')
  console.log(`TOTAL_PASS=${pass} TOTAL_FAIL=${fail}`)
  console.log(fail === 0 ? 'CDP-STOCKCOUNT: ALL PASS' : 'CDP-STOCKCOUNT: FAILURES PRESENT')
  ws?.close()
  process.exit(fail === 0 ? 0 : 1)
}

void main().catch((e) => { console.log('FAIL | استثناء: ' + String(e)); process.exit(1) })

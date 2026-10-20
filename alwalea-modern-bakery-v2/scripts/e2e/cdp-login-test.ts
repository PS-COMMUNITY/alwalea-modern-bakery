// اختبار CDP لواجهة تسجيل الدخول في تطبيق Electron — مخبز الولاء الحديث
// يشغَّل: bun scripts/e2e/cdp-login-test.ts <خطوة: wrong|correct>
// يتطلب تطبيقًا يعمل مع --remote-debugging-port=9222
const PORT = 9222

interface CdpTarget { webSocketDebuggerUrl: string; type: string; title: string }

async function getPageWs(): Promise<string> {
  for (let i = 0; i < 30; i++) {
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
    ws.onerror = (e) => reject(new Error('ws error: ' + String(e)))
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
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)) }
    }, 15000)
  })
}

async function evaluate(expr: string): Promise<unknown> {
  const r = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })) as { result: { value: unknown } }
  return r.result.value
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** تعبئة حقل React مُتحكَّم به وتحريك الأحداث */
function fillReactInput(selector: string, value: string): string {
  const el = document.querySelector(selector) as HTMLInputElement | null
  if (!el) return 'NO_INPUT'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return 'OK'
}

async function main(): Promise<void> {
  const step = process.argv[2] ?? 'wrong'
  await connect(await getPageWs())
  await send('Runtime.enable')
  await sleep(1500)

  // انتظار شاشة الدخول
  let hasInput = ''
  for (let i = 0; i < 20; i++) {
    hasInput = String(await evaluate(`!!document.querySelector('.auth-card input')`))
    if (hasInput === 'true') break
    await sleep(500)
  }
  if (hasInput !== 'true') { console.log('FAIL | شاشة الدخول لم تظهر'); process.exit(1) }
  console.log('PASS | شاشة الدخول ظهرت')

  const bizName = String(await evaluate(`document.querySelector('.biz-name')?.textContent ?? ''`))
  console.log((bizName.includes('مخبز') ? 'PASS' : 'WARN') + ` | اسم النشاط: ${bizName}`)

  if (step === 'wrong') {
    await evaluate(`(${fillReactInput})('.auth-card input', '9999')`)
    await evaluate(`document.querySelector('.auth-card form button[type=submit], .auth-card button.btn')?.click()`)
    await sleep(1200)
    const err = String(await evaluate(`document.querySelector('.banner.err, .auth-card [class*=err], .auth-card .banner')?.textContent ?? ''`))
    if (err.includes('غير صحيحة')) { console.log('PASS | رسالة الخطأ العربية: ' + err.trim()); process.exit(0) }
    console.log('FAIL | لم تظهر رسالة الخطأ. النص: ' + err)
    process.exit(1)
  }

  if (step === 'correct') {
    await evaluate(`(${fillReactInput})('.auth-card input', '1234')`)
    await evaluate(`document.querySelector('.auth-card form button[type=submit], .auth-card button.btn')?.click()`)
    // انتظار ظهور الهيكل (القائمة الجانبية)
    for (let i = 0; i < 20; i++) {
      const shell = String(await evaluate(`!!document.querySelector('.app-shell .sidebar')`))
      if (shell === 'true') {
        const nav = String(await evaluate(`Array.from(document.querySelectorAll('.nav-item')).map(b => b.textContent.trim()).join(' | ')`))
        console.log('PASS | دخول 1234 فتح الهيكل — القائمة: ' + nav)
        process.exit(0)
      }
      await sleep(500)
    }
    const err = String(await evaluate(`document.querySelector('.banner')?.textContent ?? ''`))
    console.log('FAIL | الهيكل لم يظهر بعد الدخول. بانر: ' + err)
    process.exit(1)
  }
}

void main().catch((e) => { console.log('FAIL | ' + String(e)); process.exit(1) })

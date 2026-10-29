// اختبار CDP شامل: شاشة الإعدادات وتغيير كلمة المرور عبر الواجهة الحقيقية
// يشغَّل: bun scripts/e2e/cdp-settings-test.ts — يتطلب تطبيقًا يعمل مع --remote-debugging-port=9222
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
  throw new Error('لا هدف CDP')
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

function fillReactInput(selector: string, value: string): string {
  const el = document.querySelector(selector) as HTMLInputElement | null
  if (!el) return 'NO_INPUT'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return 'OK'
}

function check(name: string, cond: boolean, extra = ''): void {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) process.exitCode = 1
}

async function waitFor(expr: string, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (String(await evaluate(expr)) === 'true') return true
    await sleep(500)
  }
  return false
}

async function login(password: string): Promise<boolean> {
  if (!(await waitFor(`!!document.querySelector('.auth-card input')`))) return false
  await evaluate(`(${fillReactInput})('.auth-card input', '${password}')`)
  await evaluate(`document.querySelector('.auth-card form button[type=submit], .auth-card button.btn')?.click()`)
  return waitFor(`!!document.querySelector('.app-shell .sidebar')`)
}

async function logout(): Promise<void> {
  await evaluate(`Array.from(document.querySelectorAll('.user-box button')).find(b => b.textContent.includes('تسجيل الخروج'))?.click()`)
  await waitFor(`!!document.querySelector('.auth-card input')`)
}

async function main(): Promise<void> {
  await connect(await getPageWs())
  await send('Runtime.enable')
  await sleep(1500)

  // دخول بـ1234
  check('دخول أولي بـ1234', await login('1234'))

  // فتح شاشة الإعدادات
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.includes('الإعدادات'))?.click()`)
  await sleep(600)
  const heading = String(await evaluate(`document.querySelector('.content h1')?.textContent ?? ''`))
  check('شاشة الإعدادات فُتحت', heading.includes('الإعدادات'), heading)
  // rc.8: العدّ يخص بطاقة كلمة المرور فقط (أول .card) — بطاقة النسخ الاحتياطي فيها حقل ملاحظة مستقل
  const fields = Number(await evaluate(`document.querySelector('.card')?.querySelectorAll('input').length ?? 0`))
  check('ثلاثة حقول كلمة مرور', fields === 3, `fields=${fields}`)

  // تغيير 1234 → 4455 عبر الواجهة
  await evaluate(`(${fillReactInput})('.card input:nth-of-type(1)', '')`)
  const inputs = await evaluate(`
    (() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const card = document.querySelector('.card')
      const els = card ? card.querySelectorAll('input') : []
      const vals = ['1234', '4455', '4455']
      els.forEach((el, i) => { setter.call(el, vals[i]); el.dispatchEvent(new Event('input', { bubbles: true })) })
      return els.length
    })()
  `)
  check('تعبئة الحقول الثلاثة', Number(inputs) === 3)
  await evaluate(`Array.from(document.querySelectorAll('.card button')).find(b => b.textContent.includes('تغيير كلمة المرور'))?.click()`)
  await sleep(1000)
  const banner = String(await evaluate(`document.querySelector('.banner')?.textContent ?? ''`))
  check('تغيير كلمة المرور من الواجهة نجح', banner.includes('تم تغيير'), banner)

  // خروج ثم محاولة الدخول بالقديمة (يجب أن تفشل) ثم بالجديدة (ينجح)
  await logout()
  check('خروج يعيد شاشة الدخول', String(await evaluate(`!!document.querySelector('.auth-card input')`)) === 'true')
  await evaluate(`(${fillReactInput})('.auth-card input', '1234')`)
  await evaluate(`document.querySelector('.auth-card form button[type=submit], .auth-card button.btn')?.click()`)
  await sleep(1200)
  const err = String(await evaluate(`document.querySelector('.banner')?.textContent ?? ''`))
  check('القديمة 1234 مرفوضة بعد التغيير', err.includes('غير صحيحة'), err)

  check('دخول بالجديدة 4455', await login('4455'))

  // استعادة 1234 عبر الواجهة
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.includes('الإعدادات'))?.click()`)
  await sleep(600)
  await evaluate(`
    (() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const els = document.querySelectorAll('.card input')
      const vals = ['4455', '1234', '1234']
      els.forEach((el, i) => { setter.call(el, vals[i]); el.dispatchEvent(new Event('input', { bubbles: true })) })
      return els.length
    })()
  `)
  await evaluate(`Array.from(document.querySelectorAll('.card button')).find(b => b.textContent.includes('تغيير كلمة المرور'))?.click()`)
  await sleep(1000)
  const banner2 = String(await evaluate(`document.querySelector('.banner')?.textContent ?? ''`))
  check('استعادة 1234 نجحت', banner2.includes('تم تغيير'), banner2)

  await logout()
  check('دخول ختامي بـ1234', await login('1234'))

  console.log('=== انتهى اختبار الإعدادات E2E ===')
  ws?.close()
  process.exit(process.exitCode ?? 0)
}

void main().catch((e) => { console.log('FAIL | استثناء: ' + String(e)); process.exit(1) })

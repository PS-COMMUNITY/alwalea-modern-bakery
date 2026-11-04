// =============================================================
// فحص سريع للقائمة الجانبية على شاشة قصيرة (لابتوب 1366×768)
// يشغَّل: bun scripts/e2e/sidebar-check.ts <debugPort>
// يتطلب تطبيقًا يعمل مع --remote-debugging-port وHOME معزول وXvfb 1366x768.
// يثبت: «الإعدادات» مرئية وقابلة للنقر دون تمرير يدوي، والتمرير الداخلي يعمل.
// =============================================================
const PORT = Number(process.argv[2] ?? '9335')

interface CdpTarget { webSocketDebuggerUrl: string; type: string }

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
  throw new Error('لا يوجد هدف CDP')
}

let ws: WebSocket | null = null
let msgId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const consoleErrors: string[] = []

function connect(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url)
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('ws error'))
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number; result?: unknown; error?: { message: string }
        method?: string; params?: { type?: string; args?: Array<{ value?: unknown; description?: string }> }
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)
        if (text && !text.includes('Electron Security Warning')) consoleErrors.push(text)
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)) } }, 20000)
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

async function waitFor(expr: string, timeoutMs = 15000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (Boolean(await evaluate(expr))) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

const fillReactInput = `(function(selector, value){
  const el = document.querySelector(selector)
  if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})`

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = ''): void {
  if (ok) { pass++; console.log(`PASS | ${name}${extra ? ' | ' + extra : ''}`) }
  else { fail++; console.log(`FAIL | ${name}${extra ? ' | ' + extra : ''}`) }
}

// ---------- تشغيل ----------
await connect(await getPageWs())
await send('Runtime.enable')
await send('Page.enable')

// انتظر أي شاشة (إعداد أو دخول أو واجهة)
await waitFor(`!!document.querySelector('.auth-card, .app-shell')`, 30000)

// إعداد أول مرة إن لزم
if (await evaluate(`!!document.querySelector('.center-screen .auth-card input[placeholder^="مثال"]')`)) {
  await evaluate(`(${fillReactInput})('.auth-card input:nth-of-type(1)', 'مخبز الولاء الحديث')`)
  const r = await evaluate(`(function(){
    const els = document.querySelectorAll('.auth-card input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const vals = ['مخبز الولاء الحديث', 'صاحب المخبز', '1234', '1234']
    let i = 0
    els.forEach((el) => { setter.call(el, vals[i++]); el.dispatchEvent(new Event('input', { bubbles: true })) })
    return els.length
  })()`)
  check('حقول الإعداد الأربعة', Number(r) === 4, 'count=' + String(r))
  await evaluate(`Array.from(document.querySelectorAll('.auth-card button')).find(b => b.textContent.includes('إنشاء'))?.click()`)
  check('دخول الواجهة بعد الإعداد', await waitFor(`!!document.querySelector('.app-shell .sidebar')`, 25000))
} else {
  await evaluate(`(${fillReactInput})('.auth-card input', '1234')`)
  await evaluate(`document.querySelector('.auth-card form button[type=submit], .auth-card button.btn')?.click()`)
  check('دخول بالكلمة الموجودة', await waitFor(`!!document.querySelector('.app-shell .sidebar')`, 25000))
}

await new Promise((r) => setTimeout(r, 800))

// ---------- قياسات القائمة الجانبية على 768px ----------
const m = await evaluate(`(function(){
  const sc = document.querySelector('.sidebar .nav-scroll')
  const items = Array.from(document.querySelectorAll('.sidebar .nav-item'))
  const st = items.find(b => b.textContent.includes('الإعدادات'))
  const ub = document.querySelector('.sidebar .user-box')
  const vh = window.innerHeight
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } }
  return {
    hasScrollArea: !!sc,
    itemCount: items.length,
    settings: st ? rect(st) : null,
    settingsText: st ? st.textContent.trim() : null,
    userBox: ub ? rect(ub) : null,
    viewportH: vh,
    scrollNeeded: sc ? sc.scrollHeight > sc.clientHeight : null,
    scrollable: sc ? (function(){ const before = sc.scrollTop; sc.scrollTop = sc.scrollHeight; const after = sc.scrollTop; sc.scrollTop = before; return after > 0 || sc.scrollHeight <= sc.clientHeight })() : null
  }
})()`) as Record<string, unknown>

const M = m as { hasScrollArea: boolean; itemCount: number; settings: { top: number; bottom: number } | null; settingsText: string | null; userBox: { bottom: number } | null; viewportH: number; scrollNeeded: boolean; scrollable: boolean }
check('منطقة تنقّل داخلية موجودة', M.hasScrollArea)
check('عدد أصناف القائمة 16', M.itemCount === 16, 'count=' + String(M.itemCount))
check('«الإعدادات» ضمن الشاشة (بدون تمرير)', !!M.settings && M.settings.top >= 0 && M.settings.bottom <= M.viewportH,
  M.settings ? `top=${M.settings.top} bottom=${M.settings.bottom} vh=${M.viewportH}` : 'missing')
check('صندوق المستخدم ضمن الشاشة', !!M.userBox && M.userBox.bottom <= M.viewportH)
check('التمرير الداخلي يعمل عند الحاجة', M.scrollable === true, `scrollNeeded=${String(M.scrollNeeded)}`)

// انقر «الإعدادات» فعلياً وتأكد من فتح الشاشة
await evaluate(`Array.from(document.querySelectorAll('.sidebar .nav-item')).find(b => b.textContent.includes('الإعدادات'))?.click()`)
await new Promise((r) => setTimeout(r, 600))
const heading = String(await evaluate(`document.querySelector('.content h1')?.textContent ?? ''`))
check('فتح شاشة الإعدادات بالنقر', heading.length > 0, 'h1=' + heading.slice(0, 40))

// لقطة شاشة
await send('Page.captureScreenshot', {}).then((r) => {
  const b = (r as { data: string }).data
  const fs = require('node:fs') as typeof import('node:fs')
  fs.writeFileSync('/tmp/sidebar-1366.png', Buffer.from(b, 'base64'))
})
check('لا أخطاء كونسول', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

console.log(`=== SIDEBAR CHECK DONE | pass=${pass} fail=${fail} ===`)
process.exit(fail === 0 ? 0 : 1)

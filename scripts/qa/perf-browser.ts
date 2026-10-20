// =============================================================
// QA الأداء — قياسات المتصفح (LCP/CLS/زمن الانتقال والبحث)
// يتطلب: خادم 3000 على قاعدة QA مبذورة (bun scripts/qa/perf.ts يبذر الحجم)
// bunx playwright test must not run — هذا سكربت مستقل:
//   bun scripts/qa/perf-browser.ts
// =============================================================
import { chromium } from '@playwright/test'

const BASE = 'http://localhost:3000'

async function pageMetrics(page: import('@playwright/test').Page, url: string, waitMarker: string) {
  // يُثبَّت قبل أي تنقل ليعمل مع كل مستند جديد
  await page.addInitScript(() => {
    ;(window as unknown as { __m: unknown }).__m = { lcp: 0, cls: 0 }
    const po = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const m = (window as unknown as { __m: { lcp: number; cls: number } }).__m
        if (e.entryType === 'largest-contentful-paint') m.lcp = e.startTime
        if (e.entryType === 'layout-shift' && !(e as unknown as { hadRecentInput: boolean }).hadRecentInput) m.cls += (e as unknown as { value: number }).value
      }
    })
    po.observe({ type: 'largest-contentful-paint', buffered: true } as PerformanceObserverInit)
    po.observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit)
  })
  const t0 = Date.now()
  await page.goto(url)
  await page.waitForSelector(waitMarker, { timeout: 30_000 })
  const elapsed = Date.now() - t0
  await page.waitForTimeout(600)
  const m = await page.evaluate(() => (window as unknown as { __m: { lcp: number; cls: number } }).__m)
  return { elapsed, lcp: Math.round(m.lcp), cls: Math.round(m.cls * 1000) / 1000 }
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ locale: 'ar', viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  console.log('===== خط أساس المتصفح (بيانات: 2000 منتج، 300 عميل) =====')

  // 1) شاشة الدخول (تحميل أول بارد)
  const login = await pageMetrics(page, BASE + '/', 'input[type=password], [type=password]')
  console.log(`شاشة الدخول: وقت الظهور ${login.elapsed}ms — LCP ${login.lcp}ms — CLS ${login.cls}`)

  // 2) الدخول → لوحة التحكم
  await page.locator('[type=password]').fill('1234')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await page.getByRole('button', { name: 'خروج', exact: true }).waitFor({ timeout: 20_000 })
  const dash = await pageMetrics(page, BASE + '/', 'nav[aria-label="القائمة الرئيسية"]')
  console.log(`لوحة التحكم (بجلسة): وقت الظهور ${dash.elapsed}ms — LCP ${dash.lcp}ms — CLS ${dash.cls}`)

  // 3) زمن الانتقال بين الشاشات (تنقل داخلي)
  const nav = page.getByRole('navigation', { name: 'القائمة الرئيسية' })
  for (const [label, marker] of [['المنتجات', 'text=منتج جديد'], ['التقارير', 'role=tab[name="لوحة"]'], ['نقطة البيع', 'text=السلة']] as const) {
    const t0 = Date.now()
    await nav.getByRole('button', { name: label }).click()
    await page.waitForSelector(marker, { timeout: 20_000 })
    console.log(`انتقال → ${label}: ${Date.now() - t0}ms`)
  }

  // 4) البحث في المنتجات (2000 منتج) من الواجهة — زمن ظهور النتائج المصفاة
  await nav.getByRole('button', { name: 'المنتجات' }).click()
  await page.waitForSelector('text=منتج جديد', { timeout: 20_000 })
  const times: number[] = []
  for (const q of ['بالجملة 12', 'بالجملة 199', 'شاي', 'منتج بالجملة 5']) {
    const box = page.getByPlaceholder(/بحث بالاسم/)
    const t0 = Date.now()
    await box.fill(q)
    // انتظار اختفاء نتيجة سابقة وظهور نتيجة جديدة (الرفض debounce 250ms)
    await page.waitForTimeout(600)
    await page.waitForFunction(q => document.body.textContent?.includes(q), q, { timeout: 5000 })
    times.push(Date.now() - t0)
    await box.fill('')
    await page.waitForTimeout(400)
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  console.log(`البحث في المنتجات (UI، يشمل debounce 250ms): ${times.map(t => t + 'ms').join(' / ')} — متوسط ${avg.toFixed(0)}ms`)

  // 5) أخطاء Console وطلبات فاشلة
  const errors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 100)) })
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().slice(-40)}`) })
  await page.reload()
  await page.waitForTimeout(2500)
  console.log(`أخطاء Console/شبكة أثناء الجولة: ${errors.length === 0 ? 'لا يوجد' : errors.length + ' — ' + errors.slice(0, 5).join(' | ')}`)

  await browser.close()
  console.log('\nالأهداف: LCP ≤ 2500ms — CLS ≤ 0.1 — الانتقالات سلسة — البحث p95 < 200ms (API: 9ms)')
  process.exit(0)
}
main().catch(e => { console.error('PERF-BROWSER FAIL', e); process.exit(1) })

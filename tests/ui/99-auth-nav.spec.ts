import { test, expect } from './helpers'
import { loginOwner } from './helpers'

const MODULES: [string, RegExp][] = [
  ['لوحة التحكم', /أهلًا/],
  ['نقطة البيع', /نقطة البيع/],
  ['المبيعات والفواتير', /المبيعات والفواتير|الفواتير/],
  ['المنتجات', /المنتجات/],
  ['المخزون', /المخزون/],
  ['العملاء والديون', /العملاء/],
  ['الموردون', /الموردون/],
  ['المشتريات', /المشتريات/],
  ['الإنتاج والوصفات', /الإنتاج/],
  ['التوزيع والمندوبون', /التوزيع/],
  ['المصروفات', /المصروفات/],
  ['الخزينة والورديات', /الورديات|الخزينة/],
  ['التقارير', /التقارير/],
  ['سجل التدقيق', /سجل التدقيق|التدقيق/],
  ['الإعدادات', /الإعدادات/],
]

test.describe('الدخول والتهيئة والتنقل', () => {
  test('كلمة مرور خاطئة → رسالة عربية ولا دخول', async ({ page }) => {
    await page.goto('/')
    const pw = page.getByRole('textbox', { name: 'كلمة المرور' })
    await pw.waitFor({ state: 'visible', timeout: 20_000 })
    await pw.fill('0000')
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await expect(page.getByText(/غير صحيحة|تعذر/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeVisible()
  })

  test('دخول صحيح → لوحة التحكم ببيانات فعلية', async ({ page }) => {
    await loginOwner(page)
    await expect(page.getByRole('heading', { name: /أهلًا/ })).toBeVisible()
    await expect(page.getByText(/مخبز/).first()).toBeVisible()
    // مؤشرات عامة ظاهرة وليس شاشة فارغة
    await expect(page.getByText(/مبيعات اليوم|تنبيهات المخزون|أحدث الفواتير/).first()).toBeVisible()
  })

  test('الوصول إلى كل وحدة من 15 وحدة وظهور محتواها', async ({ page }) => {
    await loginOwner(page)
    const nav = page.getByRole('navigation', { name: 'القائمة الرئيسية' })
    for (const [label, heading] of MODULES) {
      await nav.getByRole('button', { name: label }).click()
      await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: heading }).first()).toBeVisible({ timeout: 15_000 })
      // لا توجد أخطاء ظاهرة على الشاشة
      await expect(page.getByText(/حدث خطأ داخلي/)).toHaveCount(0)
    }
  })

  test('تسجيل الخروج يعيد شاشة الدخول', async ({ page }) => {
    await loginOwner(page)
    await page.getByRole('button', { name: 'خروج' }).click()
    await expect(page.getByRole('button', { name: 'دخول' })).toBeVisible()
    // الجلسة بطلت: إعادة التحميل تبقى على الدخول
    await page.reload()
    await expect(page.getByRole('button', { name: 'دخول' })).toBeVisible()
  })

  test('RTL: اتجاه الوثيقة rtl ولغة عربية', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  })
})

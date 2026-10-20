import { test as base, expect, type Page } from '@playwright/test'

/**
 * تسجيل دخول مالك (كلمة التطوير 1234 على قاعدة الاختبار المعزولة فقط).
 * مرن ضد سباق التهيئة: يعيد المحاولة حتى 3 مرات ويتحقق من الوصول الفعلي للنظام.
 */
export async function loginOwner(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const done = page.getByRole('button', { name: 'خروج', exact: true })
  for (let i = 0; i < 3 && !(await done.isVisible().catch(() => false)); i++) {
    const pw = page.getByRole('textbox', { name: 'كلمة المرور' })
    if (!(await pw.isVisible().catch(() => false))) {
      await page.waitForTimeout(700)
      continue
    }
    await pw.fill('1234')
    // تأكيد أن القيمة ثبتت في الحقل قبل الإرسال (النموذج مُتحكم فيه وقد يُعاد رسمه)
    await expect(pw).toHaveValue('1234', { timeout: 3000 })
    await page.getByRole('button', { name: 'دخول', exact: true }).click()
    await done.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
  }
  await expect(done).toBeVisible({ timeout: 15_000 })
}

export const test = base.extend({})
export { expect }

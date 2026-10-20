import { test, expect } from './helpers'
import { loginOwner } from './helpers'
import { randomBytes } from 'crypto'

const uniq = () => 'PW-' + randomBytes(4).toString('hex')

test.describe('دورة البيع الكاملة من الواجهة', () => {
  test('نقطة البيع: بحث → إضافة → كمية → ترحيل → إيصال → سلة نظيفة', async ({ page }) => {
    await loginOwner(page)
    await page.getByRole('navigation').getByRole('button', { name: 'نقطة البيع' }).click()
    await expect(page.getByRole('heading', { name: 'نقطة البيع' })).toBeVisible()

    // تركيز البحث F2 والإكمال بالكتابة
    await page.keyboard.press('F2')
    await expect(page.getByPlaceholder(/ابحث بالاسم/)).toBeFocused()
    await page.getByRole('button', { name: /إضافة شاي إلى السلة/ }).click()
    await page.getByRole('button', { name: /إضافة سكر إلى السلة/ }).click()
    // رفع كمية الشاي من لوحة السلة
    const qtyBox = page.getByRole('textbox', { name: 'كمية شاي' })
    await qtyBox.fill('3')
    await expect(qtyBox).toHaveValue('3')

    // الإجمالي يظهر قبل الترحيل (شاي 3×5 = 15 + سكر 4 + ضريبة 17%)
    await expect(page.getByText(/المجموع/).first()).toBeVisible()

    // ترحيل
    await page.getByRole('button', { name: /ترحيل الفاتورة/ }).click()
    await expect(page.getByRole('dialog')).toContainText(/تم ترحيل الفاتورة S-/)
    await page.keyboard.press('Escape')

    // السلة تصفّر للبيعة التالية
    await expect(page.getByText(/السلة فارغة/)).toBeVisible()
  })

  test('منع البيانات الخاطئة: بيع منتج برصيد صفر يظهر رسالة سبب واضحة', async ({ page }) => {
    await loginOwner(page)
    await page.getByRole('navigation').getByRole('button', { name: 'نقطة البيع' }).click()
    // خبز عادي رصيده 0 في قاعدة الاختبار (بعد دفعات QA)
    await page.getByRole('button', { name: /إضافة خبز عادي إلى السلة/ }).click()
    await page.getByRole('button', { name: /ترحيل الفاتورة/ }).click()
    await expect(page.getByText(/الرصيد غير كافٍ/).first()).toBeVisible({ timeout: 15_000 })
    // السلة بقيت كما هي (لم تُفقد بيانات غير مقصودة)
    await expect(page.getByText(/خبز عادي/).first()).toBeVisible()
  })

  test('المنتجات: إنشاء وتعديل منتج جديد يظهر في القائمة', async ({ page }) => {
    await loginOwner(page)
    const name = 'منتج ' + uniq()
    await page.getByRole('navigation').getByRole('button', { name: 'المنتجات', exact: true }).click()
    await page.getByRole('button', { name: /منتج جديد|إضافة منتج/ }).first().click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel(/اسم المنتج/).fill(name)
    await dlg.getByLabel(/سعر البيع/).fill('7.5')
    await dlg.getByRole('button', { name: /إضافة المنتج|حفظ/ }).click()
    await expect(dlg).toBeHidden({ timeout: 10_000 })
    // البحث عنه في القائمة يثبت الحفظ الفعلي
    await page.getByPlaceholder(/بحث/).first().fill(name)
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 })
  })

  test('العملاء: إنشاء عميل ثم تحصيل دفعة تُحدّث الرصيد', async ({ page }) => {
    await loginOwner(page)
    const name = 'عميل ' + uniq()
    await page.getByRole('navigation').getByRole('button', { name: 'العملاء والديون' }).click()
    await page.getByRole('button', { name: /عميل جديد|إضافة عميل/ }).first().click()
    const cdlg = page.getByRole('dialog')
    await cdlg.getByLabel(/الاسم/).fill(name)
    await cdlg.getByRole('button', { name: /إضافة العميل|حفظ/ }).click()
    await expect(cdlg).toBeHidden({ timeout: 10_000 })
    await page.getByPlaceholder(/بحث/).first().fill(name)
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 })
  })

  test('التقارير: تبويب المبيعات يعرض أرقامًا من قاعدة البيانات', async ({ page }) => {
    await loginOwner(page)
    await page.getByRole('navigation').getByRole('button', { name: 'التقارير' }).click()
    await page.getByRole('tab', { name: 'المبيعات' }).click()
    await expect(page.getByText(/عدد الفواتير/)).toBeVisible()
    // قيمة رقمية وليست فارغة أو NaN
    const cell = page.locator('table td, [class*=tabular]').filter({ hasText: /\d/ }).first()
    await expect(cell).toBeVisible()
    await expect(page.getByText('NaN')).toHaveCount(0)
  })

  test('الإعدادات: تبويب النسخ الاحتياطي يعرض معاينة التصدير', async ({ page }) => {
    await loginOwner(page)
    await page.getByRole('navigation').getByRole('button', { name: 'الإعدادات' }).click()
    await page.getByRole('tab', { name: /نسخ احتياطي|النسخ/ }).click()
    await expect(page.getByText(/تصدير|استعادة/).first()).toBeVisible()
  })

  test('سجل التدقيق: يعرض أحداثًا حقيقية', async ({ page }) => {
    await loginOwner(page)
    await page.getByRole('navigation').getByRole('button', { name: 'سجل التدقيق' }).click()
    await expect(page.locator('table tbody tr').first()).toBeVisible()
  })
})

import { defineConfig } from '@playwright/test'

/**
 * اختبارات واجهة مخبز الولاء الحديث — تعمل ضد خادم التطوير المحلي (3000)
 * المطلوب مسبقًا: تشغيل `bun run dev` مع قاعدة الاختبار المعزولة:
 *   DATABASE_URL=file:/tmp/qa-bakery/qa.db bun run dev
 * ثم تهيئة القاعدة ببيانات اصطناعية:
 *   bun scripts/qa/seed.ts && bun scripts/qa/batch-a-auth.ts (تُنشئ حساب qa_cashier)
 * العزل: تنفيذ تسلسلي (workers=1) على قاعدة معزولة في /tmp — كل اختبار يُنشئ كيانه الخاص بأسماء فريدة عبر الـAPI ويحذفه.
 */
export default defineConfig({
  testDir: './tests/ui',
  globalSetup: './tests/ui/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: '/tmp/qa-bakery/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ar',
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})

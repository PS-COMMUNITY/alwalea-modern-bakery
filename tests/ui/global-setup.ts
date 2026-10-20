import { execSync } from 'child_process'

/**
 * تهيئة قاعدة الاختبار المعزولة قبل كل تشغيل للاختبارات:
 * بيانات اصطناعية معروفة وأرصدة كافية — تجعل الحالة محددة وقابلة للتكرار.
 * ملاحظة: يشترط أن يكون خادم التطوير على 3000 يعمل بقاعدة /tmp/qa-bakery/qa.db
 */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: 'file:/tmp/qa-bakery/qa.db' }
  execSync('bun scripts/qa/seed.ts', { env, stdio: 'inherit', cwd: process.cwd() })
}

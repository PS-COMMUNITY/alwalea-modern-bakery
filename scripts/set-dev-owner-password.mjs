/**
 * أداة تطوير — ضبط كلمة مرور المالك في قاعدة بيانات التطوير/الاختبار.
 * تُخزَّن الكلمة مُلبَّدة (scrypt + salt مستقل) — لا تُخزَّن نصًا مكشوفًا أبدًا.
 * الاستخدام: bun scripts/set-dev-owner-password.mjs [الرقم_السري_الجديد]  (الافتراضي 1234)
 * ملاحظة: للقواعد الإنتاجية لا يُشغَّل هذا السكربت إلا بإذن صريح من المالك.
 */
import { randomBytes, scryptSync } from 'node:crypto'

const NEW_PASSWORD = process.argv[2] ?? '1234'
if (NEW_PASSWORD.length < 4) {
  console.error('كلمة المرور يجب ألا تقل عن 4 أحرف/أرقام')
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient()

const owners = await db.user.findMany({ where: { role: 'OWNER', active: true }, orderBy: { createdAt: 'asc' } })
let user = owners[0] ?? null
if (!user) {
  const actives = await db.user.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } })
  user = actives.length === 1 ? actives[0] : null
}
if (!user) {
  console.error('تعذر تحديد حساب المالك')
  await db.$disconnect()
  process.exit(1)
}

const salt = randomBytes(16).toString('hex')
const hash = scryptSync(NEW_PASSWORD, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
await db.user.update({
  where: { id: user.id },
  data: { passwordHash: hash, passwordSalt: salt, failedAttempts: 0, lockedUntil: null },
})
console.log(`تم ضبط كلمة مرور المالك (${user.username}) في قاعدة التطوير — مُخزَّنة مُلبَّدة (scrypt, salt مستقل)`)
await db.$disconnect()

import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const tables = ['user', 'session', 'product', 'customer', 'supplier', 'sale', 'saleItem', 'purchase', 'stockMovement', 'auditLog', 'settings', 'shift', 'expense', 'productionBatch'] as const
for (const t of tables) {
  console.log(t, await (db as any)[t].count())
}
const users = await db.user.findMany({ select: { username: true, role: true, active: true, passwordHash: true, passwordSalt: true } })
console.log('users:', users.map(u => `${u.username}/${u.role}/active=${u.active}/hash=${u.passwordHash.length}hex/salt=${u.passwordSalt.length}hex`).join(' | '))
const emptyHash = users.filter(u => !u.passwordHash || !u.passwordSalt)
console.log('emptyHashUsers:', emptyHash.length)
await db.$disconnect()

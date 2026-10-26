import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const r: any = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%Period%' OR name LIKE '%StockCount%')")
console.log('TABLES:', JSON.stringify(r))
await db.$disconnect()

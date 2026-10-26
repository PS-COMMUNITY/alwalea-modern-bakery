import { call, captureSession } from '../qa/harness'
const l = await call('POST', '/api/auth/login', { body: { password: '1234' } })
captureSession(l)
const inv = await call('GET', '/api/inventory')
const rows = inv.json?.rows ?? inv.json?.items ?? []
const sorted = [...rows].sort((a: any, b: any) => (b.stockMilli ?? b.qtyMilli ?? 0) - (a.stockMilli ?? a.qtyMilli ?? 0))
console.log('top inventory rows:', JSON.stringify(sorted.slice(0, 3), null, 1).slice(0, 600))
const pid = sorted[0]?.productId ?? sorted[0]?.id
console.log('picked productId:', pid)
const sale = await call('POST', '/api/sales', { body: { items: [{ productId: pid, qtyMilli: 100 }], payments: [{ amountMinor: 1, method: 'CASH' }] } })
console.log('sale status:', sale.status, JSON.stringify(sale.json).slice(0, 300))

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handle } from '@/lib/bakery/auth'
import { getSettings } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  return handle(async () => {
    const s = await getSettings()
    const userCount = await db.user.count()
    return NextResponse.json({
      setupCompleted: s.setupCompleted && userCount > 0,
      businessName: s.businessName,
      currencyCode: s.currencyCode,
      currencySymbol: s.currencySymbol,
      schemaVersion: s.schemaVersion,
      appVersion: '1.0.0',
    })
  })
}

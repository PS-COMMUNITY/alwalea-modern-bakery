import { NextRequest } from 'next/server'
import { getAuthUser, handle, ok } from '@/lib/bakery/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getAuthUser(req)
    if (!user) return ok({ user: null })
    return ok({ user })
  })
}

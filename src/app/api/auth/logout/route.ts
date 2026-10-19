import { NextRequest } from 'next/server'
import { destroySession, handle, ok, SESSION_COOKIE, getAuthUser } from '@/lib/bakery/auth'
import { audit } from '@/lib/bakery/core'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getAuthUser(req)
    const token = req.cookies.get(SESSION_COOKIE)?.value
    if (token) await destroySession(token)
    if (user) await audit({ userId: user.id, username: user.username, action: 'LOGOUT' })
    const res = ok()
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return res
  })
}

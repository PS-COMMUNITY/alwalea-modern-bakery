'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/bakery/client'
import type { AuthUser } from '@/lib/bakery/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Lock } from 'lucide-react'

/** شاشة تسجيل الدخول — محلية بالكامل */
export function LoginScreen({
  businessName, locked, bootError, onLogin,
}: {
  businessName: string
  locked: boolean
  bootError?: string
  onLogin: (u: AuthUser) => Promise<void>
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (locked) {
      setUsername('')
      setPassword('')
      setError('')
    }
  }, [locked])

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError('')
    if (!username || !password) {
      setError('أدخل اسم المستخدم وكلمة المرور')
      return
    }
    setBusy(true)
    try {
      const u = await api.post<AuthUser>('/api/auth/login', { username, password })
      await onLogin(u)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 p-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-cocoa-900 text-3xl font-black text-copper-400" aria-hidden>و</div>
          <h1 className="text-2xl font-black text-cocoa-900">{businessName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {locked ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-copper-700">
                <Lock className="h-4 w-4" aria-hidden /> تم قفل الجلسة بسبب الخمول — أدخل بياناتك للمتابعة
              </span>
            ) : (
              'تسجيل الدخول إلى النظام'
            )}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="username">اسم المستخدم</Label>
            <Input
              id="username"
              dir="ltr"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              maxLength={60}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور</Label>
            <Input
              id="password"
              type="password"
              dir="ltr"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {bootError ? (
            <p className="rounded-lg border border-copper-500/50 bg-copper-100/60 p-3 text-sm text-copper-700" role="alert">{bootError}</p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive" role="alert">{error}</p>
          ) : null}

          <Button type="submit" disabled={busy} className="w-full bg-cocoa-800 hover:bg-cocoa-700">
            {busy ? 'جارٍ التحقق…' : 'دخول'}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          بعد 5 محاولات فاشلة يُقفل الحساب مؤقتًا 5 دقائق.
        </p>
      </div>
    </div>
  )
}

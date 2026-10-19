'use client'

import { useState } from 'react'
import { api } from '@/lib/bakery/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'

const STEPS = ['بيانات النشاط', 'العملة والمنطقة', 'كلمة المرور']

/** كلمة المرور الأولية الافتراضية — تُخزَّن مُلبَّدة فورًا ويمكن تغييرها من الإعدادات لاحقًا */
const DEFAULT_INITIAL_PASSWORD = '1234'

/** معالج التهيئة لأول تشغيل — يعمل مرة واحدة فقط */
export function SetupWizard({ onDone }: { onDone: () => Promise<void> }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [businessName, setBusinessName] = useState('مخبز الولاء الحديث')
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [currencyCode, setCurrencyCode] = useState('ILS')
  const [currencySymbol, setCurrencySymbol] = useState('₪')
  const [password, setPassword] = useState(DEFAULT_INITIAL_PASSWORD)
  const [confirmPassword, setConfirmPassword] = useState(DEFAULT_INITIAL_PASSWORD)

  const next = () => {
    setError('')
    if (step === 0 && !businessName.trim()) {
      setError('اسم النشاط مطلوب')
      return
    }
    setStep(s => s + 1)
  }

  const submit = async () => {
    setError('')
    if (password.length < 4) {
      setError('كلمة المرور: 4 أحرف/أرقام على الأقل')
      return
    }
    if (password !== confirmPassword) {
      setError('تأكيد كلمة المرور غير مطابق')
      return
    }
    setBusy(true)
    try {
      // وضع الحساب الواحد: اسم المستخدم owner يُنشأ تلقائيًا في الخادم
      await api.post('/api/setup', { businessName, ownerName, phone, address, currencyCode, currencySymbol, password })
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل إكمال التهيئة')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 p-4" dir="rtl">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-cocoa-900 text-3xl font-black text-copper-400">و</div>
          <h1 className="text-2xl font-black text-cocoa-900">أهلًا بك في مخبز الولاء الحديث</h1>
          <p className="mt-1 text-sm text-muted-foreground">معالج الإعداد لأول مرة — خطوة واحدة في كل مرة</p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-5">
            <Progress value={((step + 1) / STEPS.length) * 100} className="h-2" />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              {STEPS.map((s, i) => (
                <span key={s} className={i <= step ? 'font-bold text-copper-600' : ''}>
                  {i < step ? '✓ ' : ''}{s}
                </span>
              ))}
            </div>
          </div>

          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bn">اسم النشاط *</Label>
                <Input id="bn" value={businessName} onChange={e => setBusinessName(e.target.value)} maxLength={120} />
                <p className="text-xs text-muted-foreground">يظهر في الترويسة والإيصالات والتقارير، ويمكن تعديله لاحقًا من الإعدادات.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="on">اسم المالك</Label>
                <Input id="on" value={ownerName} onChange={e => setOwnerName(e.target.value)} maxLength={120} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ph">هاتف الاتصال</Label>
                  <Input id="ph" value={phone} onChange={e => setPhone(e.target.value)} maxLength={30} placeholder="اختياري" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ad">العنوان</Label>
                  <Input id="ad" value={address} onChange={e => setAddress(e.target.value)} maxLength={300} placeholder="اختياري" />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>العملة</Label>
                  <Select value={currencyCode} onValueChange={v => {
                    setCurrencyCode(v)
                    setCurrencySymbol(v === 'ILS' ? '₪' : v === 'JOD' ? 'د.أ' : v === 'USD' ? '$' : v)
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ILS">الشيكل (₪) — فلسطين</SelectItem>
                      <SelectItem value="JOD">الدينار الأردني (د.أ)</SelectItem>
                      <SelectItem value="USD">الدولار ($)</SelectItem>
                      <SelectItem value="EGP">الجنيه المصري</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cs">رمز العملة</Label>
                  <Input id="cs" value={currencySymbol} onChange={e => setCurrencySymbol(e.target.value)} maxLength={8} />
                </div>
              </div>
              <div className="rounded-lg bg-cream-200 p-3 text-sm text-cocoa-700">
                <p className="font-semibold">ملاحظات مهمة:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs leading-relaxed text-muted-foreground">
                  <li>المنطقة الزمنية: توقيت فلسطين (GMT+2/+3).</li>
                  <li>الضريبة معطلة افتراضيًا — فعّلها من الإعدادات بعد التأكد من التزاماتك الضريبية.</li>
                  <li>كل البيانات تُحفظ محليًا على هذا الجهاز فقط.</li>
                </ul>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-lg bg-cream-200 p-3 text-sm text-cocoa-700">
                سيُنشأ حساب المالك تلقائيًا (وضع الحساب الواحد) — الدخول لاحقًا بكلمة المرور فقط.
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw">كلمة المرور *</Label>
                <Input id="pw" type="password" dir="ltr" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                <p className="text-xs text-muted-foreground">4 أحرف/أرقام على الأقل (الافتراضية 1234) — تُخزَّن مُلبَّدة بخوارزمية scrypt ولا يمكن استرجاعها، ويمكن تغييرها لاحقًا من الإعدادات.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">تأكيد كلمة المرور *</Label>
                <Input id="pw2" type="password" dir="ltr" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              </div>
            </div>
          )}

          {error ? (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive" role="alert">{error}</p>
          ) : null}

          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0 || busy}>
              <ChevronRight className="h-4 w-4" /> السابق
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next} className="bg-cocoa-800 hover:bg-cocoa-700">
                التالي <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={busy} className="bg-copper-600 hover:bg-copper-700">
                {busy ? 'جارٍ الإنشاء…' : <><Check className="h-4 w-4" /> إنشاء النظام والبدء</>}
              </Button>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          البيانات تُحفظ محليًا على هذا الجهاز — لا تُرسل لأي مكان خارجي.
        </p>
      </div>
    </div>
  )
}

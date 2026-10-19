'use client'

// =============================================================
// الإعدادات — النشاط، البيع والفاتورة، المستخدمون، النسخ الاحتياطي، حول النظام
// =============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/bakery/client'
import type { Settings, StatusInfo, UserInfo } from '@/lib/bakery/types'
import { ROLE_LABELS } from '@/lib/bakery/types'
import type { Role } from '@/lib/bakery/permissions'
import { ROLES } from '@/lib/bakery/permissions'
import { useSession } from '@/components/bakery/shell'
import {
  dateTime, EmptyState, ErrorBanner, LoadingRows, PageHeader, TableShell,
} from '@/components/bakery/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  AlertTriangle, DatabaseBackup, DownloadCloud, FileUp, KeyRound, Pencil, Save, UploadCloud, UserPlus,
} from 'lucide-react'

type BizForm = { businessName: string; ownerName: string; phone: string; address: string; currencyCode: string; currencySymbol: string }

type SellForm = {
  taxEnabled: boolean
  taxRatePct: string
  negativeStockAllowed: boolean
  requireCustomerForCredit: boolean
  receiptWidth: string
  idleLockMinutes: string
}

type NewUserForm = { username: string; displayName: string; role: string; password: string }
type EditUserForm = { displayName: string; role: string; active: boolean }

type PreviewResponse = {
  exportedAt: string | null
  schemaVersion: string
  tables: { table: string; rows: number }[]
  totalRows: number
  warnings: string[]
  message: string
}

type RestoreResponse = { restored: Record<string, number>; sessionNote: string; message: string }

function sellFormFromSettings(s: Settings): SellForm {
  return {
    taxEnabled: s.taxEnabled,
    taxRatePct: (s.taxRateBp / 100).toString(),
    negativeStockAllowed: s.negativeStockAllowed,
    requireCustomerForCredit: s.requireCustomerForCredit,
    receiptWidth: String(s.receiptWidth),
    idleLockMinutes: String(s.idleLockMinutes),
  }
}

export function SettingsScreen({ onSettingsChanged }: { onSettingsChanged?: () => Promise<void> }) {
  const { settings, can, user } = useSession()
  const { toast } = useToast()
  const canSettings = can('settings.manage')
  const canUsers = can('users.manage')
  const canBackup = can('backup.manage')
  const isOwner = user.role === 'OWNER'

  // ===== النشاط =====
  const [biz, setBiz] = useState<BizForm>({
    businessName: settings.businessName,
    ownerName: settings.ownerName ?? '',
    phone: settings.phone ?? '',
    address: settings.address ?? '',
    currencyCode: settings.currencyCode,
    currencySymbol: settings.currencySymbol,
  })
  const [bizBusy, setBizBusy] = useState(false)
  const [bizError, setBizError] = useState('')

  // ===== البيع والفاتورة =====
  const [sell, setSell] = useState<SellForm>(sellFormFromSettings(settings))
  const [sellBusy, setSellBusy] = useState(false)
  const [sellError, setSellError] = useState('')

  // ===== المستخدمون =====
  const [users, setUsers] = useState<UserInfo[] | null>(null)
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState('')

  const [newUserOpen, setNewUserOpen] = useState(false)
  const [newUser, setNewUser] = useState<NewUserForm>({ username: '', displayName: '', role: 'CASHIER', password: '' })
  const [newUserBusy, setNewUserBusy] = useState(false)
  const [newUserError, setNewUserError] = useState('')

  const [editUser, setEditUser] = useState<UserInfo | null>(null)
  const [editForm, setEditForm] = useState<EditUserForm>({ displayName: '', role: 'CASHIER', active: true })
  const [editBusy, setEditBusy] = useState(false)

  const [pwUser, setPwUser] = useState<UserInfo | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')

  // ===== النسخ الاحتياطي =====
  const [fileData, setFileData] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [confirmUnderstood, setConfirmUnderstood] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState('')
  const [demoOpen, setDemoOpen] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ===== حول النظام =====
  const [status, setStatus] = useState<StatusInfo | null>(null)

  const loadUsers = useCallback(async () => {
    if (!canUsers) {
      setUsersLoading(false)
      return
    }
    setUsersLoading(true)
    setUsersError('')
    try {
      const res = await api.get<UserInfo[]>('/api/users')
      setUsers(res)
    } catch (e) {
      setUsersError(e instanceof ApiError ? e.message : 'تعذر تحميل المستخدمين')
      setUsers(null)
    } finally {
      setUsersLoading(false)
    }
  }, [canUsers])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  useEffect(() => {
    void (async () => {
      try {
        setStatus(await api.get<StatusInfo>('/api/status'))
      } catch {
        // اختياري للعرض
      }
    })()
  }, [])

  // ===== حفظ النشاط =====
  async function saveBiz() {
    setBizError('')
    const businessName = biz.businessName.trim()
    if (!businessName) {
      setBizError('اسم النشاط مطلوب')
      return
    }
    setBizBusy(true)
    try {
      await api.put('/api/settings', {
        businessName,
        ownerName: biz.ownerName.trim() || null,
        phone: biz.phone.trim() || null,
        address: biz.address.trim() || null,
        currencyCode: biz.currencyCode.trim() || undefined,
        currencySymbol: biz.currencySymbol.trim() || undefined,
      })
      toast({ title: 'تم حفظ بيانات النشاط', description: 'حُدث اسم الترويسة والعملة في كل الشاشات.' })
      if (onSettingsChanged) await onSettingsChanged()
    } catch (e) {
      setBizError(e instanceof ApiError ? e.message : 'تعذر حفظ الإعدادات')
    } finally {
      setBizBusy(false)
    }
  }

  // ===== حفظ البيع =====
  async function saveSell() {
    setSellError('')
    const pct = parseFloat(sell.taxRatePct)
    if (!isFinite(pct) || pct < 0 || pct > 100) {
      setSellError('نسبة الضريبة يجب أن تكون بين 0 و 100')
      return
    }
    const idle = parseInt(sell.idleLockMinutes, 10)
    if (!Number.isInteger(idle) || idle < 1 || idle > 240) {
      setSellError('قفل الخمول يجب أن يكون بين 1 و 240 دقيقة')
      return
    }
    setSellBusy(true)
    try {
      await api.put('/api/settings', {
        taxEnabled: sell.taxEnabled,
        taxRateBp: Math.round(pct * 100),
        negativeStockAllowed: sell.negativeStockAllowed,
        requireCustomerForCredit: sell.requireCustomerForCredit,
        receiptWidth: parseInt(sell.receiptWidth, 10) === 58 ? 58 : 80,
        idleLockMinutes: idle,
      })
      toast({ title: 'تم حفظ إعدادات البيع' })
      if (onSettingsChanged) await onSettingsChanged()
    } catch (e) {
      setSellError(e instanceof ApiError ? e.message : 'تعذر حفظ الإعدادات')
    } finally {
      setSellBusy(false)
    }
  }

  // ===== مستخدم جديد =====
  async function submitNewUser() {
    setNewUserError('')
    const username = newUser.username.trim()
    if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) {
      setNewUserError('اسم المستخدم: حروف إنجليزية وأرقام فقط، 3 أحرف على الأقل')
      return
    }
    if (!newUser.displayName.trim()) {
      setNewUserError('الاسم المعروض مطلوب')
      return
    }
    if (newUser.password.length < 8) {
      setNewUserError('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      return
    }
    setNewUserBusy(true)
    try {
      await api.post('/api/users', {
        username,
        displayName: newUser.displayName.trim(),
        role: newUser.role,
        password: newUser.password,
      })
      toast({ title: `أُنشئ المستخدم «${username}»`, description: `الدور: ${ROLE_LABELS[newUser.role as Role] ?? newUser.role}` })
      setNewUserOpen(false)
      setNewUser({ username: '', displayName: '', role: 'CASHIER', password: '' })
      void loadUsers()
    } catch (e) {
      setNewUserError(e instanceof ApiError ? e.message : 'تعذر إنشاء المستخدم')
    } finally {
      setNewUserBusy(false)
    }
  }

  // ===== تعديل مستخدم =====
  async function submitEditUser() {
    if (!editUser) return
    setEditBusy(true)
    try {
      await api.put(`/api/users/${editUser.id}`, {
        displayName: editForm.displayName.trim() || undefined,
        role: editForm.role,
        active: editForm.active,
      })
      toast({ title: 'تم حفظ بيانات المستخدم' })
      setEditUser(null)
      void loadUsers()
    } catch (e) {
      toast({
        title: 'تعذر حفظ المستخدم',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setEditBusy(false)
    }
  }

  // ===== تغيير كلمة مرور =====
  async function submitPassword() {
    if (!pwUser) return
    setPwError('')
    if (newPassword.length < 8) {
      setPwError('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل')
      return
    }
    const isSelf = pwUser.id === user.id
    if (isSelf && !currentPassword) {
      setPwError('أدخل كلمة مرورك الحالية للتأكيد')
      return
    }
    setPwBusy(true)
    try {
      await api.put(`/api/users/${pwUser.id}/password`, {
        newPassword,
        ...(isSelf ? { currentPassword } : {}),
      })
      toast({ title: 'تم تغيير كلمة المرور', description: 'أُنهيت جلسات هذا المستخدم — سيلزم تسجيل دخول من جديد.' })
      setPwUser(null)
      setNewPassword('')
      setCurrentPassword('')
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : 'تعذر تغيير كلمة المرور')
    } finally {
      setPwBusy(false)
    }
  }

  // ===== النسخ الاحتياطي =====
  async function downloadBackup() {
    setBackupBusy(true)
    try {
      await api.download('/api/backup/export', 'bakery-backup.json')
      toast({ title: 'بدأ تنزيل النسخة الاحتياطية', description: 'ملف JSON كامل قابل للنقل والاستعادة.' })
    } catch (e) {
      toast({
        title: 'تعذر تنزيل النسخة',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setBackupBusy(false)
    }
  }

  function onPickFile(file: File | null | undefined) {
    setPreview(null)
    setConfirmUnderstood(false)
    setBackupError('')
    setFileData(null)
    setFileName('')
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setFileData(reader.result)
    }
    reader.onerror = () => {
      setBackupError('تعذر قراءة الملف')
    }
    reader.readAsText(file)
  }

  async function runPreview() {
    setBackupError('')
    if (!fileData) {
      setBackupError('اختر ملف النسخة الاحتياطية أولًا')
      return
    }
    setBackupBusy(true)
    try {
      const res = await api.post<PreviewResponse>('/api/backup/preview', { data: fileData })
      setPreview(res)
      setConfirmUnderstood(false)
    } catch (e) {
      setPreview(null)
      setBackupError(e instanceof ApiError ? e.message : 'تعذر فحص الملف')
    } finally {
      setBackupBusy(false)
    }
  }

  async function runRestore() {
    if (!fileData || !preview) return
    setBackupBusy(true)
    try {
      const res = await api.post<RestoreResponse>('/api/backup/restore', { data: fileData, confirm: true })
      toast({ title: 'تمت الاستعادة بنجاح', description: res.sessionNote })
      setPreview(null)
      setFileData(null)
      setFileName('')
      setConfirmUnderstood(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (onSettingsChanged) await onSettingsChanged()
      void loadUsers()
    } catch (e) {
      setBackupError(e instanceof ApiError ? e.message : 'تعذر تنفيذ الاستعادة')
    } finally {
      setBackupBusy(false)
    }
  }

  async function loadDemo() {
    setDemoBusy(true)
    try {
      await api.post('/api/backup/demo')
      toast({ title: 'حُملت البيانات التجريبية', description: 'بيانات اصطناعية موسومة بـ«تجريبي» — يمكنك تجربة النظام عليها.' })
      setDemoOpen(false)
      if (onSettingsChanged) await onSettingsChanged()
      void loadUsers()
    } catch (e) {
      setDemoOpen(false)
      toast({
        title: 'تعذر تحميل البيانات التجريبية',
        description: e instanceof ApiError ? e.message : 'خطأ غير متوقع',
        variant: 'destructive',
      })
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="الإعدادات" subtitle="إعدادات النشاط والبيع والمستخدمين والنسخ الاحتياطي — كل تعديل موثق في سجل التدقيق" />

      <Tabs defaultValue="business">
        <TabsList className="mb-4 h-11 flex-wrap h-auto">
          <TabsTrigger value="business" className="px-4">النشاط</TabsTrigger>
          <TabsTrigger value="selling" className="px-4">البيع والفاتورة</TabsTrigger>
          {canUsers ? <TabsTrigger value="users" className="px-4">المستخدمون</TabsTrigger> : null}
          {canBackup ? <TabsTrigger value="backup" className="px-4">النسخ الاحتياطي</TabsTrigger> : null}
          <TabsTrigger value="about" className="px-4">حول النظام</TabsTrigger>
        </TabsList>

        {/* ==================== النشاط ==================== */}
        <TabsContent value="business">
          {!canSettings ? (
            <EmptyState title="لا صلاحية" hint="إعدادات النشاط متاحة للمالك والمدير (settings.manage)." />
          ) : (
            <div className="max-w-2xl space-y-4 rounded-xl border bg-card p-4 md:p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="st-name">اسم النشاط *</Label>
                  <Input id="st-name" value={biz.businessName} onChange={e => setBiz(f => ({ ...f, businessName: e.target.value }))} className="h-10" autoComplete="off" />
                  <p className="text-xs text-muted-foreground">يظهر في الترويسة والفواتير والتقارير فورًا بعد الحفظ.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-owner">اسم صاحب العمل</Label>
                  <Input id="st-owner" value={biz.ownerName} onChange={e => setBiz(f => ({ ...f, ownerName: e.target.value }))} className="h-10" autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-phone">الهاتف</Label>
                  <Input id="st-phone" value={biz.phone} onChange={e => setBiz(f => ({ ...f, phone: e.target.value }))} className="h-10" dir="ltr" autoComplete="off" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="st-address">العنوان</Label>
                  <Input id="st-address" value={biz.address} onChange={e => setBiz(f => ({ ...f, address: e.target.value }))} className="h-10" autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-curr-code">رمز العملة (ISO)</Label>
                  <Input id="st-curr-code" value={biz.currencyCode} onChange={e => setBiz(f => ({ ...f, currencyCode: e.target.value }))} className="h-10" dir="ltr" autoComplete="off" placeholder="ILS" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-curr-symbol">رمز العملة المعروض</Label>
                  <Input id="st-curr-symbol" value={biz.currencySymbol} onChange={e => setBiz(f => ({ ...f, currencySymbol: e.target.value }))} className="h-10" autoComplete="off" placeholder="₪" />
                </div>
              </div>
              {bizError ? (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{bizError}</p>
              ) : null}
              <div className="flex justify-end">
                <Button type="button" className="h-10" onClick={() => void saveBiz()} disabled={bizBusy || !biz.businessName.trim()}>
                  <Save className="h-4 w-4" aria-hidden />
                  {bizBusy ? 'جارٍ الحفظ…' : 'حفظ بيانات النشاط'}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ==================== البيع والفاتورة ==================== */}
        <TabsContent value="selling">
          {!canSettings ? (
            <EmptyState title="لا صلاحية" hint="إعدادات البيع متاحة للمالك والمدير (settings.manage)." />
          ) : (
            <div className="max-w-2xl space-y-4 rounded-xl border bg-card p-4 md:p-6">
              {/* تحذير الضريبة */}
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <p className="font-semibold text-destructive">
                  لا تفعل الضريبة إلا بعد التأكد من التزاماتك — تأكيد صاحب العمل مطلوب.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
                  <div>
                    <Label htmlFor="st-tax">تفعيل الضريبة على الفواتير</Label>
                    <p className="text-xs text-muted-foreground">عند التفعيل تُحسب على كل فاتورة بالصيغة: (المجموع − الخصم) × النسبة.</p>
                  </div>
                  <Switch id="st-tax" checked={sell.taxEnabled} onCheckedChange={v => setSell(f => ({ ...f, taxEnabled: v }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-tax-rate">نسبة الضريبة (%)</Label>
                  <Input
                    id="st-tax-rate"
                    inputMode="decimal"
                    value={sell.taxRatePct}
                    onChange={e => setSell(f => ({ ...f, taxRatePct: e.target.value }))}
                    disabled={!sell.taxEnabled}
                    className="h-10 tabular-nums"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">تُخزن بنقاط أساس: {Math.round((parseFloat(sell.taxRatePct) || 0) * 100)} bp</p>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="st-negstock">السماح بمخزون سالب</Label>
                    <p className="text-xs text-muted-foreground">البيع فوق الرصيد المتاح مع وسم الحركة.</p>
                  </div>
                  <Switch id="st-negstock" checked={sell.negativeStockAllowed} onCheckedChange={v => setSell(f => ({ ...f, negativeStockAllowed: v }))} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="st-reqcust">اشتراط عميل للبيع الآجل</Label>
                    <p className="text-xs text-muted-foreground">يمنع ترحيل فاتورة آجلة بدون اختيار عميل.</p>
                  </div>
                  <Switch id="st-reqcust" checked={sell.requireCustomerForCredit} onCheckedChange={v => setSell(f => ({ ...f, requireCustomerForCredit: v }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>عرض الإيصال الحراري</Label>
                  <Select value={sell.receiptWidth} onValueChange={v => setSell(f => ({ ...f, receiptWidth: v }))}>
                    <SelectTrigger className="h-10 w-full" aria-label="عرض الإيصال"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="58">58 مم (محفظة)</SelectItem>
                      <SelectItem value="80">80 مم (عريض)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-idle">قفل الخمول (دقيقة — 1 إلى 240)</Label>
                  <Input id="st-idle" inputMode="numeric" value={sell.idleLockMinutes} onChange={e => setSell(f => ({ ...f, idleLockMinutes: e.target.value }))} className="h-10 tabular-nums" autoComplete="off" />
                </div>
              </div>

              {sellError ? (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{sellError}</p>
              ) : null}

              <div className="flex justify-end">
                <Button type="button" className="h-10" onClick={() => void saveSell()} disabled={sellBusy}>
                  <Save className="h-4 w-4" aria-hidden />
                  {sellBusy ? 'جارٍ الحفظ…' : 'حفظ إعدادات البيع'}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ==================== المستخدمون ==================== */}
        {canUsers ? (
          <TabsContent value="users">
            <div className="mb-4 flex justify-end">
              <Button type="button" className="h-10" onClick={() => { setNewUser({ username: '', displayName: '', role: 'CASHIER', password: '' }); setNewUserError(''); setNewUserOpen(true) }}>
                <UserPlus className="h-4 w-4" aria-hidden />
                مستخدم جديد
              </Button>
            </div>

            {usersError ? <ErrorBanner message={usersError} onRetry={loadUsers} /> : null}

            {usersLoading ? (
              <LoadingRows rows={4} />
            ) : users && users.length === 0 ? (
              <EmptyState title="لا مستخدمين" hint="أنشئ مستخدمي الكاشير والمخزون والإنتاج بمصفوفة صلاحيات جاهزة." />
            ) : users ? (
              <TableShell>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-cream-200">
                    <tr>
                      <th className="p-3 text-start font-semibold">اسم المستخدم</th>
                      <th className="p-3 text-start font-semibold">الاسم المعروض</th>
                      <th className="p-3 text-start font-semibold">الدور</th>
                      <th className="p-3 text-start font-semibold">آخر دخول</th>
                      <th className="p-3 text-start font-semibold">الحالة</th>
                      <th className="p-3 text-start font-semibold">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className={cn('border-t transition-colors hover:bg-cream-100', !u.active && 'opacity-60')}>
                        <td className="p-3 font-mono text-xs" dir="ltr">{u.username}</td>
                        <td className="p-3 font-semibold">{u.displayName}{u.id === user.id ? <Badge variant="secondary" className="ms-2">أنت</Badge> : null}</td>
                        <td className="p-3"><Badge variant="outline">{ROLE_LABELS[u.role] ?? u.role}</Badge></td>
                        <td className="p-3 text-muted-foreground">{u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</td>
                        <td className="p-3">
                          {u.active ? (
                            <Badge className="bg-ok-600 text-white gap-1"><span aria-hidden>✓</span> مفعّل</Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1"><span aria-hidden>⏸</span> معطّل</Badge>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-9"
                              onClick={() => { setEditUser(u); setEditForm({ displayName: u.displayName, role: u.role, active: u.active }) }}
                              aria-label={`تعديل ${u.username}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                              تعديل
                            </Button>
                            {isOwner || u.id === user.id ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-9"
                                onClick={() => { setPwUser(u); setNewPassword(''); setCurrentPassword(''); setPwError('') }}
                                aria-label={`تغيير كلمة مرور ${u.username}`}
                              >
                                <KeyRound className="h-4 w-4" aria-hidden />
                                كلمة المرور
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            ) : null}
          </TabsContent>
        ) : null}

        {/* ==================== النسخ الاحتياطي ==================== */}
        {canBackup ? (
          <TabsContent value="backup">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* تنزيل */}
              <section className="rounded-xl border bg-card p-4 md:p-6" aria-label="تنزيل نسخة احتياطية">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <DownloadCloud className="h-5 w-5 text-copper-600" aria-hidden />
                  تنزيل نسخة احتياطية
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  ملف JSON كامل بكل الجداول وإصدار المخطط — احفظه في مكان آمن خارج الجهاز.
                </p>
                <Button type="button" className="mt-4 h-10" onClick={() => void downloadBackup()} disabled={backupBusy}>
                  <DatabaseBackup className="h-4 w-4" aria-hidden />
                  {backupBusy ? 'جارٍ التنزيل…' : 'تنزيل نسخة احتياطية'}
                </Button>
              </section>

              {/* بيانات تجريبية */}
              <section className="rounded-xl border bg-card p-4 md:p-6" aria-label="بيانات تجريبية">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <FileUp className="h-5 w-5 text-copper-600" aria-hidden />
                  بيانات تجريبية
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  بيانات اصطناعية موسومة بـ«تجريبي» لتجربة النظام — تعمل فقط على قاعدة فارغة بلا عمليات فعلية.
                </p>
                <Button type="button" variant="outline" className="mt-4 h-10" onClick={() => setDemoOpen(true)} disabled={demoBusy}>
                  {demoBusy ? 'جارٍ التحميل…' : 'تحميل بيانات تجريبية'}
                </Button>
              </section>

              {/* استعادة */}
              <section className="rounded-xl border bg-card p-4 md:p-6 lg:col-span-2" aria-label="استعادة من ملف">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <UploadCloud className="h-5 w-5 text-copper-600" aria-hidden />
                  استعادة من ملف
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  الاستعادة تستبدل كل البيانات الحالية بالكامل — تأكد من وجود نسخة حديثة أولًا.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={e => onPickFile(e.target.files?.[0])}
                    className="h-10 max-w-sm"
                    aria-label="ملف النسخة الاحتياطية"
                  />
                  {fileName ? <span className="text-sm text-muted-foreground">الملف: {fileName}</span> : null}
                  <Button type="button" variant="outline" className="h-10" onClick={() => void runPreview()} disabled={!fileData || backupBusy}>
                    {backupBusy ? 'جارٍ الفحص…' : 'فحص ومعاينة'}
                  </Button>
                </div>

                {backupError ? (
                  <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{backupError}</p>
                ) : null}

                {preview ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border bg-cream-100/60 p-3 text-sm">
                      <b>معاينة الملف:</b> إصدار المخطط {preview.schemaVersion}
                      {preview.exportedAt ? <> — صُدّر {dateTime(preview.exportedAt)}</> : null}
                      {' '}— الإجمالي {preview.totalRows} سجلًا.
                    </div>

                    <div className="overflow-hidden rounded-xl border">
                      <div className="nice-scroll max-h-48 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-cream-200">
                            <tr>
                              <th className="p-2.5 text-start font-semibold">الجدول</th>
                              <th className="p-2.5 text-start font-semibold">عدد السجلات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.tables.map(t => (
                              <tr key={t.table} className={cn('border-t', t.rows === 0 && 'opacity-60')}>
                                <td className="p-2.5 font-mono text-xs" dir="ltr">{t.table}</td>
                                <td className="p-2.5 tabular-nums">{t.rows}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {preview.warnings.length > 0 ? (
                      <div className="rounded-lg border border-copper-500/50 bg-copper-100/40 p-3 text-sm" role="alert">
                        <b className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" aria-hidden />تحذيرات:</b>
                        <ul className="mt-1 list-inside list-disc space-y-0.5">
                          {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    ) : null}

                    <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm font-semibold text-destructive">
                      ⚠ {preview.message}
                    </p>

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="restore-confirm"
                        checked={confirmUnderstood}
                        onCheckedChange={v => setConfirmUnderstood(v === true)}
                      />
                      <Label htmlFor="restore-confirm" className="cursor-pointer text-sm font-semibold">
                        أفهم أن الاستعادة ستحل محل كل البيانات الحالية
                      </Label>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="destructive"
                        className="h-10"
                        onClick={() => void runRestore()}
                        disabled={!confirmUnderstood || backupBusy}
                      >
                        {backupBusy ? 'جارٍ الاستعادة…' : 'استعادة الآن'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          </TabsContent>
        ) : null}

        {/* ==================== حول النظام ==================== */}
        <TabsContent value="about">
          <div className="max-w-2xl space-y-4">
            <div className="rounded-xl border bg-card p-4 md:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cocoa-900 text-xl font-black text-copper-400" aria-hidden>و</span>
                <div>
                  <h2 className="text-lg font-bold">نظام إدارة {settings.businessName}</h2>
                  <p className="text-sm text-muted-foreground">الإصدار 1.0.0 {status ? `— إصدار المخطط ${status.schemaVersion}` : ''}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
                <li>• البيانات محلية SQLite على هذا الجهاز — النظام يعمل دون إنترنت.</li>
                <li>• النسخ الاحتياطية ملفات JSON قابلة للنقل بين الأجهزة ويمكن استعادتها في أي وقت.</li>
                <li>• كلمات المرور مُلبَّدة بـ scrypt مع Salt مستقل لكل مستخدم — لا تُخزن نصًا أبدًا.</li>
                <li>• تنبيه أمان: قاعدة البيانات المحلية ليست حماية ضد من يملك الجهاز — احمِ الجهاز نفسه واحفظ النسخ الاحتياطية في مكان آمن.</li>
                <li>• الأموال تُخزن بالأغورة (أعداد صحيحة) والكميات بالألفية — بلا أخذ عائم في الحسابات المالية.</li>
                <li>• سجل التدقيق يوثق كل عملية حساسة للقراءة فقط — لا تعديل ولا حذف من أي واجهة.</li>
              </ul>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ===== مستخدم جديد ===== */}
      <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>مستخدم جديد</DialogTitle>
            <DialogDescription>
              الدور يحدد صلاحيات المستخدم تلقائيًا (المالك يملك الكل، والكاشير يقتصر على البيع والتحصيل).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nu-username">اسم المستخدم * (إنجليزي/أرقام)</Label>
              <Input id="nu-username" value={newUser.username} onChange={e => setNewUser(f => ({ ...f, username: e.target.value }))} className="h-10" dir="ltr" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-display">الاسم المعروض *</Label>
              <Input id="nu-display" value={newUser.displayName} onChange={e => setNewUser(f => ({ ...f, displayName: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>الدور *</Label>
              <Select value={newUser.role} onValueChange={v => setNewUser(f => ({ ...f, role: v }))}>
                <SelectTrigger className="h-10 w-full" aria-label="دور المستخدم"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-password">كلمة المرور * (8 أحرف على الأقل)</Label>
              <Input id="nu-password" type="password" value={newUser.password} onChange={e => setNewUser(f => ({ ...f, password: e.target.value }))} className="h-10" dir="ltr" autoComplete="new-password" />
            </div>
          </div>
          {newUserError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{newUserError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setNewUserOpen(false)} disabled={newUserBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitNewUser()} disabled={newUserBusy}>
              {newUserBusy ? 'جارٍ الإنشاء…' : 'إنشاء المستخدم'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تعديل مستخدم ===== */}
      <Dialog open={!!editUser} onOpenChange={v => { if (!v) setEditUser(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تعديل المستخدم {editUser?.username}</DialogTitle>
            <DialogDescription>
              حمايات مدمجة: لا يمكن تعطيل حسابك أو إزالة دور المالك من آخر مالك نشط.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="eu-display">الاسم المعروض</Label>
              <Input id="eu-display" value={editForm.displayName} onChange={e => setEditForm(f => ({ ...f, displayName: e.target.value }))} className="h-10" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>الدور</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="h-10 w-full" aria-label="دور المستخدم"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="eu-active" checked={editForm.active} onCheckedChange={v => setEditForm(f => ({ ...f, active: v }))} />
              <Label htmlFor="eu-active">مفعّل (التعطيل يُنهي جلساته فورًا)</Label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setEditUser(null)} disabled={editBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitEditUser()} disabled={editBusy}>
              {editBusy ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تغيير كلمة المرور ===== */}
      <Dialog open={!!pwUser} onOpenChange={v => { if (!v) setPwUser(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تغيير كلمة مرور {pwUser?.displayName}</DialogTitle>
            <DialogDescription>
              {pwUser?.id === user.id
                ? 'أنت تغير كلمة مرورك — أدخل الحالية للتأكيد.'
                : 'المالك يغير كلمة مرور أي مستخدم دون الحاجة للحالية.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {pwUser?.id === user.id ? (
              <div className="space-y-1.5">
                <Label htmlFor="pw-current">كلمة المرور الحالية *</Label>
                <Input id="pw-current" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="h-10" dir="ltr" autoComplete="current-password" />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="pw-new">كلمة المرور الجديدة * (8 أحرف على الأقل)</Label>
              <Input id="pw-new" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="h-10" dir="ltr" autoComplete="new-password" />
            </div>
          </div>
          {pwError ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm font-semibold text-destructive" role="alert">{pwError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={() => setPwUser(null)} disabled={pwBusy}>إلغاء</Button>
            <Button type="button" className="h-10" onClick={() => void submitPassword()} disabled={pwBusy}>
              {pwBusy ? 'جارٍ التغيير…' : 'تغيير كلمة المرور'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== تحميل بيانات تجريبية ===== */}
      <AlertDialog open={demoOpen} onOpenChange={v => { if (!v) setDemoOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تحميل بيانات تجريبية؟</AlertDialogTitle>
            <AlertDialogDescription>
              بيانات اصطناعية موسومة بـ«تجريبي» — تعمل فقط على قاعدة فارغة بلا عمليات فعلية. لن تُخلط ببيانات حقيقية أبدًا.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10">رجوع</AlertDialogCancel>
            <AlertDialogAction className="h-10" disabled={demoBusy} onClick={e => { e.preventDefault(); void loadDemo() }}>
              {demoBusy ? 'جارٍ التحميل…' : 'تحميل البيانات التجريبية'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

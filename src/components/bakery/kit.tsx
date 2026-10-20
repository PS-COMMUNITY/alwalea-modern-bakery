'use client'

// =============================================================
// عناصر واجهة مشتركة — مخبز الولاء الحديث
// =============================================================

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

/** تنسيق مبلغ بالأغورة إلى نص */
export function money(minor: number | null | undefined, symbol = '₪', decimals = 2): string {
  const v = ((minor ?? 0) / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${v} ${symbol}`
}

/** تنسيق كمية ألفية إلى نص */
export function qty(milli: number | null | undefined): string {
  const v = (milli ?? 0) / 1000
  const s = Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return s
}

/** تنسيق تاريخ ووقت */
export function dateTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
}

export function dateOnly(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-cocoa-900 dark:text-cream-100">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function StatCard({
  title, value, hint, icon, tone = 'default',
}: {
  title: string
  value: string
  hint?: string
  icon?: ReactNode
  tone?: 'default' | 'good' | 'bad' | 'accent'
}) {
  const tones = {
    default: 'border-border',
    good: 'border-ok-600/40 bg-ok-100/50',
    bad: 'border-destructive/40 bg-destructive/5',
    accent: 'border-copper-500/50 bg-copper-100/40',
  }
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm', tones[tone])}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{title}</span>
        {icon ? <span className="text-copper-600">{icon}</span> : null}
      </div>
      <div className="mt-1 text-xl md:text-2xl font-bold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-center">
      <Inbox className="h-10 w-10 text-cocoa-300" aria-hidden />
      <div className="font-semibold">{title}</div>
      {hint ? <div className="text-sm text-muted-foreground max-w-sm">{hint}</div> : null}
      {action}
    </div>
  )
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-destructive" role="alert">
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <span className="text-sm font-medium">{message}</span>
      {onRetry ? (
        <button onClick={onRetry} className="ms-auto text-sm font-semibold underline underline-offset-4">
          إعادة المحاولة
        </button>
      ) : null}
    </div>
  )
}

export function StatusBadge({ status, paymentStatus }: { status?: string; paymentStatus?: string }) {
  if (status === 'CANCELLED') {
    return (
      <Badge variant="outline" className="border-destructive/50 text-destructive gap-1">
        <span aria-hidden>✕</span> ملغاة
      </Badge>
    )
  }
  if (paymentStatus === 'PAID') {
    return (
      <Badge className="bg-ok-600 text-white gap-1">
        <span aria-hidden>✓</span> مدفوعة
      </Badge>
    )
  }
  if (paymentStatus === 'PARTIAL') {
    return (
      <Badge className="bg-copper-500 text-white gap-1">
        <span aria-hidden>◐</span> جزئية
      </Badge>
    )
  }
  if (paymentStatus === 'UNPAID') {
    return (
      <Badge variant="outline" className="border-copper-600 text-copper-700 gap-1">
        <span aria-hidden>◔</span> آجلة
      </Badge>
    )
  }
  return null
}

/** جدول مبسط بحاوية قابلة للتمرير */
export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border bg-card overflow-hidden', className)}>
      <div className="nice-scroll overflow-x-auto max-h-[70vh] overflow-y-auto">{children}</div>
    </div>
  )
}

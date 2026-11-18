import type * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { Toast as RadixToast } from 'radix-ui'
import { en } from '@/i18n/en'
import { cn } from '@/ui/lib/utils'

export type ToastVariant = 'default' | 'success' | 'warning' | 'error'

const variantStyles: Record<ToastVariant, string> = {
  default: 'border-border bg-card text-card-foreground',
  success: 'border-emerald-500/40 bg-card text-card-foreground',
  warning: 'border-amber-500/40 bg-card text-card-foreground',
  error: 'border-destructive/50 bg-card text-card-foreground',
}

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  default: <Info className="size-4 shrink-0 text-primary" aria-hidden="true" />,
  success: (
    <CheckCircle2 className="size-4 shrink-0 text-[var(--status-mastered)]" aria-hidden="true" />
  ),
  warning: (
    <AlertTriangle className="size-4 shrink-0 text-[var(--status-learning)]" aria-hidden="true" />
  ),
  error: <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />,
}

export const ToastProvider = RadixToast.Provider

export function ToastViewport({
  className,
  ...props
}: React.ComponentProps<typeof RadixToast.Viewport>) {
  return (
    <RadixToast.Viewport
      aria-label={en.toast.regionLabel}
      className={cn(
        'fixed right-4 bottom-4 z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function ToastRoot({
  className,
  variant = 'default',
  children,
  ...props
}: React.ComponentProps<typeof RadixToast.Root> & { variant?: ToastVariant }) {
  return (
    <RadixToast.Root
      className={cn(
        'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-3.5 shadow-lg transition-all',
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {variantIcons[variant]}
      <div className="min-w-0 flex-1">{children}</div>
    </RadixToast.Root>
  )
}

export function ToastTitle({ className, ...props }: React.ComponentProps<typeof RadixToast.Title>) {
  return <RadixToast.Title className={cn('text-sm font-medium', className)} {...props} />
}

export function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof RadixToast.Description>) {
  return (
    <RadixToast.Description
      className={cn('mt-0.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

export function ToastAction({
  className,
  ...props
}: React.ComponentProps<typeof RadixToast.Action>) {
  return (
    <RadixToast.Action
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center rounded-sm border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted',
        className,
      )}
      {...props}
    />
  )
}

export function ToastClose({ className, ...props }: React.ComponentProps<typeof RadixToast.Close>) {
  return (
    <RadixToast.Close
      aria-label={en.toast.closeLabel}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className,
      )}
      toast-close=""
      {...props}
    >
      <X className="size-3.5" aria-hidden="true" />
    </RadixToast.Close>
  )
}

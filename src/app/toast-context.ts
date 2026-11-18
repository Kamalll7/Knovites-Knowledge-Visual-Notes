import { createContext, useContext } from 'react'
import type { ToastVariant } from '@/ui/components/toast'

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  durationMs?: number
  action?: {
    label: string
    altText: string
    onClick: () => void
  }
}

export interface ToastContextValue {
  notify: (toast: ToastInput) => string
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastHost')
  }
  return ctx
}

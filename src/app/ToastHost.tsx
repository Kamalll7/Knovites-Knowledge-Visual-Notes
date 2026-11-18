import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastContextValue, type ToastInput } from '@/app/toast-context'
import {
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from '@/ui/components/toast'

interface ToastItem extends ToastInput {
  id: string
  open: boolean
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const notify = useCallback((input: ToastInput) => {
    counterRef.current += 1
    const id = `toast-${counterRef.current}`
    setToasts((prev) => [...prev.slice(-3), { ...input, id, open: true }])
    return id
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      notify,
      dismiss,
    }),
    [notify, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      <ToastProvider swipeDirection="right">
        {children}
        {toasts.map((item) => (
          <ToastRoot
            key={item.id}
            open={item.open}
            duration={item.durationMs ?? 5000}
            variant={item.variant}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id)
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <ToastTitle>{item.title}</ToastTitle>
                {item.description ? <ToastDescription>{item.description}</ToastDescription> : null}
              </div>
              <ToastClose />
            </div>
            {item.action ? (
              <div className="mt-2">
                <ToastAction altText={item.action.altText} onClick={item.action.onClick}>
                  {item.action.label}
                </ToastAction>
              </div>
            ) : null}
          </ToastRoot>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  )
}

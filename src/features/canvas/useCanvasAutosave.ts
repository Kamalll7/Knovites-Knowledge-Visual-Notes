import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasJson } from '@/domain/schema'

export const CANVAS_AUTOSAVE_DEBOUNCE_MS = 400

export type CanvasAutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface UseCanvasAutosaveOptions {
  readonly nodeId: string
  readonly initialDoc: CanvasJson
  readonly readOnly: boolean
  readonly onSaveDoc?: (doc: CanvasJson) => Promise<boolean>
  readonly onSaveStatusChange?: (status: CanvasAutosaveStatus) => void
  readonly debounceMs?: number
}

export interface UseCanvasAutosaveResult {
  readonly doc: CanvasJson
  readonly updateDoc: (updater: (prev: CanvasJson) => CanvasJson) => void
  readonly flush: () => Promise<void>
}

/**
 * Debounced 400 ms canvas autosave hook (`FR-CVS-07`):
 * - Coalesces rapid immutable edits into a single `onSaveDoc` call.
 * - Forces flush on unmount, `blur`, `visibilitychange` (hidden), and `pagehide`.
 * - Never writes when opened without edits (preserves lazy root `'__root__'` contract) or `readOnly`.
 */
export function useCanvasAutosave({
  nodeId,
  initialDoc,
  readOnly,
  onSaveDoc,
  onSaveStatusChange,
  debounceMs = CANVAS_AUTOSAVE_DEBOUNCE_MS,
}: UseCanvasAutosaveOptions): UseCanvasAutosaveResult {
  const [doc, setDoc] = useState<CanvasJson>(initialDoc)
  const latestDocRef = useRef<CanvasJson>(initialDoc)
  const isDirtyRef = useRef<boolean>(false)
  const revisionRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef<boolean>(true)
  const readOnlyRef = useRef<boolean>(readOnly)
  const onSaveDocRef = useRef(onSaveDoc)
  const onStatusRef = useRef(onSaveStatusChange)

  useEffect(() => {
    readOnlyRef.current = readOnly
    onSaveDocRef.current = onSaveDoc
    onStatusRef.current = onSaveStatusChange
  }, [readOnly, onSaveDoc, onSaveStatusChange])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flush = useCallback(async () => {
    clearTimer()
    if (!isDirtyRef.current || readOnlyRef.current || !onSaveDocRef.current) {
      return
    }
    const snapshot = latestDocRef.current
    const savedRevision = revisionRef.current
    isDirtyRef.current = false
    if (mountedRef.current) {
      onStatusRef.current?.('saving')
    }

    try {
      const ok = await onSaveDocRef.current(snapshot)
      if (!ok) {
        if (revisionRef.current === savedRevision) {
          isDirtyRef.current = true
        }
        if (mountedRef.current) {
          onStatusRef.current?.('error')
        }
        return
      }
      if (mountedRef.current && revisionRef.current === savedRevision) {
        onStatusRef.current?.('saved')
      }
    } catch {
      if (revisionRef.current === savedRevision) {
        isDirtyRef.current = true
      }
      if (mountedRef.current) {
        onStatusRef.current?.('error')
      }
    }
  }, [clearTimer])

  const updateDoc = useCallback(
    (updater: (prev: CanvasJson) => CanvasJson) => {
      if (readOnlyRef.current) return
      const prev = latestDocRef.current
      const next = updater(prev)
      if (next === prev) return

      latestDocRef.current = next
      revisionRef.current += 1
      isDirtyRef.current = true
      setDoc(next)
      onStatusRef.current?.('saving')

      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush()
      }, debounceMs)
    },
    [clearTimer, debounceMs, flush],
  )

  useEffect(() => {
    mountedRef.current = true
    const handleBlurOrHide = () => {
      if (isDirtyRef.current) {
        void flush()
      }
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirtyRef.current) {
        void flush()
      }
    }

    window.addEventListener('blur', handleBlurOrHide)
    window.addEventListener('pagehide', handleBlurOrHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mountedRef.current = false
      window.removeEventListener('blur', handleBlurOrHide)
      window.removeEventListener('pagehide', handleBlurOrHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (isDirtyRef.current) {
        void flush()
      } else {
        clearTimer()
      }
    }
  }, [nodeId, flush, clearTimer])

  return { doc, updateDoc, flush }
}

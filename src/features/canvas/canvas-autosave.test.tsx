import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyCanvas, type CanvasJson } from '@/domain/schema'
import { addTextElementToCanvas } from '@/features/canvas/canvas-model'
import { CANVAS_AUTOSAVE_DEBOUNCE_MS, useCanvasAutosave } from '@/features/canvas/useCanvasAutosave'

describe('useCanvasAutosave 400 ms debounce & lifecycle flush [T4.2, FR-CVS-07]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces rapid edits into a single save after 400 ms', async () => {
    const onSaveDoc = vi.fn<(doc: CanvasJson) => Promise<boolean>>().mockResolvedValue(true)
    const onSaveStatusChange = vi.fn()

    const { result } = renderHook(() =>
      useCanvasAutosave({
        nodeId: '01JC8ZQ4M7X2K9T5VB3N6D8RHW',
        initialDoc: createEmptyCanvas(),
        readOnly: false,
        onSaveDoc,
        onSaveStatusChange,
      }),
    )

    expect(CANVAS_AUTOSAVE_DEBOUNCE_MS).toBe(400)

    act(() => {
      result.current.updateDoc(
        (prev) =>
          addTextElementToCanvas(prev, { x: 40, y: 40, text: 'One', now: '2026-11-27T11:00:00Z' })
            .doc,
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(onSaveDoc).not.toHaveBeenCalled()

    act(() => {
      result.current.updateDoc(
        (prev) =>
          addTextElementToCanvas(prev, { x: 80, y: 80, text: 'Two', now: '2026-11-27T11:00:01Z' })
            .doc,
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(399)
    })
    expect(onSaveDoc).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(onSaveDoc).toHaveBeenCalledTimes(1)
    const savedDoc = onSaveDoc.mock.calls[0]![0]
    expect(Object.keys(savedDoc.elements)).toHaveLength(2)
    expect(onSaveStatusChange).toHaveBeenLastCalledWith('saved')
  })

  it('flushes pending edits on unmount and never writes when opened without edits or readOnly', async () => {
    const onSaveDoc = vi.fn<(doc: CanvasJson) => Promise<boolean>>().mockResolvedValue(true)

    // 1. Open and unmount without edits -> 0 writes (lazy root guarantee)
    const clean = renderHook(() =>
      useCanvasAutosave({
        nodeId: '__root__',
        initialDoc: createEmptyCanvas(),
        readOnly: false,
        onSaveDoc,
      }),
    )
    clean.unmount()
    expect(onSaveDoc).not.toHaveBeenCalled()

    // 2. Edit then unmount before 400 ms elapses -> immediate flush preserves edit
    const dirty = renderHook(() =>
      useCanvasAutosave({
        nodeId: '01JC8ZQ4M7X2K9T5VB3N6D8RHW',
        initialDoc: createEmptyCanvas(),
        readOnly: false,
        onSaveDoc,
      }),
    )
    act(() => {
      dirty.result.current.updateDoc(
        (prev) =>
          addTextElementToCanvas(prev, {
            x: 10,
            y: 20,
            text: 'Flush me',
            now: '2026-11-27T11:00:00Z',
          }).doc,
      )
    })
    expect(onSaveDoc).not.toHaveBeenCalled()
    dirty.unmount()
    expect(onSaveDoc).toHaveBeenCalledTimes(1)
    expect(Object.keys(onSaveDoc.mock.calls[0]![0].elements)).toHaveLength(1)

    // 3. Read-only mode blocks edits and saves
    onSaveDoc.mockClear()
    const ro = renderHook(() =>
      useCanvasAutosave({
        nodeId: '01JC8ZQ4M7X2K9T5VB3N6D8RHW',
        initialDoc: createEmptyCanvas(),
        readOnly: true,
        onSaveDoc,
      }),
    )
    act(() => {
      ro.result.current.updateDoc(
        (prev) =>
          addTextElementToCanvas(prev, {
            x: 10,
            y: 20,
            text: 'Blocked',
            now: '2026-11-27T11:00:00Z',
          }).doc,
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    ro.unmount()
    expect(onSaveDoc).not.toHaveBeenCalled()
  })
})

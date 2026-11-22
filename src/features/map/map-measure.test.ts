import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

import {
  TRUNCATION_ELLIPSIS,
  createCanvasTextMeasurer,
  truncateLabelEnd,
  type Canvas2DMeasureContextLike,
  type FontFaceSetLike,
} from '@/features/map/map-measure'

describe('map-measure [T3.4a, FR-MAP-09]', () => {
  it('caches Canvas2D widths per font and invalidates cache when fake document.fonts becomes ready or emits loadingdone', async () => {
    let charWidth = 7
    const measureSpy = vi.fn((text: string) => ({ width: text.length * charWidth }))
    const fakeCtx: Canvas2DMeasureContextLike = {
      font: '',
      measureText: measureSpy,
    }

    let resolveReady!: () => void
    const loadingDoneListeners = new Set<() => void>()
    const fakeFonts: FontFaceSetLike = {
      ready: new Promise<void>((resolve) => {
        resolveReady = resolve
      }),
      addEventListener: (_type, fn) => {
        loadingDoneListeners.add(fn)
      },
      removeEventListener: (_type, fn) => {
        loadingDoneListeners.delete(fn)
      },
    }

    const measurer = createCanvasTextMeasurer({ context: fakeCtx, fontSet: fakeFonts })
    const fontA = '500 13px Inter, sans-serif'
    const fontB = '500 14px Inter, sans-serif'

    expect(measurer.getFontVersion()).toBe(0)
    expect(measurer.measure('Knowledge', fontA)).toBe(63)
    expect(measurer.measure('Knowledge', fontA)).toBe(63)
    expect(measureSpy).toHaveBeenCalledTimes(1)
    expect(measurer.getCacheSize()).toBe(1)

    expect(measurer.measure('Knowledge', fontB)).toBe(63)
    expect(measureSpy).toHaveBeenCalledTimes(2)
    expect(measurer.getCacheSize()).toBe(2)

    const versionEvents: number[] = []
    const unsubscribe = measurer.subscribeFontChange((v) => versionEvents.push(v))

    charWidth = 8
    resolveReady()
    const versionAfterReady = await measurer.waitForFontsReady()
    expect(versionAfterReady).toBeGreaterThanOrEqual(1)
    expect(measurer.getCacheSize()).toBe(0)
    expect(measurer.measure('Knowledge', fontA)).toBe(72)
    expect(measureSpy).toHaveBeenCalledTimes(3)

    const countBefore = versionEvents.length
    for (const fn of loadingDoneListeners) fn()
    expect(versionEvents.length).toBe(countBefore + 1)
    expect(measurer.getFontVersion()).toBe(versionEvents[versionEvents.length - 1])

    unsubscribe()
    const countAfterUnsub = versionEvents.length
    for (const fn of loadingDoneListeners) fn()
    expect(versionEvents.length).toBe(countAfterUnsub)
  })

  it('falls back deterministically when Canvas2D context is null', () => {
    const measurer = createCanvasTextMeasurer({ context: null, fontSet: null })
    expect(measurer.measure('', '500 13px Inter')).toBe(0)
    const w13 = measurer.measure('Hello', '500 13px Inter')
    const w26 = measurer.measure('Hello', '500 26px Inter')
    expect(w13).toBeGreaterThan(0)
    expect(w26).toBeCloseTo(w13 * 2, 6)
  })

  it('truncates labels with ellipsis strictly at the end while preserving leading characters', () => {
    const measure = (text: string) => text.length * 8
    const short = truncateLabelEnd('Short', 100, '500 13px Inter', measure)
    expect(short).toEqual({ displayTitle: 'Short', isTruncated: false })

    const long = truncateLabelEnd('Memory Exploitation Basics', 80, '500 13px Inter', measure)
    expect(long.isTruncated).toBe(true)
    expect(long.displayTitle.endsWith(TRUNCATION_ELLIPSIS)).toBe(true)
    expect(long.displayTitle.startsWith(TRUNCATION_ELLIPSIS)).toBe(false)
    expect(long.displayTitle.startsWith('Memory')).toBe(true)
    expect(measure(long.displayTitle)).toBeLessThanOrEqual(80)

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.integer({ min: 8, max: 320 }),
        (title, maxW) => {
          const res = truncateLabelEnd(title, maxW, '500 13px Inter', measure)
          expect(measure(res.displayTitle)).toBeLessThanOrEqual(maxW)
          if (res.isTruncated) {
            expect(res.displayTitle.endsWith(TRUNCATION_ELLIPSIS)).toBe(true)
            const prefix = res.displayTitle.slice(0, -1)
            expect(title.startsWith(prefix)).toBe(true)
          } else {
            expect(res.displayTitle).toBe(title)
          }
        },
      ),
      { numRuns: 100 },
    )
  })
})


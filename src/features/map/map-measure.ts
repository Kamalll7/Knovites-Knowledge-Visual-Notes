import { DEFAULT_RADIAL_LAYOUT_CONFIG, type TextMeasurerFn } from '@/domain/layout'

/**
 * Shared capsule box-sizing contract passed by map renderers into `computeRadialLayout`
 * and `computeHorizontalLayout` (`T3.4c`, `FR-MAP-09`).
 * - `capsulePaddingXPx = 36`: left pad (8) + status dot/icon + gap (18) + right pad (10).
 * - `capsuleMetaWidthPx = 44`: reserves width for ` · N` badge up to 4 digits (`· 9999`) at `fonts.badgePx` (11 px).
 * - `capsuleMaxWidthPx` (268 px) and `fonts` stay locked to `DEFAULT_RADIAL_LAYOUT_CONFIG`.
 */
export const MAP_CAPSULE_BOX_CONFIG = Object.freeze({
  capsuleMinWidthPx: DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMinWidthPx,
  capsuleMaxWidthPx: DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMaxWidthPx,
  capsulePaddingXPx: 36,
  capsuleMetaWidthPx: 44,
  fonts: DEFAULT_RADIAL_LAYOUT_CONFIG.fonts,
} as const)

/**
 * Fallback average proportional Latin glyph advance ratio relative to font size (px)
 * used only when Canvas2D `getContext('2d')` is unavailable (e.g. headless jsdom).
 */
export const FALLBACK_AVG_CHAR_WIDTH_RATIO = 0.56

/** Default fallback font size (px) aligned with `DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.tier1Px`. */
export const FALLBACK_DEFAULT_FONT_PX = 13

/** End-only truncation suffix required by `docs/plan.md` Syarat M3 (`FR-MAP-09`). */
export const TRUNCATION_ELLIPSIS = '…'

export interface Canvas2DMeasureContextLike {
  font: string
  measureText(text: string): { readonly width: number }
}

export interface FontFaceSetLike {
  readonly ready: Promise<unknown>
  addEventListener?(type: 'loadingdone', listener: () => void): void
  removeEventListener?(type: 'loadingdone', listener: () => void): void
}

export interface CanvasTextMeasurer {
  readonly measure: TextMeasurerFn
  clearCache(): void
  getCacheSize(): number
  getFontVersion(): number
  waitForFontsReady(fontSet?: FontFaceSetLike | null): Promise<number>
  subscribeFontChange(
    listener: (version: number) => void,
    fontSet?: FontFaceSetLike | null,
  ): () => void
}

export interface CreateCanvasTextMeasurerOptions {
  readonly context?: Canvas2DMeasureContextLike | null
  readonly fontSet?: FontFaceSetLike | null
}

function parseFontPx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font)
  if (!match) return FALLBACK_DEFAULT_FONT_PX
  const px = Number.parseFloat(match[1]!)
  return Number.isFinite(px) && px > 0 ? px : FALLBACK_DEFAULT_FONT_PX
}

function resolveDefaultContext(): Canvas2DMeasureContextLike | null {
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('2d')
  } catch {
    return null
  }
}

function resolveDefaultFontSet(): FontFaceSetLike | null {
  if (typeof document === 'undefined') return null
  const fonts = (document as { fonts?: FontFaceSetLike }).fonts
  return fonts && typeof fonts.ready?.then === 'function' ? fonts : null
}

/**
 * Creates a Canvas2D text measurer with per-font width caching and font-readiness
 * version tracking so map layouts recompute cleanly once web fonts finish loading.
 */
export function createCanvasTextMeasurer(
  options?: CreateCanvasTextMeasurerOptions,
): CanvasTextMeasurer {
  const cacheByFont = new Map<string, Map<string, number>>()
  const listeners = new Set<(version: number) => void>()
  let ctx: Canvas2DMeasureContextLike | null | undefined = options?.context
  let fontVersion = 0

  const getContext = (): Canvas2DMeasureContextLike | null => {
    if (ctx === undefined) ctx = resolveDefaultContext()
    return ctx
  }

  const clearCache = (): void => {
    cacheByFont.clear()
  }

  const bumpFontVersion = (): number => {
    clearCache()
    fontVersion += 1
    for (const listener of listeners) listener(fontVersion)
    return fontVersion
  }

  const measure: TextMeasurerFn = (text: string, font: string): number => {
    if (text.length === 0) return 0
    let fontCache = cacheByFont.get(font)
    const cached = fontCache?.get(text)
    if (cached !== undefined) return cached

    const context = getContext()
    let width: number
    if (context) {
      context.font = font
      width = context.measureText(text).width
    } else {
      width = text.length * parseFontPx(font) * FALLBACK_AVG_CHAR_WIDTH_RATIO
    }

    if (!fontCache) {
      fontCache = new Map<string, number>()
      cacheByFont.set(font, fontCache)
    }
    fontCache.set(text, width)
    return width
  }

  const getCacheSize = (): number => {
    let total = 0
    for (const fontMap of cacheByFont.values()) total += fontMap.size
    return total
  }

  const waitForFontsReady = async (fontSet?: FontFaceSetLike | null): Promise<number> => {
    const target = fontSet !== undefined ? fontSet : (options?.fontSet ?? resolveDefaultFontSet())
    if (!target) return fontVersion
    await target.ready
    return bumpFontVersion()
  }

  const subscribeFontChange = (
    listener: (version: number) => void,
    fontSet?: FontFaceSetLike | null,
  ): (() => void) => {
    listeners.add(listener)
    const target = fontSet !== undefined ? fontSet : (options?.fontSet ?? resolveDefaultFontSet())
    let active = true
    const onLoadingDone = (): void => {
      if (!active) return
      bumpFontVersion()
    }
    if (target) {
      void target.ready.then(() => {
        if (!active) return
        bumpFontVersion()
      })
      target.addEventListener?.('loadingdone', onLoadingDone)
    }
    return () => {
      active = false
      listeners.delete(listener)
      target?.removeEventListener?.('loadingdone', onLoadingDone)
    }
  }

  return {
    measure,
    clearCache,
    getCacheSize,
    getFontVersion: () => fontVersion,
    waitForFontsReady,
    subscribeFontChange,
  }
}

/**
 * Truncates a label with `…` strictly at the end (`docs/plan.md` Syarat M3, `FR-MAP-09`).
 * Leading characters are always preserved intact; never produces leading ellipsis.
 */
export function truncateLabelEnd(
  text: string,
  maxWidthPx: number,
  font: string,
  measure: TextMeasurerFn,
): { readonly displayTitle: string; readonly isTruncated: boolean } {
  if (text.length === 0 || maxWidthPx <= 0) {
    return { displayTitle: '', isTruncated: text.length > 0 }
  }
  if (measure(text, font) <= maxWidthPx) {
    return { displayTitle: text, isTruncated: false }
  }
  const ellipsisW = measure(TRUNCATION_ELLIPSIS, font)
  if (ellipsisW > maxWidthPx) {
    return { displayTitle: TRUNCATION_ELLIPSIS, isTruncated: true }
  }
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(`${text.slice(0, mid)}${TRUNCATION_ELLIPSIS}`, font) <= maxWidthPx) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  const prefix = text.slice(0, lo).trimEnd()
  return { displayTitle: `${prefix}${TRUNCATION_ELLIPSIS}`, isTruncated: true }
}

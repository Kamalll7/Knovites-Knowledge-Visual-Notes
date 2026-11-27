import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANVAS_STYLE_TOKENS, HIGHLIGHT_COLOR_TOKENS, TEXT_COLOR_TOKENS } from '@/domain/schema'
import {
  CANVAS_TOKEN_PALETTE,
  isFrameNoneStyle,
  resolveCanvasCardBgCss,
  resolveCanvasCardBorderCss,
  resolveTextColorCss,
} from '@/features/canvas/canvas-tokens'

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '')
  const channels = [0, 2, 4].map((idx) => {
    const v = Number.parseInt(clean.slice(idx, idx + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex)
  const l2 = relativeLuminance(bgHex)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

describe('canvas semantic tokens & WCAG AA contrast [T4.2, FR-CVS-05]', () => {
  it('resolves all semantic card, border, text color, and frame "none" tokens cleanly', () => {
    expect(isFrameNoneStyle({ bg: 'none', border: 'none' })).toBe(true)
    expect(isFrameNoneStyle({ bg: 'auto', border: 'none' })).toBe(false)
    expect(isFrameNoneStyle({ bg: 'auto', border: 'auto' })).toBe(false)

    expect(resolveCanvasCardBgCss('auto')).toBe('var(--canvas-card-bg-auto)')
    expect(resolveCanvasCardBgCss('none')).toBe('transparent')
    expect(resolveCanvasCardBorderCss('auto')).toBe('var(--canvas-card-border-auto)')
    expect(resolveCanvasCardBorderCss('none')).toBe('transparent')

    for (const token of CANVAS_STYLE_TOKENS) {
      expect(resolveCanvasCardBgCss(token)).toBeTruthy()
      expect(resolveCanvasCardBorderCss(token)).toBeTruthy()
    }

    for (const token of TEXT_COLOR_TOKENS) {
      expect(resolveTextColorCss(token)).toBe(`var(--canvas-text-${token})`)
    }
    expect(resolveTextColorCss('#ff0000')).toBeNull()
    expect(resolveTextColorCss(null)).toBeNull()
  })

  it('keeps src/ui/tokens.css synchronized with CANVAS_TOKEN_PALETTE and passes WCAG 2.1 AA (>= 4.5:1) across dark & light themes', () => {
    const tokensCss = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../ui/tokens.css'),
      'utf8',
    )

    for (const theme of ['light', 'dark'] as const) {
      const p = CANVAS_TOKEN_PALETTE[theme]

      // Ensure CSS variables exist in src/ui/tokens.css with the exact verified hex values
      for (const token of TEXT_COLOR_TOKENS) {
        expect(tokensCss.toLowerCase()).toContain(
          `--canvas-text-${token}: ${p.text[token].toLowerCase()};`,
        )
      }
      for (const token of HIGHLIGHT_COLOR_TOKENS) {
        expect(tokensCss.toLowerCase()).toContain(
          `--canvas-hl-${token}-bg: ${p.highlight[token].bg.toLowerCase()};`,
        )
        expect(tokensCss.toLowerCase()).toContain(
          `--canvas-hl-${token}-fg: ${p.highlight[token].fg.toLowerCase()};`,
        )
      }

      // Check WCAG AA (>= 4.5:1) for default --fg AND all 5 text tokens on --bg (frame "none"),
      // --surface (frame "auto"), and all 5 tinted card backgrounds
      const surfaces: Array<[string, string]> = [
        ['none (--bg)', p.canvasBg],
        ['auto (--surface)', p.cardBg.auto],
        ...TEXT_COLOR_TOKENS.map((t): [string, string] => [`card:${t}`, p.cardBg[t]]),
      ]

      for (const [surfaceName, bgHex] of surfaces) {
        expect(
          contrastRatio(p.defaultFg, bgHex),
          `${theme} defaultFg on ${surfaceName}`,
        ).toBeGreaterThanOrEqual(4.5)

        for (const textToken of TEXT_COLOR_TOKENS) {
          expect(
            contrastRatio(p.text[textToken], bgHex),
            `${theme} text:${textToken} on ${surfaceName}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      }

      // Check WCAG AA (>= 4.5:1) for all 4 highlight fg/bg pairs
      for (const hlToken of HIGHLIGHT_COLOR_TOKENS) {
        const pair = p.highlight[hlToken]
        expect(
          contrastRatio(pair.fg, pair.bg),
          `${theme} highlight:${hlToken}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

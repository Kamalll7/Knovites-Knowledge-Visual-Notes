import type { ComputeVisibleResult } from '@/domain/layout'
import type { NodeStatus } from '@/domain/schema'

export type MapThemeMode = 'dark' | 'light'

/** WCAG 2.1 AA minimum normal-text contrast ratio (`docs/spec-ui-nfr.md` §7.4). */
export const WCAG_AA_TEXT_CONTRAST = 4.5

/**
 * Minimum HSL hue separation (degrees) between consecutive slots in the 8-branch cycle
 * (`src/ui/tokens.css` `--branch-1..8`, measured 26.7° light / 26.9° dark).
 */
export const MIN_ADJACENT_BRANCH_HUE_DEG = 25

/**
 * Minimum HSL hue separation (degrees) across all non-adjacent pairs in existing
 * `src/ui/tokens.css` `--branch-1..8` (measured 10.2° light b3/b7, 12.5° dark b2/b6).
 */
export const MIN_ALL_PAIRS_BRANCH_HUE_DEG = 10

/** Capsule tint strength mixed onto `--surface` (normal, focus path, active focus). */
export const CAPSULE_TINT_ALPHA = Object.freeze({
  base: 0.1,
  focusPath: 0.14,
  focus: 0.22,
} as const)

/** Per-depth lighten mix factor toward `--bg`/`#ffffff` for descendant accents (`FR-MAP-09`). */
export const DEPTH_LIGHTEN_STEP = 0.09
export const DEPTH_LIGHTEN_MAX = 0.36

export interface MapThemePalette {
  readonly bg: string
  readonly surface: string
  readonly surface2: string
  readonly border: string
  readonly fg: string
  readonly fgMuted: string
  readonly accent: string
  readonly status: Readonly<Record<Exclude<NodeStatus, 'none'>, string>>
  readonly branches: readonly [string, string, string, string, string, string, string, string]
}

/** Exact hex values mirrored from `src/ui/tokens.css` (no hexes invented outside tokens). */
export const MAP_THEME_PALETTES: Readonly<Record<MapThemeMode, MapThemePalette>> = Object.freeze({
  light: Object.freeze({
    bg: '#f6f8fc',
    surface: '#ffffff',
    surface2: '#eef2f8',
    border: '#d5dce8',
    fg: '#0f172a',
    fgMuted: '#475569',
    accent: '#3451d1',
    status: Object.freeze({
      learning: '#b45309',
      practiced: '#1d4ed8',
      mastered: '#047857',
    }),
    branches: [
      '#3b5bdb',
      '#0f766e',
      '#be185d',
      '#b45309',
      '#6d28d9',
      '#047857',
      '#be123c',
      '#0369a1',
    ] as const,
  }),
  dark: Object.freeze({
    bg: '#0b0e14',
    surface: '#11151d',
    surface2: '#171c27',
    border: '#232a38',
    fg: '#e6e9f0',
    fgMuted: '#8a93a6',
    accent: '#7c9cff',
    status: Object.freeze({
      learning: '#fbbf24',
      practiced: '#60a5fa',
      mastered: '#34d399',
    }),
    branches: [
      '#7c9cff',
      '#5eead4',
      '#f9a8d4',
      '#fbbf24',
      '#a78bfa',
      '#34d399',
      '#fb7185',
      '#38bdf8',
    ] as const,
  }),
})

export interface RgbColor {
  readonly r: number
  readonly g: number
  readonly b: number
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/

export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value)
}

export function hexToRgb(hex: string): RgbColor {
  const match = HEX_COLOR_RE.exec(hex)
  if (!match) throw new Error(`Invalid #rrggbb hex color: ${hex}`)
  const digits = match[1]!
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  }
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function mixHex(foregroundHex: string, backgroundHex: string, weight: number): string {
  const t = Math.max(0, Math.min(1, weight))
  const fg = hexToRgb(foregroundHex)
  const bg = hexToRgb(backgroundHex)
  return rgbToHex({
    r: fg.r * t + bg.r * (1 - t),
    g: fg.g * t + bg.g * (1 - t),
    b: fg.b * t + bg.b * (1 - t),
  })
}

/** WCAG 2.1 relative luminance for an `#rrggbb` color. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colors (`1..21`). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA)
  const lB = relativeLuminance(hexB)
  return (Math.max(lA, lB) + 0.05) / (Math.min(lA, lB) + 0.05)
}

/** Returns HSL hue in `[0, 360)` for an `#rrggbb` color. */
export function hexToHueDeg(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  if (delta === 0) return 0
  const raw =
    max === rn
      ? ((gn - bn) / delta) % 6
      : max === gn
        ? (bn - rn) / delta + 2
        : (rn - gn) / delta + 4
  return (raw * 60 + 360) % 360
}

/** Shortest angular hue distance in degrees (`0..180`). */
export function hueDistanceDeg(hexA: string, hexB: string): number {
  const diff = Math.abs(hexToHueDeg(hexA) - hexToHueDeg(hexB))
  return Math.min(diff, 360 - diff)
}

function hashBranchIndex(id: string, paletteLength: number): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  }
  return (h >>> 0) % paletteLength
}

/**
 * Lightens a branch accent progressively with tree depth (`FR-MAP-09`) while keeping
 * colors derived strictly from existing theme palette tokens.
 */
export function accentForDepth(baseAccentHex: string, depth: number, theme: MapThemeMode): string {
  const steps = Math.max(0, depth - 1)
  if (steps === 0) return baseAccentHex
  const factor = Math.min(DEPTH_LIGHTEN_MAX, steps * DEPTH_LIGHTEN_STEP)
  const lightenTarget =
    theme === 'dark' ? MAP_THEME_PALETTES.dark.fg : MAP_THEME_PALETTES.light.surface
  return mixHex(lightenTarget, baseAccentHex, factor)
}

export interface NodeColorStyles {
  readonly accentHex: string
  readonly fillHex: string
  readonly borderHex: string
  readonly textHex: string
  readonly branchIndex: number | null
}

/**
 * Assigns deterministic branch hues to top-level branches (hash + adjacent sibling
 * collision avoidance), lightens descendants by depth, and honors `node.color` overrides.
 */
export function assignMapNodeColors(
  visible: ComputeVisibleResult,
  theme: MapThemeMode,
): ReadonlyMap<string, NodeColorStyles> {
  const palette = MAP_THEME_PALETTES[theme]
  const branchCount = palette.branches.length
  const rootNode = visible.nodes[visible.rootId]
  const topLevelIds = rootNode ? [...rootNode.visibleChildIds] : []

  const branchIdxByTopId = new Map<string, number>()
  let prevIdx = -1
  for (const topId of topLevelIds) {
    let idx = hashBranchIndex(topId, branchCount)
    if (idx === prevIdx) idx = (idx + 1) % branchCount
    branchIdxByTopId.set(topId, idx)
    prevIdx = idx
  }

  const styles = new Map<string, NodeColorStyles>()
  for (const id of visible.orderedIds) {
    const vNode = visible.nodes[id]
    if (!vNode) continue
    if (vNode.kind === 'root' || vNode.kind === 'overflow') {
      styles.set(id, {
        accentHex: palette.accent,
        fillHex: palette.surface2,
        borderHex: vNode.isFocus ? palette.accent : palette.border,
        textHex: palette.fg,
        branchIndex: null,
      })
      continue
    }

    const branchRootId = vNode.branchRootId ?? (vNode.depth === 1 ? vNode.id : null)
    const branchIdx =
      branchRootId !== null
        ? (branchIdxByTopId.get(branchRootId) ?? hashBranchIndex(branchRootId, branchCount))
        : 0
    const branchRootNode = branchRootId !== null ? visible.nodes[branchRootId] : undefined
    const inheritedBranchHex =
      branchRootNode && isHexColor(branchRootNode.color)
        ? branchRootNode.color
        : palette.branches[branchIdx]!
    const baseHex = isHexColor(vNode.color) ? vNode.color : inheritedBranchHex
    const accentHex = isHexColor(vNode.color)
      ? baseHex
      : accentForDepth(baseHex, vNode.depth, theme)
    const tintAlpha = vNode.isFocus
      ? CAPSULE_TINT_ALPHA.focus
      : vNode.isOnFocusPath
        ? CAPSULE_TINT_ALPHA.focusPath
        : CAPSULE_TINT_ALPHA.base
    const fillHex = mixHex(accentHex, palette.surface, tintAlpha)
    const borderHex = vNode.isFocus
      ? accentHex
      : vNode.isOnFocusPath
        ? mixHex(accentHex, palette.border, 0.72)
        : palette.border

    styles.set(id, {
      accentHex,
      fillHex,
      borderHex,
      textHex: palette.fg,
      branchIndex: isHexColor(vNode.color) ? null : branchIdx,
    })
  }

  return styles
}

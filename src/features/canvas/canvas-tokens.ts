import {
  isCanvasStyleToken,
  isHighlightColorToken,
  isTextColorToken,
  type CanvasStyleToken,
  type CanvasTextStyle,
  type HighlightColorToken,
  type TextColorToken,
} from '@/domain/schema'

export interface CanvasThemePalette {
  readonly canvasBg: string
  readonly defaultFg: string
  readonly text: Readonly<Record<TextColorToken, string>>
  readonly highlight: Readonly<
    Record<HighlightColorToken, { readonly bg: string; readonly fg: string }>
  >
  readonly cardBg: Readonly<Record<Exclude<CanvasStyleToken, 'none'>, string>>
  readonly cardBorder: Readonly<Record<Exclude<CanvasStyleToken, 'none'>, string>>
}

/**
 * Canonical hex values mirroring `src/ui/tokens.css` for automated WCAG 2.1 AA contrast checks.
 */
export const CANVAS_TOKEN_PALETTE: Readonly<Record<'light' | 'dark', CanvasThemePalette>> = {
  light: {
    canvasBg: '#f6f8fc',
    defaultFg: '#0f172a',
    text: {
      accent: '#2741b8',
      warning: '#854d0e',
      success: '#065f46',
      danger: '#991b1b',
      violet: '#5b21b6',
    },
    highlight: {
      warning: { bg: '#fde68a', fg: '#0f172a' },
      success: { bg: '#a7f3d0', fg: '#0f172a' },
      accent: { bg: '#dbeafe', fg: '#0f172a' },
      danger: { bg: '#fecdd3', fg: '#0f172a' },
    },
    cardBg: {
      auto: '#ffffff',
      accent: '#eff4ff',
      warning: '#fef9e7',
      success: '#ecfdf5',
      danger: '#fef2f2',
      violet: '#f5f3ff',
    },
    cardBorder: {
      auto: '#d5dce8',
      accent: '#93b4ff',
      warning: '#eab308',
      success: '#34d399',
      danger: '#f87171',
      violet: '#a78bfa',
    },
  },
  dark: {
    canvasBg: '#0b0e14',
    defaultFg: '#e6e9f0',
    text: {
      accent: '#93b4ff',
      warning: '#fbbf24',
      success: '#34d399',
      danger: '#fca5a5',
      violet: '#c4b5fd',
    },
    highlight: {
      warning: { bg: '#4a350a', fg: '#fef3c7' },
      success: { bg: '#0d3b2e', fg: '#d1fae5' },
      accent: { bg: '#1e2d5a', fg: '#dbeafe' },
      danger: { bg: '#4c1722', fg: '#ffe4e6' },
    },
    cardBg: {
      auto: '#11151d',
      accent: '#131b2e',
      warning: '#221a0c',
      success: '#0f211c',
      danger: '#241319',
      violet: '#1b162c',
    },
    cardBorder: {
      auto: '#232a38',
      accent: '#3b5bdb',
      warning: '#b45309',
      success: '#047857',
      danger: '#be123c',
      violet: '#6d28d9',
    },
  },
}

export function isFrameNoneStyle(style?: Partial<CanvasTextStyle> | null): boolean {
  return style?.bg === 'none' && style?.border === 'none'
}

export function resolveCanvasCardBgCss(token: CanvasStyleToken | unknown): string {
  if (token === 'none') return 'transparent'
  if (isCanvasStyleToken(token)) return `var(--canvas-card-bg-${token})`
  return 'var(--canvas-card-bg-auto)'
}

export function resolveCanvasCardBorderCss(token: CanvasStyleToken | unknown): string {
  if (token === 'none') return 'transparent'
  if (isCanvasStyleToken(token)) return `var(--canvas-card-border-${token})`
  return 'var(--canvas-card-border-auto)'
}

export function resolveTextColorCss(token: unknown): string | null {
  if (!isTextColorToken(token)) return null
  return `var(--canvas-text-${token})`
}

export function resolveHighlightToken(token: unknown): HighlightColorToken | null {
  return isHighlightColorToken(token) ? token : null
}

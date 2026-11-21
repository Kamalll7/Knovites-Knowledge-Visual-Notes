import { FontFamily } from '@tiptap/extension-font-family'
import { Highlight } from '@tiptap/extension-highlight'
import { Link } from '@tiptap/extension-link'
import { TextAlign } from '@tiptap/extension-text-align'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { FontSize } from '@tiptap/extension-text-style/font-size'
import { Underline } from '@tiptap/extension-underline'
import { Fragment, Mark, Node as PMNode, Slice } from '@tiptap/pm/model'
import { StarterKit } from '@tiptap/starter-kit'
import { createContext } from 'react'
import { ULID_REGEX, type TipTapDoc, type TipTapNode } from '@/domain/schema'

const KNOVITES_HREF_REGEX = new RegExp(`^knovites:${ULID_REGEX.source.slice(1, -1)}$`)

export const FONT_FAMILY_OPTIONS = [
  { label: 'Inter', value: "'Inter Variable', system-ui, sans-serif" },
  { label: 'Lora', value: "'Lora', Georgia, serif" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', ui-monospace, monospace" },
  { label: 'Caveat', value: "'Caveat', cursive" },
  { label: 'System Sans', value: 'system-ui, sans-serif' },
  { label: 'System Serif', value: 'Georgia, serif' },
] as const

export const FONT_SIZE_OPTIONS = ['12px', '14px', '16px', '20px', '24px', '32px', '48px'] as const

export type TextColorTokenName = 'accent' | 'warning' | 'success' | 'danger' | 'violet'

export interface SemanticColorSwatch {
  label: string
  token: TextColorTokenName | null
  cssVar: string | null
  referenceRgb: readonly [number, number, number] | null
}

export const TEXT_COLOR_TOKENS: readonly SemanticColorSwatch[] = [
  { label: 'Auto', token: null, cssVar: null, referenceRgb: null },
  {
    label: 'Accent',
    token: 'accent',
    cssVar: 'var(--text-token-accent)',
    referenceRgb: [80, 120, 235],
  },
  {
    label: 'Warning',
    token: 'warning',
    cssVar: 'var(--text-token-warning)',
    referenceRgb: [205, 130, 20],
  },
  {
    label: 'Success',
    token: 'success',
    cssVar: 'var(--text-token-success)',
    referenceRgb: [20, 165, 115],
  },
  {
    label: 'Danger',
    token: 'danger',
    cssVar: 'var(--text-token-danger)',
    referenceRgb: [220, 65, 65],
  },
  {
    label: 'Violet',
    token: 'violet',
    cssVar: 'var(--text-token-violet)',
    referenceRgb: [135, 85, 235],
  },
] as const

const TEXT_COLOR_TOKEN_SET = new Set<string>(
  TEXT_COLOR_TOKENS.flatMap((t) => (t.token ? [t.token] : [])),
)

export function isSemanticColorToken(value: unknown): value is TextColorTokenName {
  return typeof value === 'string' && TEXT_COLOR_TOKEN_SET.has(value)
}

export function resolveTextColorCss(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (isSemanticColorToken(trimmed)) {
    return `var(--text-token-${trimmed})`
  }
  const hex = normalizeHexColor(trimmed)
  return hex
}

export function mapHexToSemanticToken(hex: string): TextColorTokenName {
  const clean = normalizeHexColor(hex)
  if (!clean) return 'accent'
  const r = Number.parseInt(clean.slice(1, 3), 16)
  const g = Number.parseInt(clean.slice(3, 5), 16)
  const b = Number.parseInt(clean.slice(5, 7), 16)

  let best: TextColorTokenName = 'accent'
  let bestDist = Infinity
  for (const entry of TEXT_COLOR_TOKENS) {
    if (!entry.token || !entry.referenceRgb) continue
    const [er, eg, eb] = entry.referenceRgb
    const dist = (r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = entry.token
    }
  }
  return best
}

export function resolveSemanticColorToken(raw: unknown): TextColorTokenName | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (isSemanticColorToken(trimmed)) {
    return trimmed
  }
  const varMatch = /^var\(\s*--text-token-(accent|warning|success|danger|violet)\s*\)$/i.exec(
    trimmed,
  )
  if (varMatch && varMatch[1]) {
    return varMatch[1].toLowerCase() as TextColorTokenName
  }
  const normalizedHex = normalizeHexColor(trimmed)
  if (normalizedHex) {
    return mapHexToSemanticToken(normalizedHex)
  }
  return null
}

/**
 * Nilai gaya frame kotak teks tanpa menambah properti baru (`style.bg` / `style.border`).
 * `null` = Auto (tema `--card` / `--border`), `'#rrggbb'` = warna kustom, `'none'` = transparan/tanpa garis.
 */
export type FrameStyleValue = string | null

export interface TextBoxStyle {
  bg: FrameStyleValue
  border: FrameStyleValue
}

export function isFrameNoneStyle(style?: Partial<TextBoxStyle> | null): boolean {
  return style?.bg === 'none' && style?.border === 'none'
}

export type NodeKind = 'text' | 'image' | 'terminal'
export type ResizeMode = 'reflow' | 'scale' | 'aspect' | 'free'

export interface ResizePolicy {
  nodeType: NodeKind
  minW: number
  maxW: number
  minH: number
  maxH: number
  keepAspect: boolean
  defaultMode: ResizeMode
  availableModes: readonly ResizeMode[]
  minScale?: number
  maxScale?: number
}

export const RESIZE_POLICIES: Record<NodeKind, ResizePolicy> = {
  text: {
    nodeType: 'text',
    minW: 160,
    maxW: 720,
    minH: 44,
    maxH: 1400,
    keepAspect: false,
    defaultMode: 'reflow',
    availableModes: ['reflow', 'scale'],
    minScale: 0.5,
    maxScale: 3.0,
  },
  image: {
    nodeType: 'image',
    minW: 80,
    maxW: 1920,
    minH: 60,
    maxH: 1920,
    keepAspect: true,
    defaultMode: 'aspect',
    availableModes: ['aspect', 'free'],
  },
  // Kontrak konseptual untuk dokumentasi S2b (tidak diimplementasikan di spike)
  terminal: {
    nodeType: 'terminal',
    minW: 320,
    maxW: 1400,
    minH: 180,
    maxH: 900,
    keepAspect: false,
    defaultMode: 'free',
    availableModes: ['free'],
  },
} as const

export function computeNextTextScale(
  targetVisualWidth: number,
  baseWidth: number,
  policy: ResizePolicy = RESIZE_POLICIES.text,
): number {
  const minScale = policy.minScale ?? 0.5
  const maxScale = policy.maxScale ?? 3.0
  const safeBase = Math.max(1, baseWidth)
  const raw = targetVisualWidth / safeBase
  const clamped = Math.max(minScale, Math.min(maxScale, raw))
  return Number(clamped.toFixed(4))
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

export function isAllowedSpikeHref(href: string): boolean {
  if (href.length === 0 || href !== href.trim() || hasControlCharacter(href)) {
    return false
  }
  if (KNOVITES_HREF_REGEX.test(href)) {
    return true
  }
  try {
    const parsed = new URL(href)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname.length > 0
    }
    if (parsed.protocol === 'mailto:') {
      return href.slice('mailto:'.length).trim().length > 0
    }
    return false
  } catch {
    return false
  }
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(trimmed) ?? []
    if (r && g && b) {
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
  }
  const rgbMatch =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(
      trimmed,
    )
  if (rgbMatch) {
    const toHex = (n: string) =>
      Math.max(0, Math.min(255, Number.parseInt(n, 10)))
        .toString(16)
        .padStart(2, '0')
    return `#${toHex(rgbMatch[1]!)}${toHex(rgbMatch[2]!)}${toHex(rgbMatch[3]!)}`
  }
  return null
}

const ALLOWED_TEXT_ALIGN = new Set(['left', 'center', 'right'])

export function sanitizeSpikeDoc(input: TipTapDoc): {
  doc: TipTapDoc
  rejectedAlignments: string[]
} {
  const rejectedAlignments: string[] = []

  const cleanNode = (node: TipTapNode): TipTapNode => {
    const next: TipTapNode = { type: node.type }
    if (node.text !== undefined) next.text = node.text

    if (node.attrs && typeof node.attrs === 'object') {
      const cleanedAttrs: Record<string, string | number | null> = {}
      for (const [k, v] of Object.entries(node.attrs)) {
        if (k === 'textAlign') {
          if (v === null || v === undefined) {
            continue
          }
          if (typeof v === 'string' && ALLOWED_TEXT_ALIGN.has(v)) {
            cleanedAttrs[k] = v
          } else {
            rejectedAlignments.push(String(v))
          }
          continue
        }
        if (typeof v === 'string' || typeof v === 'number' || v === null) {
          cleanedAttrs[k] = v
        }
      }
      if (Object.keys(cleanedAttrs).length > 0) {
        next.attrs = cleanedAttrs
      }
    }

    if (node.marks && Array.isArray(node.marks)) {
      const cleanedMarks = node.marks
        .map((m) => {
          if (m.type === 'link' && m.attrs) {
            const href = m.attrs['href']
            if (typeof href !== 'string' || !isAllowedSpikeHref(href)) return null
            return { type: 'link' as const, attrs: { href } }
          }
          return m
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
      if (cleanedMarks.length > 0) {
        next.marks = cleanedMarks
      }
    }

    if (node.content && Array.isArray(node.content)) {
      next.content = node.content.map(cleanNode)
    }

    return next
  }

  const root = cleanNode(input as unknown as TipTapNode)
  return {
    doc: root as unknown as TipTapDoc,
    rejectedAlignments,
  }
}

const SemanticColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element) => {
              const tokenAttr = element.getAttribute('data-color-token')
              if (tokenAttr && isSemanticColorToken(tokenAttr)) {
                return tokenAttr
              }
              return resolveSemanticColorToken(element.style.color)
            },
            renderHTML: (attributes) => {
              const raw = attributes['color']
              const cssValue = resolveTextColorCss(raw)
              if (!cssValue) {
                return {}
              }
              return {
                ...(isSemanticColorToken(raw) ? { 'data-color-token': raw } : {}),
                style: `color: ${cssValue}`,
              }
            },
          },
        },
      },
    ]
  },
})

const NoNullTextAlign = TextAlign.extend({
  onBeforeCreate() {
    const originalGetJson = this.editor.getJSON.bind(this.editor)
    this.editor.getJSON = () => {
      const raw = originalGetJson() as TipTapDoc
      return sanitizeSpikeDoc(raw).doc as ReturnType<typeof originalGetJson>
    }
  },
})

/**
 * Shared MIT-only TipTap v3 extensions used identically by both the active editor
 * (`useEditor`) and `@tiptap/static-renderer/pm/react` (`renderToReactElement`).
 */
export function createSpikeExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
      trailingNode: false,
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: false,
      HTMLAttributes: {
        rel: 'noopener noreferrer',
      },
      protocols: ['http', 'https', 'mailto', 'knovites'],
      isAllowedUri: (url) => isAllowedSpikeHref(url),
    }),
    TextStyle,
    SemanticColor,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    NoNullTextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right'],
    }),
  ]
}

export const SPIKE_EXTENSIONS = createSpikeExtensions()

const ALLOWED_FONT_FAMILIES = new Set<string>(FONT_FAMILY_OPTIONS.map((f) => f.value))

/**
 * Sanitizes a pasted ProseMirror `Slice` according to the Knovites whitelist:
 * - Strips invalid link URIs while keeping inner text.
 * - Maps pasted hex/rgb text colors to nearest semantic theme token (or drops invalid color strings).
 * - Rejects `justify` alignment while keeping `left | center | right`.
 */
export function sanitizePastedSlice(slice: Slice): Slice {
  const sanitizeMark = (mark: Mark): Mark | null => {
    const name = mark.type.name
    if (
      name === 'bold' ||
      name === 'italic' ||
      name === 'underline' ||
      name === 'strike' ||
      name === 'code'
    ) {
      return mark
    }
    if (name === 'link') {
      const href = mark.attrs['href']
      if (typeof href === 'string' && isAllowedSpikeHref(href)) {
        return mark.type.create({ href })
      }
      return null
    }
    if (name === 'highlight') {
      const raw = mark.attrs['color']
      if (typeof raw === 'string' && ['warning', 'success', 'accent', 'danger'].includes(raw)) {
        return mark.type.create({ color: raw })
      }
      const hex = normalizeHexColor(raw)
      return hex ? mark.type.create({ color: hex }) : null
    }
    if (name === 'textStyle') {
      const color = resolveSemanticColorToken(mark.attrs['color'])
      const rawFont = mark.attrs['fontFamily']
      const fontFamily =
        typeof rawFont === 'string' && ALLOWED_FONT_FAMILIES.has(rawFont) ? rawFont : null
      const rawSize = mark.attrs['fontSize']
      const fontSize =
        typeof rawSize === 'string' && /^\d{1,3}px$/.test(rawSize.trim()) ? rawSize.trim() : null
      if (!color && !fontFamily && !fontSize) {
        return null
      }
      return mark.type.create({ color, fontFamily, fontSize })
    }
    return null
  }

  const sanitizeFragment = (frag: Fragment): Fragment => {
    const out: PMNode[] = []
    frag.forEach((node) => {
      if (node.isText) {
        const cleanMarks = node.marks.map(sanitizeMark).filter((m): m is Mark => m !== null)
        out.push(node.mark(cleanMarks))
        return
      }
      const cleanChildren = sanitizeFragment(node.content)
      if (node.type.name === 'heading' || node.type.name === 'paragraph') {
        const rawAlign = node.attrs['textAlign']
        const textAlign =
          typeof rawAlign === 'string' && ALLOWED_TEXT_ALIGN.has(rawAlign) ? rawAlign : null
        if (node.type.name === 'heading') {
          const level = node.attrs['level']
          if (level !== 1 && level !== 2 && level !== 3) {
            const paraType = node.type.schema.nodes['paragraph']
            if (paraType) {
              out.push(paraType.create(textAlign ? { textAlign } : null, cleanChildren))
              return
            }
          }
          if (rawAlign !== textAlign) {
            out.push(node.type.create({ ...node.attrs, textAlign }, cleanChildren))
            return
          }
        } else if (rawAlign !== textAlign) {
          out.push(node.type.create(textAlign ? { textAlign } : null, cleanChildren))
          return
        }
      }
      out.push(node.copy(cleanChildren))
    })
    return Fragment.fromArray(out)
  }

  return new Slice(sanitizeFragment(slice.content), slice.openStart, slice.openEnd)
}

export function isDocEffectivelyEmpty(doc: TipTapDoc): boolean {
  const walk = (nodes?: TipTapDoc['content']): boolean => {
    if (!nodes || nodes.length === 0) return true
    for (const node of nodes) {
      if (node.text && node.text.trim().length > 0) return false
      if (node.content && !walk(node.content as TipTapDoc['content'])) return false
    }
    return true
  }
  return walk(doc.content)
}

// Hysteresis thresholds to prevent LOD flicker around boundary zooms:
// Enter LOD below 0.32 (normal 0.36..1.08 zoom sweep never enters), exit only above 0.40.
// Hide LOD title below 0.19 (when screen card is too small for >= 11px text), show again >= 0.23.
export const LOD_ENTER_ZOOM = 0.32
export const LOD_EXIT_ZOOM = 0.4
export const LOD_TITLE_HIDE_ZOOM = 0.19
export const LOD_TITLE_SHOW_ZOOM = 0.23
export const LOD_MIN_SCREEN_FONT_PX = 11

export interface LodZoomState {
  isLod: boolean
  showLodTitle: boolean
  lodFontPx: number
}

export const INITIAL_LOD_ZOOM_STATE: LodZoomState = {
  isLod: false,
  showLodTitle: false,
  lodFontPx: 14,
}

export function computeLodZoomState(zoom: number, prev: LodZoomState): LodZoomState {
  const isLod = prev.isLod ? zoom < LOD_EXIT_ZOOM : zoom < LOD_ENTER_ZOOM
  const showLodTitle =
    isLod && (prev.showLodTitle ? zoom >= LOD_TITLE_HIDE_ZOOM : zoom >= LOD_TITLE_SHOW_ZOOM)
  // Bucket zoom in 0.05 increments so screen fontSize = lodFontPx * zoom always stays >= 12px (>= 11px) without per-frame churn
  const zBucket = Math.max(LOD_TITLE_HIDE_ZOOM, Math.floor(zoom * 20) / 20)
  const lodFontPx = showLodTitle ? Math.ceil((LOD_MIN_SCREEN_FONT_PX + 1) / zBucket) : 0
  if (prev.isLod === isLod && prev.showLodTitle === showLodTitle && prev.lodFontPx === lodFontPx) {
    return prev
  }
  return { isLod, showLodTitle, lodFontPx }
}

export const LodZoomContext = createContext<LodZoomState>(INITIAL_LOD_ZOOM_STATE)

export function extractDocTitle(doc: TipTapDoc): string {
  const walk = (nodes?: TipTapDoc['content']): string => {
    if (!nodes) return ''
    for (const node of nodes) {
      if (node.text && node.text.trim().length > 0) {
        return node.text.trim()
      }
      if (node.content) {
        const inner = walk(node.content as TipTapDoc['content'])
        if (inner.length > 0) return inner
      }
    }
    return ''
  }
  return walk(doc.content) || 'Untitled note'
}

export function createPlainParagraphDoc(text: string): TipTapDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text.length > 0 ? [{ type: 'text', text }] : [],
      },
    ],
  }
}

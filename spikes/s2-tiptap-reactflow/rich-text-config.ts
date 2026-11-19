import { Color } from '@tiptap/extension-color'
import { FontFamily } from '@tiptap/extension-font-family'
import { Highlight } from '@tiptap/extension-highlight'
import { Link } from '@tiptap/extension-link'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { FontSize } from '@tiptap/extension-text-style/font-size'
import { Underline } from '@tiptap/extension-underline'
import { Fragment, Mark, Node as PMNode, Slice } from '@tiptap/pm/model'
import { StarterKit } from '@tiptap/starter-kit'
import { ULID_REGEX, type TipTapDoc } from '@/domain/schema'

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

export const TEXT_COLOR_SWATCHES = [
  { label: 'Auto', value: null },
  { label: 'Accent Blue', value: '#7c9cff' },
  { label: 'Amber', value: '#fbbf24' },
  { label: 'Emerald', value: '#34d399' },
  { label: 'Rose', value: '#f87171' },
  { label: 'Violet', value: '#a78bfa' },
] as const

export function isAllowedSpikeHref(href: string): boolean {
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

/**
 * Shared MIT-only TipTap v3 extensions used identically by both the active editor
 * (`useEditor`) and `@tiptap/static-renderer/pm/react` (`renderToReactElement`).
 */
export function createSpikeExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Registered separately below with strict Knovites MIT configuration (StarterKit v3 includes both)
      link: false,
      underline: false,
      // Keep static JSON and live editor height 1:1 (avoid appending a phantom <p> after lists/code blocks)
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
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ]
}

export const SPIKE_EXTENSIONS = createSpikeExtensions()

const ALLOWED_FONT_FAMILIES = new Set<string>(FONT_FAMILY_OPTIONS.map((f) => f.value))

/**
 * Sanitizes a pasted ProseMirror `Slice` according to the Knovites §5.4 whitelist:
 * - Strips invalid link URIs (e.g., `javascript:`, `data:`) while keeping inner text.
 * - Normalizes `rgb(...)` inline colors to `#rrggbb` or drops unparseable colors.
 * - Strips unknown marks/attributes and disallowed heading levels (> 3 -> paragraph).
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
      const hex = normalizeHexColor(mark.attrs['color'])
      return hex ? mark.type.create({ color: hex }) : null
    }
    if (name === 'textStyle') {
      const color = normalizeHexColor(mark.attrs['color'])
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
      if (node.type.name === 'heading') {
        const level = node.attrs['level']
        const textAlign =
          node.attrs['textAlign'] === 'left' ||
          node.attrs['textAlign'] === 'center' ||
          node.attrs['textAlign'] === 'right'
            ? node.attrs['textAlign']
            : null
        if (level !== 1 && level !== 2 && level !== 3) {
          const paraType = node.type.schema.nodes['paragraph']
          if (paraType) {
            out.push(paraType.create(textAlign ? { textAlign } : null, cleanChildren))
            return
          }
        }
      }
      out.push(node.copy(cleanChildren))
    })
    return Fragment.fromArray(out)
  }

  return new Slice(sanitizeFragment(slice.content), slice.openStart, slice.openEnd)
}

export function createPlainParagraphDoc(text: string): TipTapDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text.length > 0 ? [{ type: 'text', text }] : undefined,
      },
    ],
  }
}

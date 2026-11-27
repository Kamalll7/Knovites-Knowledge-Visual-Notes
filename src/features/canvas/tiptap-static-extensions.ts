import { FontFamily } from '@tiptap/extension-font-family'
import { Highlight } from '@tiptap/extension-highlight'
import { Link } from '@tiptap/extension-link'
import { TextAlign } from '@tiptap/extension-text-align'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { FontSize } from '@tiptap/extension-text-style/font-size'
import { Underline } from '@tiptap/extension-underline'
import { StarterKit } from '@tiptap/starter-kit'
import { isAllowedHref, isTextColorToken } from '@/domain/schema'
import { resolveHighlightToken, resolveTextColorCss } from '@/features/canvas/canvas-tokens'

const SemanticColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            renderHTML: (attributes) => {
              const raw = attributes['color']
              if (!isTextColorToken(raw)) return {}
              const cssVar = resolveTextColorCss(raw)
              if (!cssVar) return {}
              return {
                'data-color-token': raw,
                style: `color: ${cssVar}`,
              }
            },
          },
        },
      },
    ]
  },
})

const SemanticHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        renderHTML: (attributes) => {
          const token = resolveHighlightToken(attributes['color'])
          if (!token) return {}
          return {
            'data-highlight-token': token,
            'data-color': token,
          }
        },
      },
    }
  },
})

/**
 * MIT-only TipTap v3 extensions shared by `@tiptap/static-renderer/pm/react` (`FR-TXT-08`).
 * Zero TipTap Pro extensions.
 */
export function createStaticTipTapExtensions() {
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
      isAllowedUri: (url) => isAllowedHref(url),
    }),
    TextStyle,
    SemanticColor,
    FontFamily,
    FontSize,
    SemanticHighlight.configure({ multicolor: true }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right'],
    }),
  ]
}

export const STATIC_TIPTAP_EXTENSIONS = createStaticTipTapExtensions()

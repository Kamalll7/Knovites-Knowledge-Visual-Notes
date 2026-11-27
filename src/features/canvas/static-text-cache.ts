import type { JSONContent } from '@tiptap/core'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'
import { Fragment, createElement, type ReactNode } from 'react'
import { isAllowedHref, sanitizeEditorContent, type TipTapDoc } from '@/domain/schema'
import { STATIC_TIPTAP_EXTENSIONS } from '@/features/canvas/tiptap-static-extensions'

// WeakMap cache keyed by immutable TipTapDoc object reference (Syarat M4 wajib):
// avoids rebuilding ProseMirror Schema & extension mappings on viewport culling remounts.
const renderedDocCache = new WeakMap<TipTapDoc, ReactNode>()

export function hasCachedTipTapDoc(doc: TipTapDoc): boolean {
  return renderedDocCache.has(doc)
}

/**
 * Renders a TipTap JSON document into an immutable React element tree using
 * `@tiptap/static-renderer/pm/react` without `dangerouslySetInnerHTML` or a live editor instance.
 * Enforces `isAllowedHref` and `rel="noopener noreferrer"` on every anchor.
 */
export function renderCachedTipTapDoc(doc: TipTapDoc): ReactNode {
  const cached = renderedDocCache.get(doc)
  if (cached !== undefined) {
    return cached
  }

  const sanitized = sanitizeEditorContent(doc).doc
  const next = renderToReactElement({
    content: sanitized as JSONContent,
    extensions: STATIC_TIPTAP_EXTENSIONS,
    options: {
      markMapping: {
        link: ({ mark, children }) => {
          const rawHref = typeof mark.attrs['href'] === 'string' ? mark.attrs['href'] : ''
          if (!isAllowedHref(rawHref)) {
            return createElement(Fragment, null, children)
          }
          if (rawHref.startsWith('knovites:')) {
            const targetId = rawHref.slice('knovites:'.length)
            return createElement(
              'a',
              {
                href: `#/n/${targetId}`,
                rel: 'noopener noreferrer',
                'data-knovites-link': targetId,
              },
              children,
            )
          }
          return createElement(
            'a',
            {
              href: rawHref,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            children,
          )
        },
      },
      unhandledNode: ({ children }) => createElement(Fragment, null, children),
      unhandledMark: ({ children }) => createElement(Fragment, null, children),
    },
  })

  renderedDocCache.set(doc, next)
  return next
}

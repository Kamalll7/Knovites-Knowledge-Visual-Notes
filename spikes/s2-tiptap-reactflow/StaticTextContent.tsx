import type { JSONContent } from '@tiptap/core'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'
import { memo, useMemo, type ReactNode } from 'react'
import type { TipTapDoc } from '@/domain/schema'
import { SPIKE_EXTENSIONS } from './rich-text-config'

export interface StaticTextContentProps {
  doc: TipTapDoc
}

// Cache immutable React element trees per immutable doc object so viewport culling
// remounts do not rebuild ProseMirror Schema + extension mappings 60+ times per frame.
const renderedDocCache = new WeakMap<TipTapDoc, ReactNode>()

function renderCachedDoc(doc: TipTapDoc): ReactNode {
  const cached = renderedDocCache.get(doc)
  if (cached !== undefined) {
    return cached
  }
  const next = renderToReactElement({
    content: doc as JSONContent,
    extensions: SPIKE_EXTENSIONS,
    options: {
      unhandledNode: ({ children }) => <>{children}</>,
      unhandledMark: ({ children }) => <>{children}</>,
    },
  })
  renderedDocCache.set(doc, next)
  return next
}

/**
 * Pure React static renderer using `@tiptap/static-renderer/pm/react` (MIT).
 * Maps ProseMirror JSON directly to React elements via `React.createElement`,
 * without HTML string concatenation, `dangerouslySetInnerHTML`, or a live TipTap instance.
 */
export const StaticTextContent = memo(function StaticTextContent({ doc }: StaticTextContentProps) {
  const rendered = useMemo(() => renderCachedDoc(doc), [doc])

  return <>{rendered}</>
})

import type { JSONContent } from '@tiptap/core'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'
import { memo, useMemo } from 'react'
import type { TipTapDoc } from '@/domain/schema'
import { SPIKE_EXTENSIONS } from './rich-text-config'

export interface StaticTextContentProps {
  doc: TipTapDoc
}

/**
 * Pure React static renderer using `@tiptap/static-renderer/pm/react` (MIT).
 * Maps ProseMirror JSON directly to React elements via `React.createElement`,
 * without HTML string concatenation, `dangerouslySetInnerHTML`, or a live TipTap instance.
 */
export const StaticTextContent = memo(function StaticTextContent({ doc }: StaticTextContentProps) {
  const rendered = useMemo(
    () =>
      renderToReactElement({
        content: doc as JSONContent,
        extensions: SPIKE_EXTENSIONS,
        options: {
          unhandledNode: ({ children }) => <>{children}</>,
          unhandledMark: ({ children }) => <>{children}</>,
        },
      }),
    [doc],
  )

  return <>{rendered}</>
})

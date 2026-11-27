import { memo, useMemo } from 'react'
import type { TipTapDoc } from '@/domain/schema'
import { renderCachedTipTapDoc } from '@/features/canvas/static-text-cache'

export interface StaticTextContentProps {
  readonly doc: TipTapDoc
}

export const StaticTextContent = memo(function StaticTextContent({ doc }: StaticTextContentProps) {
  const rendered = useMemo(() => renderCachedTipTapDoc(doc), [doc])
  return <>{rendered}</>
})

import type { CanvasJson } from '@/domain/schema'
import { en } from '@/i18n/en'

export interface CanvasWorkspaceProps {
  readonly nodeId: string
  readonly initialDoc: CanvasJson
  readonly isHome: boolean
  readonly readOnly: boolean
  readonly onSaveDoc?: (doc: CanvasJson) => Promise<boolean>
  readonly onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
}

/**
 * Lazy-loaded freeform canvas workspace slot (`T4.1` -> full React Flow + static renderer in `T4.2`).
 */
export function CanvasWorkspace({ nodeId, initialDoc, isHome }: CanvasWorkspaceProps) {
  const elementCount = Object.keys(initialDoc.elements).length
  return (
    <div
      data-testid="canvas-workspace"
      data-node-id={nodeId}
      data-element-count={elementCount}
      className="flex flex-1 flex-col items-center justify-center bg-background p-8 text-center"
    >
      <p className="text-sm font-medium text-foreground">{en.nodePage.canvasPlaceholderTitle}</p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">
        {isHome ? en.nodePage.homeCanvasLazyBody : en.nodePage.canvasPlaceholderBody}
      </p>
    </div>
  )
}

export default CanvasWorkspace

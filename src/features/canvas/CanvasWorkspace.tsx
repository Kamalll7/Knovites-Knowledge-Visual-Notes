import '@xyflow/react/dist/style.css'
import '@/features/canvas/canvas.css'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from '@xyflow/react'
import { Plus, Type } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTheme } from '@/app/theme-context'
import type { CanvasJson } from '@/domain/schema'
import { CanvasImageNode, CanvasTextNode } from '@/features/canvas/CanvasNodes'
import { addTextElementToCanvas, canvasDocToFlowNodes } from '@/features/canvas/canvas-model'
import { useCanvasAutosave, type CanvasAutosaveStatus } from '@/features/canvas/useCanvasAutosave'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

export interface CanvasWorkspaceProps {
  readonly nodeId: string
  readonly initialDoc: CanvasJson
  readonly isHome: boolean
  readonly readOnly: boolean
  readonly onSaveDoc?: (doc: CanvasJson) => Promise<boolean>
  readonly onSaveStatusChange?: (status: CanvasAutosaveStatus) => void
}

const EMPTY_EDGES: Edge[] = []

const CANVAS_NODE_TYPES = {
  canvasText: CanvasTextNode,
  canvasImage: CanvasImageNode,
}

const FIT_VIEW_OPTIONS = {
  padding: 0.2,
  maxZoom: 1,
}

/**
 * Lazy-loaded React Flow freeform canvas with static TipTap rendering (`FR-CVS-01`, `FR-TXT-08`)
 * and 400 ms debounced autosave (`FR-CVS-07`). Always enables `onlyRenderVisibleElements`.
 */
export function CanvasWorkspace({
  nodeId,
  initialDoc,
  isHome,
  readOnly,
  onSaveDoc,
  onSaveStatusChange,
}: CanvasWorkspaceProps) {
  const { resolvedTheme } = useTheme()
  const { doc, updateDoc } = useCanvasAutosave({
    nodeId,
    initialDoc,
    readOnly,
    onSaveDoc,
    onSaveStatusChange,
  })

  const nodes = useMemo(() => canvasDocToFlowNodes(doc), [doc])

  const handleAddTextBox = useCallback(() => {
    if (readOnly) return
    updateDoc((prev) => {
      const count = Object.keys(prev.elements).length
      const offsetX = 80 + (count % 5) * 48
      const offsetY = 80 + Math.floor(count / 5) * 48 + (count % 5) * 24
      return addTextElementToCanvas(prev, {
        x: offsetX,
        y: offsetY,
        text: `${en.canvas.newTextDefault} ${count + 1}`,
      }).doc
    })
  }, [readOnly, updateDoc])

  return (
    <div
      data-testid="canvas-workspace"
      data-node-id={nodeId}
      data-element-count={nodes.length}
      className="relative flex min-h-[460px] flex-1 flex-col bg-background"
    >
      {!readOnly ? (
        <div
          data-testid="canvas-toolbar"
          className="absolute top-3 left-3 z-20 flex items-center gap-1.5 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur-sm"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="canvas-add-text"
            onClick={handleAddTextBox}
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>{en.canvas.addText}</span>
          </Button>
        </div>
      ) : null}

      <div className="relative h-full min-h-[460px] w-full flex-1">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={EMPTY_EDGES}
            nodeTypes={CANVAS_NODE_TYPES}
            onlyRenderVisibleElements={true}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={0.1}
            maxZoom={4}
            panOnDrag={true}
            panOnScroll={true}
            zoomOnScroll={false}
            zoomOnPinch={true}
            forceColorMode={resolvedTheme}
            fitView={nodes.length > 0}
            fitViewOptions={FIT_VIEW_OPTIONS}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="var(--border)"
              bgColor="var(--bg)"
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>

      {nodes.length === 0 ? (
        <div
          data-testid="canvas-empty-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6"
        >
          <div className="pointer-events-auto max-w-sm rounded-xl border border-dashed border-border bg-card/90 p-6 text-center shadow-sm backdrop-blur-sm">
            <Type className="mx-auto size-7 text-primary" aria-hidden="true" />
            <h2 className="mt-2.5 text-sm font-semibold text-foreground">{en.canvas.emptyTitle}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isHome ? en.canvas.homeEmptyBody : en.canvas.emptyBody}
            </p>
            {!readOnly ? (
              <Button
                type="button"
                size="sm"
                data-testid="canvas-empty-add-text"
                onClick={handleAddTextBox}
                className="mt-4 gap-1.5"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                <span>{en.canvas.addText}</span>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default CanvasWorkspace

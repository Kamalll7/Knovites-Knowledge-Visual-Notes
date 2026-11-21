import type { Editor } from '@tiptap/react'
import { NodeResizeControl, type Node, type NodeProps } from '@xyflow/react'
import { GripHorizontal } from 'lucide-react'
import { memo, useContext } from 'react'
import type { TipTapDoc } from '@/domain/schema'
import { ActiveTipTapEditor } from './ActiveTipTapEditor'
import {
  extractDocTitle,
  INITIAL_LOD_ZOOM_STATE,
  LodZoomContext,
  type LodZoomState,
} from './rich-text-config'
import { StaticTextContent } from './StaticTextContent'

export interface TextBoxNodeData extends Record<string, unknown> {
  doc: TipTapDoc
  width: number
  maxHeight?: number
  bg?: string | null
  border?: string | null
  frameNone?: boolean
  isEditing: boolean
  renderInViewportPortal?: boolean
  onEnterEdit: (id: string) => void
  onExitEdit: (id: string) => void
  onDocChange: (id: string, doc: TipTapDoc, hasNetChange: boolean) => void
  onResizeStart?: (id: string) => void
  onResizeWidth?: (id: string, width: number) => void
  onResizeEnd?: (id: string) => void
  onEditorReady?: (id: string, editor: Editor | null) => void
  onEditorMountChange: (instanceId: string, mounted: boolean) => void
}

export type TextBoxNode = Node<TextBoxNodeData, 'textBox'>

export interface TextBoxSurfaceProps {
  id: string
  data: TextBoxNodeData
  selected?: boolean
  lodState?: LodZoomState
  inPortal?: boolean
}

export function TextBoxSurface({
  id,
  data,
  selected = false,
  lodState = INITIAL_LOD_ZOOM_STATE,
  inPortal = false,
}: TextBoxSurfaceProps) {
  const {
    doc,
    width,
    maxHeight,
    bg,
    border,
    frameNone = false,
    isEditing,
    onEnterEdit,
    onExitEdit,
    onDocChange,
    onResizeStart,
    onResizeWidth,
    onResizeEnd,
    onEditorReady,
    onEditorMountChange,
  } = data

  const handleWheelCapture = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    // Prevent canvas zoom/pan whenever the card itself overflows/scrolls
    if (maxHeight !== undefined || el.scrollHeight > el.clientHeight + 1) {
      event.stopPropagation()
    }
  }

  if (lodState.isLod && !isEditing) {
    return (
      <div
        data-testid={`text-box-${id}`}
        data-lod="true"
        onDoubleClick={(event) => {
          event.stopPropagation()
          onEnterEdit(id)
        }}
        className="select-none"
        style={{ width: `${width}px` }}
      >
        <div
          data-testid={`lod-placeholder-${id}`}
          data-frame-mode={frameNone ? 'none' : 'card'}
          className="rounded-xl border p-3.5"
          style={{
            backgroundColor: frameNone ? 'transparent' : (bg ?? 'var(--card)'),
            borderColor: frameNone ? 'transparent' : (border ?? 'var(--border)'),
            minHeight: '76px',
          }}
        >
          {lodState.showLodTitle ? (
            <div
              data-testid={`lod-title-${id}`}
              className="truncate font-semibold text-foreground"
              style={{ fontSize: `${lodState.lodFontPx}px`, lineHeight: 1.2 }}
            >
              {extractDocTitle(doc)}
            </div>
          ) : (
            <div className="h-2.5 w-3/4 rounded bg-muted-foreground/30" />
          )}
          <div className="mt-2 h-2 w-2/3 rounded bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid={inPortal ? `portal-text-box-${id}` : `text-box-${id}`}
      data-editing={isEditing ? 'true' : 'false'}
      data-editor-root={isEditing ? 'true' : undefined}
      data-lod="false"
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (!isEditing) {
          onEnterEdit(id)
        }
      }}
      className="group relative"
      style={{ width: `${width}px` }}
    >
      {/* Top-edge drag handle inside React Flow node slot (outside ViewportPortal so XYDrag stays bound even while editing) */}
      {!inPortal ? (
        <div
          data-testid={`drag-handle-${id}`}
          aria-label={`Drag handle for ${id}`}
          className={`knovites-drag-handle absolute -top-5 left-2 right-2 z-20 flex h-4 cursor-grab items-center justify-center rounded-t-md border border-b-0 border-border bg-secondary/95 text-muted-foreground transition-opacity active:cursor-grabbing ${
            selected || isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <GripHorizontal className="size-3.5" />
        </div>
      ) : null}

      {!inPortal && (selected || isEditing) ? (
        <NodeResizeControl
          nodeId={id}
          position="right"
          resizeDirection="horizontal"
          minWidth={160}
          maxWidth={720}
          onResizeStart={() => onResizeStart?.(id)}
          onResize={(_event, params) => onResizeWidth?.(id, Math.round(params.width))}
          onResizeEnd={() => onResizeEnd?.(id)}
          className="nodrag z-20 flex items-center justify-center rounded border border-border bg-card shadow-sm"
          style={{ width: '10px', height: '24px' }}
        >
          <span
            data-testid={`resize-handle-${id}`}
            aria-label={`Resize width for ${id}`}
            className="block h-3 w-0.5 rounded bg-muted-foreground"
          />
        </NodeResizeControl>
      ) : null}

      {/* Card surface: identical padding, font, background, border between static & edit mode */}
      <div
        data-testid={`card-surface-${id}`}
        data-frame-mode={frameNone ? 'none' : 'card'}
        onWheelCapture={handleWheelCapture}
        className={`rounded-xl border p-3.5 transition-shadow ${frameNone ? '' : 'shadow-sm'} ${
          maxHeight !== undefined ? 'overflow-y-auto' : ''
        } ${isEditing ? 'nodrag nowheel nopan cursor-text select-text' : 'select-none'}`}
        style={{
          backgroundColor: frameNone ? 'transparent' : (bg ?? 'var(--card)'),
          borderColor: frameNone ? 'transparent' : (border ?? 'var(--border)'),
          maxHeight: maxHeight !== undefined ? `${maxHeight}px` : undefined,
          boxShadow: isEditing
            ? '0 0 0 2px var(--accent)'
            : selected
              ? '0 0 0 1.5px var(--accent)'
              : undefined,
        }}
      >
        <div
          data-testid={`richtext-body-${id}`}
          className={`knovites-richtext ${isEditing ? 'nodrag nowheel nopan select-text' : ''}`}
        >
          {isEditing ? (
            <ActiveTipTapEditor
              doc={doc}
              onDocChange={(nextDoc, hasNetChange) => onDocChange(id, nextDoc, hasNetChange)}
              onExitEdit={() => onExitEdit(id)}
              onEditorReady={(ed) => onEditorReady?.(id, ed)}
              onEditorMountChange={onEditorMountChange}
            />
          ) : (
            <StaticTextContent doc={doc} />
          )}
        </div>
      </div>
    </div>
  )
}

export const TextCanvasNode = memo(function TextCanvasNode({
  id,
  data,
  selected,
}: NodeProps<TextBoxNode>) {
  const lodState = useContext(LodZoomContext)

  // When active editor is hosted in ViewportPortal (culling-resilient mitigation), keep an invisible layout placeholder
  // inside React Flow's node slot with active drag + resize handles so XYDrag/XYResizer & bounds stay intact.
  if (data.isEditing && data.renderInViewportPortal) {
    return (
      <div className="relative" style={{ width: `${data.width}px` }}>
        <div
          data-testid={`drag-handle-${id}`}
          aria-label={`Drag handle for ${id}`}
          style={{ pointerEvents: 'all' }}
          className="knovites-drag-handle absolute -top-5 left-2 right-2 z-20 flex h-4 cursor-grab items-center justify-center rounded-t-md border border-b-0 border-border bg-secondary/95 text-muted-foreground opacity-100 active:cursor-grabbing"
        >
          <GripHorizontal className="size-3.5" />
        </div>
        <NodeResizeControl
          nodeId={id}
          position="right"
          resizeDirection="horizontal"
          minWidth={160}
          maxWidth={720}
          onResizeStart={() => data.onResizeStart?.(id)}
          onResize={(_event, params) => data.onResizeWidth?.(id, Math.round(params.width))}
          onResizeEnd={() => data.onResizeEnd?.(id)}
          className="nodrag z-20 flex items-center justify-center rounded border border-border bg-card shadow-sm"
          style={{ pointerEvents: 'all', width: '10px', height: '24px' }}
        >
          <span
            data-testid={`resize-handle-${id}`}
            aria-label={`Resize width for ${id}`}
            className="block h-3 w-0.5 rounded bg-muted-foreground"
          />
        </NodeResizeControl>
        <div
          data-testid={`text-box-${id}`}
          data-editing="true"
          data-portal-placeholder="true"
          data-lod="false"
          aria-hidden="true"
          className="pointer-events-none invisible"
          style={{ width: `${data.width}px` }}
        >
          <div
            className="rounded-xl border p-3.5"
            style={{
              maxHeight: data.maxHeight !== undefined ? `${data.maxHeight}px` : undefined,
            }}
          >
            <div className="knovites-richtext">
              <StaticTextContent doc={data.doc} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <TextBoxSurface id={id} data={data} selected={selected} lodState={lodState} />
})

import type { Editor } from '@tiptap/react'
import { type Node, type NodeProps } from '@xyflow/react'
import { GripHorizontal } from 'lucide-react'
import { memo, useContext } from 'react'
import type { TipTapDoc } from '@/domain/schema'
import { ActiveTipTapEditor } from './ActiveTipTapEditor'
import { extractDocTitle, LodZoomContext } from './rich-text-config'
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
  onEditorReady?: (id: string, editor: Editor | null) => void
  onEditorMountChange: (instanceId: string, mounted: boolean) => void
}

export type TextBoxNode = Node<TextBoxNodeData, 'textBox'>

export interface TextBoxSurfaceProps {
  id: string
  data: TextBoxNodeData
  selected?: boolean
  isLod?: boolean
  inPortal?: boolean
}

export function TextBoxSurface({
  id,
  data,
  selected = false,
  isLod = false,
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

  if (isLod && !isEditing) {
    return (
      <div
        data-testid={`text-box-${id}`}
        data-lod="true"
        className="select-none"
        style={{ width: `${width}px` }}
      >
        <div
          data-testid={`card-surface-${id}`}
          data-frame-mode={frameNone ? 'none' : 'card'}
          className="rounded-xl border p-3.5"
          style={{
            backgroundColor: frameNone ? 'transparent' : (bg ?? 'var(--card)'),
            borderColor: frameNone ? 'transparent' : (border ?? 'var(--border)'),
            minHeight: '76px',
          }}
        >
          <div
            data-testid={`lod-text-${id}`}
            className="truncate text-sm font-semibold text-foreground"
          >
            {extractDocTitle(doc)}
          </div>
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
      {/* Top-edge drag handle (outside layout flow so card geometry never shifts in edit mode) */}
      {!isEditing ? (
        <div
          data-testid={`drag-handle-${id}`}
          aria-label={`Drag handle for ${id}`}
          className={`knovites-drag-handle absolute -top-5 left-2 right-2 flex h-4 cursor-grab items-center justify-center rounded-t-md border border-b-0 border-border bg-secondary/95 text-muted-foreground transition-opacity active:cursor-grabbing ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <GripHorizontal className="size-3.5" />
        </div>
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
  const isZoomLod = useContext(LodZoomContext)

  // When active editor is hosted in ViewportPortal (culling-resilient mitigation), keep a hidden layout placeholder
  // inside React Flow's node slot so bounds/selection stay intact without duplicate TipTap instances or testids.
  if (data.isEditing && data.renderInViewportPortal) {
    return (
      <div
        data-testid={`text-box-${id}`}
        data-editing="true"
        data-portal-placeholder="true"
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
    )
  }

  return <TextBoxSurface id={id} data={data} selected={selected} isLod={isZoomLod} />
})

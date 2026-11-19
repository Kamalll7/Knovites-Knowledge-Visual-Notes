import type { Editor } from '@tiptap/react'
import type { Node, NodeProps } from '@xyflow/react'
import { GripHorizontal } from 'lucide-react'
import { memo, useState } from 'react'
import type { TipTapDoc } from '@/domain/schema'
import { ActiveTipTapEditor } from './ActiveTipTapEditor'
import { FloatingToolbar } from './FloatingToolbar'
import { StaticTextContent } from './StaticTextContent'

export interface TextBoxNodeData extends Record<string, unknown> {
  doc: TipTapDoc
  width: number
  maxHeight?: number
  bg?: string | null
  border?: string | null
  isEditing: boolean
  onEnterEdit: (id: string) => void
  onExitEdit: (id: string) => void
  onDocChange: (id: string, doc: TipTapDoc, hasNetChange: boolean) => void
  onEditorMountChange: (instanceId: string, mounted: boolean) => void
}

export type TextBoxNode = Node<TextBoxNodeData, 'textBox'>

export const TextCanvasNode = memo(function TextCanvasNode({
  id,
  data,
  selected,
}: NodeProps<TextBoxNode>) {
  const {
    doc,
    width,
    maxHeight,
    bg,
    border,
    isEditing,
    onEnterEdit,
    onExitEdit,
    onDocChange,
    onEditorMountChange,
  } = data

  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)

  const handleWheelCapture = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    // Prevent canvas zoom/pan whenever the card is scrollable (`.nowheel` also reinforces this)
    if (maxHeight !== undefined || el.scrollHeight > el.clientHeight + 1) {
      event.stopPropagation()
    }
  }

  return (
    <div
      data-testid={`text-box-${id}`}
      data-editing={isEditing ? 'true' : 'false'}
      data-editor-root={isEditing ? 'true' : undefined}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (!isEditing) {
          onEnterEdit(id)
        }
      }}
      className="group relative"
      style={{ width: `${width}px` }}
    >
      {/* Floating formatting toolbar anchored outside `.knovites-richtext` so pre-wrap/word-break never affects it */}
      {isEditing && activeEditor ? <FloatingToolbar editor={activeEditor} /> : null}

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
        onWheelCapture={handleWheelCapture}
        className={`rounded-xl border p-3.5 shadow-sm transition-shadow ${
          maxHeight !== undefined ? 'nowheel overflow-y-auto' : ''
        } ${isEditing ? 'nodrag nopan cursor-text select-text' : 'select-none'}`}
        style={{
          backgroundColor: bg ?? 'var(--card)',
          borderColor: border ?? 'var(--border)',
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
              onEditorReady={setActiveEditor}
              onEditorMountChange={onEditorMountChange}
            />
          ) : (
            <StaticTextContent doc={doc} />
          )}
        </div>
      </div>
    </div>
  )
})

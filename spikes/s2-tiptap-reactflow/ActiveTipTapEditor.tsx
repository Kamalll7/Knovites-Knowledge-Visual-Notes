import type { JSONContent } from '@tiptap/core'
import { EditorContent, type Editor, useEditor } from '@tiptap/react'
import { useEffect, useId, useRef } from 'react'
import type { TipTapDoc } from '@/domain/schema'
import { SPIKE_EXTENSIONS, sanitizePastedSlice } from './rich-text-config'

export interface ActiveTipTapEditorProps {
  doc: TipTapDoc
  onDocChange: (nextDoc: TipTapDoc, hasNetChange: boolean) => void
  onExitEdit: () => void
  onEditorReady?: (editor: Editor | null) => void
  onEditorMountChange?: (instanceId: string, mounted: boolean) => void
}

/**
 * Single live TipTap editor instance mounted ONLY for the currently edited box.
 * Automatically destroyed on unmount when exiting edit mode or switching boxes.
 */
export function ActiveTipTapEditor({
  doc,
  onDocChange,
  onExitEdit,
  onEditorReady,
  onEditorMountChange,
}: ActiveTipTapEditorProps) {
  const instanceId = useId()
  const onDocChangeRef = useRef(onDocChange)
  const onExitEditRef = useRef(onExitEdit)
  const onMountRef = useRef(onEditorMountChange)
  const onReadyRef = useRef(onEditorReady)
  const baselineJsonRef = useRef<string>('')

  useEffect(() => {
    onDocChangeRef.current = onDocChange
    onExitEditRef.current = onExitEdit
    onMountRef.current = onEditorMountChange
    onReadyRef.current = onEditorReady
  }, [onDocChange, onExitEdit, onEditorMountChange, onEditorReady])

  useEffect(() => {
    const mountFn = onMountRef.current
    mountFn?.(instanceId, true)
    return () => {
      onMountRef.current?.(instanceId, false)
      onReadyRef.current?.(null)
    }
  }, [instanceId])

  const editor = useEditor({
    extensions: SPIKE_EXTENSIONS,
    content: doc as JSONContent,
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    autofocus: 'end',
    editorProps: {
      transformPasted: (slice) => sanitizePastedSlice(slice),
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onExitEditRef.current()
          return true
        }
        // Stop single-letter tool shortcuts, Space pan, Backspace/Delete element deletion, and brackets
        // from bubbling out to React Flow or the canvas window listener while typing/editing.
        if (
          event.key === ' ' ||
          event.key === 'Backspace' ||
          event.key === 'Delete' ||
          event.key === '[' ||
          event.key === ']' ||
          ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') ||
          (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1)
        ) {
          event.stopPropagation()
        }
        return false
      },
    },
    onCreate: ({ editor: ed }) => {
      baselineJsonRef.current = JSON.stringify(ed.getJSON())
    },
    onUpdate: ({ editor: ed }) => {
      const next = ed.getJSON() as TipTapDoc
      const hasNetChange = JSON.stringify(next) !== baselineJsonRef.current
      onDocChangeRef.current(next, hasNetChange)
    },
  })

  useEffect(() => {
    onReadyRef.current?.(editor)
  }, [editor])

  return (
    <EditorContent
      editor={editor}
      data-testid="active-tiptap-editor"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    />
  )
}

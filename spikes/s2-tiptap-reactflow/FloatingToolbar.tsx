import type { Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  Italic,
  Maximize2,
  Square,
  Underline,
} from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import {
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  isFrameNoneStyle,
  TEXT_COLOR_TOKENS,
  type ResizeMode,
  type TextBoxStyle,
} from './rich-text-config'

export interface FloatingToolbarProps {
  editor: Editor
  position: { left: number; top: number }
  toolbarRef?: React.RefObject<HTMLDivElement | null>
  nodeStyle: TextBoxStyle
  resizeMode: ResizeMode
  textScale: number
  onToggleFrame: () => void
  onToggleResizeMode: () => void
}

/**
 * Screen-fixed floating formatting toolbar rendered OUTSIDE the React Flow viewport transform
 * so its size, readability, and hit targets stay constant across all canvas zoom levels.
 * Uses `onMouseDown={(e) => e.preventDefault()}` on every control so clicking buttons or
 * opening font/size pickers keeps ProseMirror focus and text selection completely intact.
 */
export function FloatingToolbar({
  editor,
  position,
  toolbarRef,
  nodeStyle,
  resizeMode,
  textScale,
  onToggleFrame,
  onToggleResizeMode,
}: FloatingToolbarProps) {
  return (
    <div
      ref={toolbarRef}
      data-testid="floating-toolbar"
      data-editor-toolbar="true"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        left: 0,
        top: 0,
        transform: `translate3d(${Math.round(position.left)}px, ${Math.round(position.top)}px, 0)`,
      }}
      className="nodrag nowheel nopan absolute z-30 flex w-max items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs whitespace-nowrap shadow-lg"
    >
      <FloatingToolbarBody
        editor={editor}
        nodeStyle={nodeStyle}
        resizeMode={resizeMode}
        textScale={textScale}
        onToggleFrame={onToggleFrame}
        onToggleResizeMode={onToggleResizeMode}
      />
    </div>
  )
}

const FloatingToolbarBody = memo(function FloatingToolbarBody({
  editor,
  nodeStyle,
  resizeMode,
  textScale,
  onToggleFrame,
  onToggleResizeMode,
}: Omit<FloatingToolbarProps, 'position' | 'toolbarRef'>) {
  const [openMenu, setOpenMenu] = useState<'size' | 'font' | null>(null)
  const [, setTransactionTick] = useState(0)

  useEffect(() => {
    const bump = () => setTransactionTick((n) => n + 1)
    editor.on('transaction', bump)
    editor.on('selectionUpdate', bump)
    return () => {
      editor.off('transaction', bump)
      editor.off('selectionUpdate', bump)
    }
  }, [editor])

  const currentAttrs = editor.getAttributes('textStyle')
  const currentFontSize =
    typeof currentAttrs['fontSize'] === 'string' && currentAttrs['fontSize'].length > 0
      ? currentAttrs['fontSize']
      : '16px'
  const baseFontNumeric = Number.parseFloat(currentFontSize) || 16
  const effectiveFontPx = Math.round(baseFontNumeric * textScale)
  const currentFontFamily =
    typeof currentAttrs['fontFamily'] === 'string' && currentAttrs['fontFamily'].length > 0
      ? currentAttrs['fontFamily']
      : FONT_FAMILY_OPTIONS[0].value
  const currentFontLabel =
    FONT_FAMILY_OPTIONS.find((f) => f.value === currentFontFamily)?.label ?? 'Inter'
  const currentColor = typeof currentAttrs['color'] === 'string' ? currentAttrs['color'] : null
  const isBold = editor.isActive('bold')
  const isItalic = editor.isActive('italic')
  const isUnderline = editor.isActive('underline')
  const isHighlight = editor.isActive('highlight')
  const isFrameBoxOn = !isFrameNoneStyle(nodeStyle)

  const keepFocus = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <button
        type="button"
        data-testid="toolbar-bold"
        aria-label="Bold"
        aria-pressed={isBold}
        onMouseDown={keepFocus}
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
          isBold ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'
        }`}
      >
        <Bold className="size-3.5" />
      </button>

      <button
        type="button"
        data-testid="toolbar-italic"
        aria-label="Italic"
        aria-pressed={isItalic}
        onMouseDown={keepFocus}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
          isItalic ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'
        }`}
      >
        <Italic className="size-3.5" />
      </button>

      <button
        type="button"
        data-testid="toolbar-underline"
        aria-label="Underline"
        aria-pressed={isUnderline}
        onMouseDown={keepFocus}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
          isUnderline ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'
        }`}
      >
        <Underline className="size-3.5" />
      </button>

      <button
        type="button"
        data-testid="toolbar-highlight"
        aria-label="Highlight"
        aria-pressed={isHighlight}
        onMouseDown={keepFocus}
        onClick={() => editor.chain().focus().toggleHighlight({ color: 'warning' }).run()}
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
          isHighlight ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'
        }`}
      >
        <Highlighter className="size-3.5" />
      </button>

      <span className="mx-0.5 h-4 w-px bg-border" />

      {/* TextAlign (left / center / right; justify sengaja tidak tersedia) */}
      {(
        [
          { id: 'left', icon: AlignLeft, label: 'Align left' },
          { id: 'center', icon: AlignCenter, label: 'Align center' },
          { id: 'right', icon: AlignRight, label: 'Align right' },
        ] as const
      ).map((item) => {
        const Icon = item.icon
        const active = editor.isActive({ textAlign: item.id })
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`toolbar-align-${item.id}`}
            aria-label={item.label}
            aria-pressed={active}
            onMouseDown={keepFocus}
            onClick={() => editor.chain().focus().setTextAlign(item.id).run()}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'
            }`}
          >
            <Icon className="size-3.5" />
          </button>
        )
      })}

      <span className="mx-0.5 h-4 w-px bg-border" />

      {/* Semantic theme color swatches */}
      <div className="flex items-center gap-1" role="group" aria-label="Text color tokens">
        {TEXT_COLOR_TOKENS.map((swatch) => {
          const active = currentColor === swatch.token
          return (
            <button
              key={swatch.label}
              type="button"
              data-testid={`toolbar-color-${swatch.token ?? 'auto'}`}
              title={swatch.label}
              aria-label={`Color ${swatch.label}`}
              aria-pressed={active}
              onMouseDown={keepFocus}
              onClick={() => {
                if (swatch.token === null) {
                  editor.chain().focus().unsetColor().run()
                } else {
                  editor.chain().focus().setColor(swatch.token).run()
                }
              }}
              className={`h-4 w-4 rounded-full border transition-transform ${
                active ? 'scale-110 border-foreground ring-1 ring-ring' : 'border-border'
              }`}
              style={{
                backgroundColor: swatch.cssVar ?? 'var(--fg)',
              }}
            />
          )
        })}
      </div>

      <span className="mx-0.5 h-4 w-px bg-border" />

      {/* Font Size Dropdown (preserves ProseMirror selection) */}
      <div className="relative">
        <button
          type="button"
          data-testid="toolbar-size-trigger"
          aria-expanded={openMenu === 'size'}
          onMouseDown={keepFocus}
          onClick={() => setOpenMenu((prev) => (prev === 'size' ? null : 'size'))}
          className="h-7 rounded border border-border bg-secondary px-2 font-mono text-[11px] font-medium text-foreground hover:bg-secondary/80"
        >
          {currentFontSize}
          {textScale !== 1 ? (
            <span data-testid="toolbar-size-effective" className="ml-1 text-muted-foreground">
              (→{effectiveFontPx}px)
            </span>
          ) : null}
        </button>
        {openMenu === 'size' ? (
          <div
            data-testid="toolbar-size-menu"
            className="absolute top-[calc(100%+4px)] left-0 z-40 flex flex-col rounded-md border border-border bg-card p-1 shadow-md"
          >
            {FONT_SIZE_OPTIONS.map((sz) => (
              <button
                key={sz}
                type="button"
                data-testid={`toolbar-size-${sz}`}
                onMouseDown={keepFocus}
                onClick={() => {
                  editor.chain().focus().setFontSize(sz).run()
                  setOpenMenu(null)
                }}
                className={`rounded px-2.5 py-1 text-left font-mono text-[11px] ${
                  currentFontSize === sz
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-secondary'
                }`}
              >
                {sz}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Font Family Dropdown (preserves ProseMirror selection) */}
      <div className="relative">
        <button
          type="button"
          data-testid="toolbar-font-trigger"
          aria-expanded={openMenu === 'font'}
          onMouseDown={keepFocus}
          onClick={() => setOpenMenu((prev) => (prev === 'font' ? null : 'font'))}
          className="h-7 rounded border border-border bg-secondary px-2 text-[11px] font-medium text-foreground hover:bg-secondary/80 whitespace-nowrap"
        >
          {currentFontLabel}
        </button>
        {openMenu === 'font' ? (
          <div
            data-testid="toolbar-font-menu"
            className="absolute top-[calc(100%+4px)] right-0 z-40 flex min-w-[140px] flex-col rounded-md border border-border bg-card p-1 shadow-md"
          >
            {FONT_FAMILY_OPTIONS.map((font) => (
              <button
                key={font.label}
                type="button"
                data-testid={`toolbar-font-${font.label.toLowerCase().replace(/\s+/g, '-')}`}
                onMouseDown={keepFocus}
                onClick={() => {
                  editor.chain().focus().setFontFamily(font.value).run()
                  setOpenMenu(null)
                }}
                style={{ fontFamily: font.value }}
                className={`rounded px-2.5 py-1 text-left text-xs ${
                  currentFontFamily === font.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-secondary'
                }`}
              >
                {font.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <span className="mx-0.5 h-4 w-px bg-border" />

      {/* Toggle "kotak di belakang teks" (mengatur style.bg & style.border sekaligus ke null / "none") */}
      <button
        type="button"
        data-testid="toolbar-frame-toggle"
        title="Kotak di belakang teks"
        aria-label="Kotak di belakang teks"
        aria-pressed={isFrameBoxOn}
        onMouseDown={keepFocus}
        onClick={onToggleFrame}
        className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
          isFrameBoxOn
            ? 'bg-secondary text-foreground hover:bg-secondary/80'
            : 'border border-dashed border-border text-muted-foreground hover:text-foreground'
        }`}
      >
        <Square className="size-3" />
        <span>{isFrameBoxOn ? 'Box' : 'None'}</span>
      </button>

      {/* Toggle mode resize per node (Reflow vs Scale) */}
      <button
        type="button"
        data-testid="toolbar-resize-mode"
        title="Mode resize (Reflow vs Scale)"
        aria-label="Mode resize"
        aria-pressed={resizeMode === 'scale'}
        onMouseDown={keepFocus}
        onClick={onToggleResizeMode}
        className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
          resizeMode === 'scale'
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-foreground hover:bg-secondary/80'
        }`}
      >
        <Maximize2 className="size-3" />
        <span>{resizeMode === 'scale' ? `Scale ×${Number(textScale.toFixed(2))}` : 'Reflow'}</span>
      </button>
    </>
  )
})

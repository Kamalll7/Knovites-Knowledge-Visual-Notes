import type { Editor } from '@tiptap/react'
import { type Node, type NodeProps, type ResizeParamsWithDirection } from '@xyflow/react'
import { GripHorizontal } from 'lucide-react'
import { memo, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TipTapDoc } from '@/domain/schema'
import { ActiveTipTapEditor } from './ActiveTipTapEditor'
import { ResizeHandles } from './ResizeHandles'
import {
  computeNextTextScale,
  extractDocTitle,
  INITIAL_LOD_ZOOM_STATE,
  isDocEffectivelyEmpty,
  isFrameNoneStyle,
  LodZoomContext,
  RESIZE_POLICIES,
  type LodZoomState,
  type ResizeMode,
  type TextBoxStyle,
} from './rich-text-config'
import { StaticTextContent } from './StaticTextContent'

export interface TextBoxNodeData extends Record<string, unknown> {
  doc: TipTapDoc
  width: number
  maxHeight?: number
  style: TextBoxStyle
  resizeMode: ResizeMode
  textScale: number
  isEditing: boolean
  renderInViewportPortal?: boolean
  onEnterEdit: (id: string) => void
  onExitEdit: () => void
  onDocChange: (id: string, doc: TipTapDoc, hasNetChange: boolean) => void
  onResizeStart?: (id: string) => void
  onResizeGeometry?: (
    id: string,
    patch: { width?: number; textScale?: number; x?: number; y?: number },
  ) => void
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

function resolveBgCss(bg: string | null | undefined): string {
  if (bg === 'none') return 'transparent'
  return bg ?? 'var(--card)'
}

function resolveBorderCss(border: string | null | undefined): string {
  if (border === 'none') return 'transparent'
  return border ?? 'var(--border)'
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
    style,
    resizeMode,
    textScale,
    isEditing,
    onEnterEdit,
    onExitEdit,
    onDocChange,
    onResizeStart,
    onResizeGeometry,
    onResizeEnd,
    onEditorReady,
    onEditorMountChange,
  } = data

  const frameNone = isFrameNoneStyle(style)
  const isEmpty = useMemo(() => isDocEffectivelyEmpty(doc), [doc])
  const effectiveScale = textScale > 0 ? textScale : 1
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [unscaledHeight, setUnscaledHeight] = useState<number>(88)

  useLayoutEffect(() => {
    if (effectiveScale === 1 && resizeMode !== 'scale') return
    const el = cardRef.current
    if (!el) return
    const measure = () => {
      const h = el.offsetHeight
      if (h > 0) setUnscaledHeight(h)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [doc, width, isEditing, maxHeight, style.bg, style.border, effectiveScale, resizeMode])

  const handleWheelCapture = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    const targetEl = event.target instanceof HTMLElement ? event.target : null
    const preEl = targetEl?.closest('pre')
    const hasHorizontalPreScroll =
      preEl instanceof HTMLElement && preEl.scrollWidth > preEl.clientWidth + 1
    // Isolasi wheel vertikal saat card meluap ATAU wheel horizontal saat blok kode meluap
    if (
      maxHeight !== undefined ||
      el.scrollHeight > el.clientHeight + 1 ||
      (hasHorizontalPreScroll && (Math.abs(event.deltaX) > 0 || event.shiftKey || isEditing))
    ) {
      event.stopPropagation()
    }
  }

  const handleResize = (_event: unknown, params: ResizeParamsWithDirection) => {
    const policy = RESIZE_POLICIES.text
    if (resizeMode === 'scale') {
      const nextScale = computeNextTextScale(params.width, width, policy)
      onResizeGeometry?.(id, {
        textScale: nextScale,
        x: params.x,
        y: params.y,
      })
    } else {
      const clampedW = Math.round(Math.max(policy.minW, Math.min(policy.maxW, params.width)))
      onResizeGeometry?.(id, {
        width: clampedW,
        x: params.x,
      })
    }
  }

  const visualWidth = Math.round(width * effectiveScale)
  const visualHeight =
    effectiveScale !== 1 && unscaledHeight > 0
      ? Math.round(unscaledHeight * effectiveScale)
      : undefined

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
        style={{ width: `${visualWidth}px` }}
      >
        <div
          data-testid={`lod-placeholder-${id}`}
          data-frame-mode={frameNone ? 'none' : 'card'}
          className="rounded-xl border p-3.5"
          style={{
            backgroundColor: resolveBgCss(style.bg),
            borderColor: resolveBorderCss(style.border),
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

  const policy = RESIZE_POLICIES.text
  const scaledMinW = Math.round(width * (policy.minScale ?? 0.5))
  const scaledMaxW = Math.round(width * (policy.maxScale ?? 3.0))

  return (
    <div
      data-testid={inPortal ? `portal-text-box-${id}` : `text-box-${id}`}
      data-editing={isEditing ? 'true' : 'false'}
      data-editor-root={isEditing ? 'true' : undefined}
      data-lod="false"
      data-resize-mode={resizeMode}
      data-text-scale={effectiveScale}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (!isEditing) {
          onEnterEdit(id)
        }
      }}
      className="group relative"
      style={{
        width: `${visualWidth}px`,
        ...(visualHeight !== undefined ? { height: `${visualHeight}px` } : {}),
      }}
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
        <ResizeHandles
          nodeId={id}
          visible={true}
          policy={policy}
          keepAspectRatio={resizeMode === 'scale'}
          minWidth={resizeMode === 'scale' ? scaledMinW : policy.minW}
          maxWidth={resizeMode === 'scale' ? scaledMaxW : policy.maxW}
          reflowOnlyWidth={resizeMode === 'reflow'}
          onResizeStart={() => onResizeStart?.(id)}
          onResize={handleResize}
          onResizeEnd={() => onResizeEnd?.(id)}
        />
      ) : null}

      {/* Card surface: transform: scale(textScale) non-destruktif tanpa mengubah fontSize dokumen */}
      <div
        style={{
          width: `${width}px`,
          ...(effectiveScale !== 1
            ? {
                transform: `scale(${effectiveScale})`,
                transformOrigin: 'top left',
              }
            : {}),
        }}
      >
        <div
          ref={cardRef}
          data-testid={`card-surface-${id}`}
          data-frame-mode={frameNone ? 'none' : 'card'}
          data-empty={isEmpty ? 'true' : 'false'}
          onWheelCapture={handleWheelCapture}
          className={`knovites-card-surface rounded-xl border p-3.5 ${
            frameNone ? '' : 'shadow-sm'
          } ${maxHeight !== undefined ? 'overflow-y-auto' : ''} ${
            isEditing ? 'nodrag nowheel nopan cursor-text select-text' : 'select-none'
          }`}
          style={{
            backgroundColor: resolveBgCss(style.bg),
            borderColor: resolveBorderCss(style.border),
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
                onExitEdit={() => onExitEdit()}
                onEditorReady={(ed) => onEditorReady?.(id, ed)}
                onEditorMountChange={onEditorMountChange}
              />
            ) : isEmpty ? (
              <p className="knovites-empty-placeholder" data-testid={`empty-placeholder-${id}`}>
                Empty note…
              </p>
            ) : (
              <StaticTextContent doc={doc} />
            )}
          </div>
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
  const phCardRef = useRef<HTMLDivElement | null>(null)
  const [phUnscaledHeight, setPhUnscaledHeight] = useState<number>(88)
  const effectiveScale = data.textScale > 0 ? data.textScale : 1

  useLayoutEffect(() => {
    const el = phCardRef.current
    if (!el) return
    const measure = () => {
      const h = el.offsetHeight
      if (h > 0) setPhUnscaledHeight(h)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [data.doc, data.width, data.maxHeight, data.renderInViewportPortal, effectiveScale])

  // Saat editor aktif di-host di ViewportPortal, slot node React Flow tetap memegang gagang drag +
  // 8 handle resize dan placeholder tak tampak seluas kotak ter-skala agar XYDrag/XYResizer selaras.
  if (data.isEditing && data.renderInViewportPortal) {
    const policy = RESIZE_POLICIES.text
    const visualWidth = Math.round(data.width * effectiveScale)
    const visualHeight =
      effectiveScale !== 1 && phUnscaledHeight > 0
        ? Math.round(phUnscaledHeight * effectiveScale)
        : undefined
    const scaledMinW = Math.round(data.width * (policy.minScale ?? 0.5))
    const scaledMaxW = Math.round(data.width * (policy.maxScale ?? 3.0))

    const handlePortalResize = (_event: unknown, params: ResizeParamsWithDirection) => {
      if (data.resizeMode === 'scale') {
        const nextScale = computeNextTextScale(params.width, data.width, policy)
        data.onResizeGeometry?.(id, {
          textScale: nextScale,
          x: params.x,
          y: params.y,
        })
      } else {
        const clampedW = Math.round(Math.max(policy.minW, Math.min(policy.maxW, params.width)))
        data.onResizeGeometry?.(id, {
          width: clampedW,
          x: params.x,
        })
      }
    }

    return (
      <div
        className="relative"
        style={{
          width: `${visualWidth}px`,
          ...(visualHeight !== undefined ? { height: `${visualHeight}px` } : {}),
        }}
      >
        <div
          data-testid={`drag-handle-${id}`}
          aria-label={`Drag handle for ${id}`}
          style={{ pointerEvents: 'all' }}
          className="knovites-drag-handle absolute -top-5 left-2 right-2 z-20 flex h-4 cursor-grab items-center justify-center rounded-t-md border border-b-0 border-border bg-secondary/95 text-muted-foreground opacity-100 active:cursor-grabbing"
        >
          <GripHorizontal className="size-3.5" />
        </div>
        <ResizeHandles
          nodeId={id}
          visible={true}
          policy={policy}
          keepAspectRatio={data.resizeMode === 'scale'}
          minWidth={data.resizeMode === 'scale' ? scaledMinW : policy.minW}
          maxWidth={data.resizeMode === 'scale' ? scaledMaxW : policy.maxW}
          reflowOnlyWidth={data.resizeMode === 'reflow'}
          onResizeStart={() => data.onResizeStart?.(id)}
          onResize={handlePortalResize}
          onResizeEnd={() => data.onResizeEnd?.(id)}
        />
        <div
          data-testid={`text-box-${id}`}
          data-editing="true"
          data-portal-placeholder="true"
          data-lod="false"
          data-resize-mode={data.resizeMode}
          data-text-scale={effectiveScale}
          aria-hidden="true"
          className="pointer-events-none invisible"
          style={{
            width: `${visualWidth}px`,
            ...(visualHeight !== undefined ? { height: `${visualHeight}px` } : {}),
          }}
        >
          <div
            style={{
              width: `${data.width}px`,
              ...(effectiveScale !== 1
                ? { transform: `scale(${effectiveScale})`, transformOrigin: 'top left' }
                : {}),
            }}
          >
            <div
              ref={phCardRef}
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
      </div>
    )
  }

  return <TextBoxSurface id={id} data={data} selected={selected} lodState={lodState} />
})

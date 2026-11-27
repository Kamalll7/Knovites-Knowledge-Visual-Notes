import type { NodeProps } from '@xyflow/react'
import { Image as ImageIcon } from 'lucide-react'
import { memo, useMemo } from 'react'
import type { CanvasImageElement, CanvasTextElement } from '@/domain/schema'
import {
  isTipTapDocEmpty,
  type CanvasImageFlowNode,
  type CanvasTextFlowNode,
} from '@/features/canvas/canvas-model'
import {
  isFrameNoneStyle,
  resolveCanvasCardBgCss,
  resolveCanvasCardBorderCss,
} from '@/features/canvas/canvas-tokens'
import { StaticTextContent } from '@/features/canvas/StaticTextContent'
import { en } from '@/i18n/en'

export interface CanvasTextSurfaceProps {
  readonly elementId: string
  readonly element: CanvasTextElement
}

export function CanvasTextSurface({ elementId, element }: CanvasTextSurfaceProps) {
  const frameNone = isFrameNoneStyle(element.style)
  const isEmpty = useMemo(() => isTipTapDocEmpty(element.content), [element.content])
  const scale = element.textScale !== undefined && element.textScale > 0 ? element.textScale : 1
  const visualWidth = Math.round(element.w * scale)

  const handleWheelCapture = (event: React.WheelEvent<HTMLDivElement>) => {
    const targetEl = event.target instanceof HTMLElement ? event.target : null
    const preEl = targetEl?.closest('pre')
    if (
      preEl instanceof HTMLElement &&
      preEl.scrollWidth > preEl.clientWidth + 1 &&
      (Math.abs(event.deltaX) > 0 || event.shiftKey)
    ) {
      event.stopPropagation()
    }
  }

  return (
    <div
      data-testid={`canvas-text-node-${elementId}`}
      data-element-type="text"
      data-text-scale={scale}
      className="relative"
      style={{ width: `${visualWidth}px` }}
    >
      <div
        style={{
          width: `${element.w}px`,
          ...(scale !== 1
            ? {
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }
            : {}),
        }}
      >
        <div
          data-testid={`canvas-card-surface-${elementId}`}
          data-frame-mode={frameNone ? 'none' : 'card'}
          data-bg-token={element.style.bg}
          data-border-token={element.style.border}
          data-empty={isEmpty ? 'true' : 'false'}
          onWheelCapture={handleWheelCapture}
          className={`knovites-canvas-card rounded-xl border p-3.5 ${frameNone ? '' : 'shadow-sm'}`}
          style={{
            backgroundColor: resolveCanvasCardBgCss(element.style.bg),
            borderColor: resolveCanvasCardBorderCss(element.style.border),
          }}
        >
          <div className="knovites-canvas-richtext">
            {isEmpty ? (
              <p className="italic text-muted-foreground opacity-70">
                {en.canvas.emptyNotePlaceholder}
              </p>
            ) : (
              <StaticTextContent doc={element.content} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const CanvasTextNode = memo(function CanvasTextNode({
  data,
}: NodeProps<CanvasTextFlowNode>) {
  return <CanvasTextSurface elementId={data.elementId} element={data.element} />
})

export interface CanvasImageSurfaceProps {
  readonly elementId: string
  readonly element: CanvasImageElement
}

export function CanvasImageSurface({ elementId, element }: CanvasImageSurfaceProps) {
  const filename = element.asset.split('/').pop() ?? element.asset

  return (
    <div
      data-testid={`canvas-image-node-${elementId}`}
      data-element-type="image"
      className="flex h-full w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/85 p-4 text-center shadow-sm"
      style={{ width: `${element.w}px`, height: `${element.h}px` }}
    >
      <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="mt-2 max-w-full truncate text-xs font-medium text-foreground">
        {element.alt || en.canvas.imagePlaceholderTitle}
      </p>
      <p className="mt-0.5 max-w-full truncate font-mono text-[11px] text-muted-foreground">
        {filename} · {element.nw} × {element.nh}
      </p>
    </div>
  )
}

export const CanvasImageNode = memo(function CanvasImageNode({
  data,
}: NodeProps<CanvasImageFlowNode>) {
  return <CanvasImageSurface elementId={data.elementId} element={data.element} />
})

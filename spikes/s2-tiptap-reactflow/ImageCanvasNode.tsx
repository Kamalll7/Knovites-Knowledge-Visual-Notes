import {
  type Node,
  type NodeProps,
  type ResizeParamsWithDirection,
  useKeyPress,
} from '@xyflow/react'
import { GripHorizontal } from 'lucide-react'
import { memo, useContext } from 'react'
import { ResizeHandles } from './ResizeHandles'
import { LodZoomContext, RESIZE_POLICIES } from './rich-text-config'

export interface ImageBoxNodeData extends Record<string, unknown> {
  src: string
  thumbSrc: string
  alt: string
  width: number
  height: number
  keepAspectRatio?: boolean
  onResizeStart?: (id: string) => void
  onResizeImage?: (
    id: string,
    next: { width: number; height: number; x?: number; y?: number },
  ) => void
  onResizeEnd?: (id: string) => void
}

export type ImageBoxNode = Node<ImageBoxNodeData, 'imageBox'>

function SelectedImageResizeHandles({
  id,
  keepAspectRatioOverride,
  onResizeStart,
  onResize,
  onResizeEnd,
}: {
  id: string
  keepAspectRatioOverride?: boolean
  onResizeStart?: (id: string) => void
  onResize: (event: unknown, params: ResizeParamsWithDirection) => void
  onResizeEnd?: (id: string) => void
}) {
  const shiftPressed = useKeyPress('Shift')
  const policy = RESIZE_POLICIES.image
  const aspectLocked = keepAspectRatioOverride ?? !shiftPressed

  return (
    <ResizeHandles
      nodeId={id}
      visible={true}
      policy={policy}
      keepAspectRatio={aspectLocked}
      onResizeStart={() => onResizeStart?.(id)}
      onResize={onResize}
      onResizeEnd={() => onResizeEnd?.(id)}
    />
  )
}

export const ImageCanvasNode = memo(function ImageCanvasNode({
  id,
  data,
  selected,
}: NodeProps<ImageBoxNode>) {
  const {
    src,
    thumbSrc,
    alt,
    width,
    height,
    keepAspectRatio,
    onResizeStart,
    onResizeImage,
    onResizeEnd,
  } = data
  const { isLod } = useContext(LodZoomContext)
  const policy = RESIZE_POLICIES.image

  if (isLod) {
    return (
      <div
        data-testid={`image-box-${id}`}
        data-lod="true"
        className="select-none overflow-hidden rounded-xl border border-border bg-card"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <img
          data-testid={`lod-image-${id}`}
          src={thumbSrc}
          alt={alt}
          width={width}
          height={height}
          draggable={false}
          decoding="sync"
          className="block h-full w-full object-cover"
        />
      </div>
    )
  }

  const handleResize = (_event: unknown, params: ResizeParamsWithDirection) => {
    const nextW = Math.round(Math.max(policy.minW, Math.min(policy.maxW, params.width)))
    const nextH = Math.round(Math.max(policy.minH, Math.min(policy.maxH, params.height)))
    onResizeImage?.(id, {
      width: nextW,
      height: nextH,
      x: params.x,
      y: params.y,
    })
  }

  return (
    <div
      data-testid={`image-box-${id}`}
      data-lod="false"
      data-aspect-locked={(keepAspectRatio ?? policy.keepAspect) ? 'true' : 'false'}
      className="group relative select-none"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      <div
        data-testid={`drag-handle-${id}`}
        aria-label={`Drag handle for ${id}`}
        className={`knovites-drag-handle absolute -top-5 left-2 right-2 flex h-4 cursor-grab items-center justify-center rounded-t-md border border-b-0 border-border bg-secondary/95 text-muted-foreground transition-opacity active:cursor-grabbing ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <GripHorizontal className="size-3.5" />
      </div>

      {selected ? (
        <SelectedImageResizeHandles
          id={id}
          keepAspectRatioOverride={keepAspectRatio}
          onResizeStart={onResizeStart}
          onResize={handleResize}
          onResizeEnd={onResizeEnd}
        />
      ) : null}

      <div
        data-testid={`image-card-${id}`}
        className="h-full w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        style={{
          boxShadow: selected ? '0 0 0 1.5px var(--accent)' : undefined,
        }}
      >
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          draggable={false}
          decoding="async"
          className="block h-full w-full object-fill"
        />
      </div>
    </div>
  )
})

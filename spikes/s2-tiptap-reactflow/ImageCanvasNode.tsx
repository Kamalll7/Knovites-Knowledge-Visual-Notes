import { type Node, type NodeProps } from '@xyflow/react'
import { GripHorizontal } from 'lucide-react'
import { memo, useContext } from 'react'
import { LodZoomContext } from './rich-text-config'

export interface ImageBoxNodeData extends Record<string, unknown> {
  src: string
  thumbSrc: string
  alt: string
  width: number
  height: number
}

export type ImageBoxNode = Node<ImageBoxNodeData, 'imageBox'>

export const ImageCanvasNode = memo(function ImageCanvasNode({
  id,
  data,
  selected,
}: NodeProps<ImageBoxNode>) {
  const { src, thumbSrc, alt, width, height } = data
  const { isLod } = useContext(LodZoomContext)

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

  return (
    <div
      data-testid={`image-box-${id}`}
      data-lod="false"
      className="group relative select-none"
      style={{ width: `${width}px` }}
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

      <div
        className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
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
          className="block w-full object-cover"
          style={{ height: `${height}px` }}
        />
      </div>
    </div>
  )
})

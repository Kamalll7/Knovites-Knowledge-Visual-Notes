import {
  NodeResizeControl,
  ResizeControlVariant,
  type ResizeDragEvent,
  type ResizeParamsWithDirection,
} from '@xyflow/react'
import { memo } from 'react'
import type { ResizePolicy } from './rich-text-config'

const ALL_POSITIONS = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
] as const

export type HandlePosition = (typeof ALL_POSITIONS)[number]

export interface ResizeHandlesProps {
  nodeId: string
  visible: boolean
  policy: ResizePolicy
  keepAspectRatio: boolean
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  onResizeStart?: (event: ResizeDragEvent, params: ResizeParamsWithDirection) => void
  onResize?: (event: ResizeDragEvent, params: ResizeParamsWithDirection) => void
  onResizeEnd?: (event: ResizeDragEvent, params: ResizeParamsWithDirection) => void
  /** Opsi uji mutasi / khusus: bila true, hanya sisi kiri/kanan + sudut yang memicu lebar. */
  reflowOnlyWidth?: boolean
}

export const ResizeHandles = memo(function ResizeHandles({
  nodeId,
  visible,
  policy,
  keepAspectRatio,
  minWidth,
  maxWidth,
  minHeight,
  maxHeight,
  onResizeStart,
  onResize,
  onResizeEnd,
  reflowOnlyWidth = false,
}: ResizeHandlesProps) {
  if (!visible) return null

  const effectiveMinW = minWidth ?? policy.minW
  const effectiveMaxW = maxWidth ?? policy.maxW
  const effectiveMinH = minHeight ?? policy.minH
  const effectiveMaxH = maxHeight ?? policy.maxH

  return (
    <>
      {ALL_POSITIONS.map((pos) => {
        const isSide = pos === 'top' || pos === 'bottom' || pos === 'left' || pos === 'right'
        const isHorizontalSide = pos === 'left' || pos === 'right'
        const isVerticalSide = pos === 'top' || pos === 'bottom'

        // Dalam mode reflow teks, tinggi mengikuti konten otomatis; handle horizontal + sudut ubah lebar
        const resizeDirection =
          reflowOnlyWidth && (isHorizontalSide || !isVerticalSide) ? 'horizontal' : undefined

        return (
          <NodeResizeControl
            key={pos}
            nodeId={nodeId}
            position={pos}
            variant={ResizeControlVariant.Handle}
            resizeDirection={resizeDirection}
            minWidth={effectiveMinW}
            maxWidth={effectiveMaxW}
            minHeight={effectiveMinH}
            maxHeight={effectiveMaxH}
            keepAspectRatio={keepAspectRatio}
            shouldResize={reflowOnlyWidth && isVerticalSide ? () => false : undefined}
            onResizeStart={(ev, params) => onResizeStart?.(ev, params as ResizeParamsWithDirection)}
            onResize={(ev, params) => onResize?.(ev, params as ResizeParamsWithDirection)}
            onResizeEnd={(ev, params) => onResizeEnd?.(ev, params as ResizeParamsWithDirection)}
            // Penahan event eksplisit agar drag/wheel di handle tidak bocor ke pan/zoom kanvas
            className={`knovites-resize-handle nodrag nopan nowheel ${isSide ? 'knovites-resize-side' : ''}`}
            style={{ pointerEvents: 'all' }}
          >
            <span
              data-testid={`resize-handle-${nodeId}-${pos}`}
              aria-label={`Resize ${pos} for ${nodeId}`}
              onWheelCapture={(event) => event.stopPropagation()}
              className="nopan nowheel block h-full w-full"
            />
          </NodeResizeControl>
        )
      })}
    </>
  )
})

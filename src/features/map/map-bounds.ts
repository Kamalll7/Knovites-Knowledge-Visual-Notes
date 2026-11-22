import type { MapLayoutResult } from '@/domain/layout'

/** Default world-space padding around fitted map bounding box (px). */
export const MAP_FIT_PADDING_PX = 48

/** Default top world-space reservation when HUD controls overlay the viewport (px). */
export const MAP_HUD_TOP_RESERVE_PX = 76

export interface MapBoundingBox {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly width: number
  readonly height: number
}

/** Computes axis-aligned outer bounds of all rendered nodes and external labels. */
export function computeMapBoundingBox(layout: MapLayoutResult): MapBoundingBox {
  if (layout.orderedIds.length === 0) {
    return { minX: -200, minY: -150, maxX: 200, maxY: 150, width: 400, height: 300 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of layout.orderedIds) {
    const n = layout.nodes[id]
    if (!n) continue
    minX = Math.min(minX, n.x - n.width / 2, n.labelBox ? n.labelBox.x : Infinity)
    maxX = Math.max(
      maxX,
      n.x + n.width / 2,
      n.labelBox ? n.labelBox.x + n.labelBox.width : -Infinity,
    )
    minY = Math.min(minY, n.y - n.height / 2, n.labelBox ? n.labelBox.y : Infinity)
    maxY = Math.max(
      maxY,
      n.y + n.height / 2,
      n.labelBox ? n.labelBox.y + n.labelBox.height : -Infinity,
    )
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

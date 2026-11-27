import type { MapBoundingBox } from '@/features/map/map-bounds'
import {
  MAP_ZOOM_MIN,
  ZERO_HUD_INSETS,
  centerCameraOnWorldPoint,
  type CameraHudInsets,
  type CameraTransform,
} from '@/features/map/map-camera'

/** Default SVG width of the bottom-right minimap canvas (`FR-MAP-13`). */
export const MINIMAP_WIDTH_PX = 188

/** Default SVG height of the bottom-right minimap canvas (`FR-MAP-13`). */
export const MINIMAP_HEIGHT_PX = 124

/** Default inner padding inside the minimap SVG canvas (px). */
export const MINIMAP_PADDING_PX = 10

const MIN_VIEWPORT_RECT_PX = 8
const VIEWPORT_RECT_EDGE_INSET_PX = 1

export interface MinimapProjection {
  readonly bbox: MapBoundingBox
  readonly width: number
  readonly height: number
  readonly padding: number
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

export interface MinimapPoint {
  readonly x: number
  readonly y: number
}

export interface MinimapViewportRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rawX: number
  readonly rawY: number
  readonly rawWidth: number
  readonly rawHeight: number
}

/**
 * Computes an aspect-preserving affine projection from world bounding box to minimap pixels.
 */
export function computeMinimapProjection(
  bbox: MapBoundingBox,
  width = MINIMAP_WIDTH_PX,
  height = MINIMAP_HEIGHT_PX,
  padding = MINIMAP_PADDING_PX,
): MinimapProjection {
  const safeW = Math.max(32, width)
  const safeH = Math.max(32, height)
  const safePad = Math.max(0, Math.min(padding, safeW / 4, safeH / 4))
  const innerW = Math.max(1, safeW - safePad * 2)
  const innerH = Math.max(1, safeH - safePad * 2)
  const boxW = Math.max(1, bbox.width)
  const boxH = Math.max(1, bbox.height)
  const scale = Math.min(innerW / boxW, innerH / boxH)
  const centerWorldX = (bbox.minX + bbox.maxX) / 2
  const centerWorldY = (bbox.minY + bbox.maxY) / 2

  return {
    bbox,
    width: safeW,
    height: safeH,
    padding: safePad,
    scale,
    offsetX: safeW / 2 - centerWorldX * scale,
    offsetY: safeH / 2 - centerWorldY * scale,
  }
}

/** Projects a world coordinate `(worldX, worldY)` into minimap SVG coordinates. */
export function worldToMinimapPoint(
  worldX: number,
  worldY: number,
  projection: MinimapProjection,
): MinimapPoint {
  return {
    x: worldX * projection.scale + projection.offsetX,
    y: worldY * projection.scale + projection.offsetY,
  }
}

/** Maps a minimap SVG coordinate `(miniX, miniY)` back to world coordinates. */
export function minimapToWorldPoint(
  miniX: number,
  miniY: number,
  projection: MinimapProjection,
): MinimapPoint {
  const safeScale = projection.scale > 0 ? projection.scale : 1
  return {
    x: (miniX - projection.offsetX) / safeScale,
    y: (miniY - projection.offsetY) / safeScale,
  }
}

/**
 * Projects the active viewport rectangle into minimap coordinates.
 * Returns both exact (`raw*`) geometry and canvas-clamped geometry for crisp SVG display.
 */
export function computeMinimapViewportRect(
  camera: CameraTransform,
  viewportW: number,
  viewportH: number,
  projection: MinimapProjection,
): MinimapViewportRect {
  const safeW = Math.max(1, viewportW)
  const safeH = Math.max(1, viewportH)
  const safeK = Math.max(MAP_ZOOM_MIN, Number.isFinite(camera.k) ? camera.k : 1)

  const worldLeft = (0 - camera.x) / safeK
  const worldTop = (0 - camera.y) / safeK
  const worldRight = (safeW - camera.x) / safeK
  const worldBottom = (safeH - camera.y) / safeK

  const tl = worldToMinimapPoint(worldLeft, worldTop, projection)
  const br = worldToMinimapPoint(worldRight, worldBottom, projection)

  const rawX = tl.x
  const rawY = tl.y
  const rawWidth = Math.max(1, br.x - tl.x)
  const rawHeight = Math.max(1, br.y - tl.y)

  const minBound = VIEWPORT_RECT_EDGE_INSET_PX
  const maxRight = projection.width - VIEWPORT_RECT_EDGE_INSET_PX
  const maxBottom = projection.height - VIEWPORT_RECT_EDGE_INSET_PX

  const clampedLeft = Math.max(minBound, Math.min(maxRight - MIN_VIEWPORT_RECT_PX, rawX))
  const clampedTop = Math.max(minBound, Math.min(maxBottom - MIN_VIEWPORT_RECT_PX, rawY))
  const clampedRight = Math.max(
    clampedLeft + MIN_VIEWPORT_RECT_PX,
    Math.min(maxRight, rawX + rawWidth),
  )
  const clampedBottom = Math.max(
    clampedTop + MIN_VIEWPORT_RECT_PX,
    Math.min(maxBottom, rawY + rawHeight),
  )

  return {
    x: clampedLeft,
    y: clampedTop,
    width: clampedRight - clampedLeft,
    height: clampedBottom - clampedTop,
    rawX,
    rawY,
    rawWidth,
    rawHeight,
  }
}

/**
 * Computes the clamped camera transform centered on the world point corresponding to a
 * click/drag at `(miniX, miniY)` on the minimap, preserving zoom scale `currentK` (`FR-MAP-13`).
 */
export function computeCameraForMinimapPoint(
  miniX: number,
  miniY: number,
  projection: MinimapProjection,
  currentK: number,
  viewportW: number,
  viewportH: number,
  hudInsets: CameraHudInsets = ZERO_HUD_INSETS,
): CameraTransform {
  const world = minimapToWorldPoint(miniX, miniY, projection)
  return centerCameraOnWorldPoint(
    world.x,
    world.y,
    currentK,
    viewportW,
    viewportH,
    projection.bbox,
    hudInsets,
  )
}

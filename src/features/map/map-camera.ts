import { easeCubicOut } from 'd3-ease'
import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  resolveScreenZoomTier,
  type ComputeVisibleResult,
  type MapLayoutResult,
  type ScreenTierResolution,
} from '@/domain/layout'
import {
  MAP_FIT_PADDING_PX,
  computeMapBoundingBox,
  type MapBoundingBox,
} from '@/features/map/map-bounds'

/** Minimum allowed viewport zoom scale (`FR-MAP-06`). */
export const MAP_ZOOM_MIN = 0.2

/** Maximum allowed viewport zoom scale (`FR-MAP-06`). */
export const MAP_ZOOM_MAX = 3

/** Multiplicative zoom step for HUD zoom-in / zoom-out buttons (`FR-MAP-06`). */
export const MAP_ZOOM_STEP_FACTOR = 1.25

/** Focus transition animation duration within the 450–600 ms spec window (`FR-MAP-05`, `T3.6`). */
export const MAP_FOCUS_TRANSITION_MS = 550

/** Minimum pixels of the map bounding box kept reachable inside the viewport during pan. */
export const MAP_PAN_KEEP_IN_VIEW_PX = 96

export interface CameraTransform {
  readonly x: number
  readonly y: number
  readonly k: number
}

export interface CameraHudInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export const ZERO_HUD_INSETS: CameraHudInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
})

export interface NodeTransitionState {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly opacity: number
}

/**
 * Resolves active semantic zoom tier strictly via `@/domain/layout`'s `resolveScreenZoomTier`
 * and `DEFAULT_RADIAL_LAYOUT_CONFIG` (zero duplicated thresholds; enforces `>= 11 px` on-screen font).
 */
export function resolveViewportZoomTier(scale: number): ScreenTierResolution {
  return resolveScreenZoomTier(scale, undefined, DEFAULT_RADIAL_LAYOUT_CONFIG)
}

/**
 * Computes camera `{ x, y, k }` for `fit-all` or pure-center `focus` framing (`FR-MAP-05`,
 * `FR-MAP-06`, owner decision 2026-11-23).
 * - `focus`: places `(focusNode.x, focusNode.y)` strictly at the safe viewport center
 *   `(centerScreenX, centerScreenY)` accounting for `hudInsets` while preserving `currentK`
 *   (zero zoom change).
 * - `fit-all`: frames the full map bounding box inside the HUD-safe viewport area.
 */
export function computeCameraForFocus(
  layout: MapLayoutResult,
  focusId: string,
  viewportW: number,
  viewportH: number,
  mode: 'focus' | 'fit-all',
  hudInsets: CameraHudInsets = ZERO_HUD_INSETS,
  currentK = 1,
): CameraTransform {
  const safeW = Math.max(240, viewportW)
  const safeH = Math.max(180, viewportH)
  const usableW = Math.max(120, safeW - hudInsets.left - hudInsets.right)
  const usableH = Math.max(100, safeH - hudInsets.top - hudInsets.bottom)
  const centerScreenX = hudInsets.left + usableW / 2
  const centerScreenY = hudInsets.top + usableH / 2

  if (mode === 'focus') {
    const focusNode = layout.nodes[focusId] ?? layout.nodes[layout.rootId]
    if (focusNode) {
      const k = Math.max(
        MAP_ZOOM_MIN,
        Math.min(MAP_ZOOM_MAX, Number.isFinite(currentK) ? currentK : 1),
      )
      return {
        x: centerScreenX - focusNode.x * k,
        y: centerScreenY - focusNode.y * k,
        k,
      }
    }
  }

  const availW = Math.max(80, usableW - MAP_FIT_PADDING_PX * 2)
  const availH = Math.max(80, usableH - MAP_FIT_PADDING_PX * 2)
  const targetBox = computeMapBoundingBox(layout)
  const boxW = Math.max(160, targetBox.width)
  const boxH = Math.max(120, targetBox.height)

  const fitK = Math.min(availW / boxW, availH / boxH)
  const k = Math.max(MAP_ZOOM_MIN, Math.min(1.2, fitK))
  const cx = (targetBox.minX + targetBox.maxX) / 2
  const cy = (targetBox.minY + targetBox.maxY) / 2

  return {
    x: centerScreenX - cx * k,
    y: centerScreenY - cy * k,
    k,
  }
}

/** Clamps zoom scale to `[0.2, 3]` and bounds pan so the map stays reachable in viewport (`FR-MAP-06`). */
export function clampCameraTransform(
  transform: CameraTransform,
  bbox: MapBoundingBox,
  viewportW: number,
  viewportH: number,
): CameraTransform {
  const safeW = Math.max(240, viewportW)
  const safeH = Math.max(180, viewportH)
  const k = Math.max(
    MAP_ZOOM_MIN,
    Math.min(MAP_ZOOM_MAX, Number.isFinite(transform.k) ? transform.k : 1),
  )
  const margin = Math.min(MAP_PAN_KEEP_IN_VIEW_PX, safeW * 0.35, safeH * 0.35)

  const minTx = margin - bbox.maxX * k
  const maxTx = safeW - margin - bbox.minX * k
  const minTy = margin - bbox.maxY * k
  const maxTy = safeH - margin - bbox.minY * k

  const x = minTx <= maxTx ? Math.max(minTx, Math.min(maxTx, transform.x)) : (minTx + maxTx) / 2
  const y = minTy <= maxTy ? Math.max(minTy, Math.min(maxTy, transform.y)) : (minTy + maxTy) / 2

  return { x, y, k }
}

/** Zooms in or out around the viewport center by `MAP_ZOOM_STEP_FACTOR`, respecting pan/zoom bounds. */
export function stepZoomCamera(
  current: CameraTransform,
  direction: 'in' | 'out',
  viewportW: number,
  viewportH: number,
  bbox: MapBoundingBox,
): CameraTransform {
  const factor = direction === 'in' ? MAP_ZOOM_STEP_FACTOR : 1 / MAP_ZOOM_STEP_FACTOR
  const nextK = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, current.k * factor))
  const cx = Math.max(240, viewportW) / 2
  const cy = Math.max(180, viewportH) / 2
  const worldX = (cx - current.x) / current.k
  const worldY = (cy - current.y) / current.k
  return clampCameraTransform(
    {
      x: cx - worldX * nextK,
      y: cy - worldY * nextK,
      k: nextK,
    },
    bbox,
    viewportW,
    viewportH,
  )
}

/**
 * Builds per-node start positions for a focus transition (`FR-MAP-05`).
 * Existing nodes start from their current live positions (smooth interruption without jumping);
 * newly entering nodes emerge from their parent's position.
 */
export function buildTransitionStartPositions(
  livePositions: ReadonlyMap<string, NodeTransitionState>,
  nextLayout: MapLayoutResult,
  nextVisible: ComputeVisibleResult,
): Map<string, NodeTransitionState> {
  const start = new Map<string, NodeTransitionState>()
  const rootPos = livePositions.get(nextLayout.rootId) ?? { x: 0, y: 0, scale: 1, opacity: 1 }

  for (const id of nextLayout.orderedIds) {
    const existing = livePositions.get(id)
    if (existing) {
      start.set(id, existing)
      continue
    }
    const vNode = nextVisible.nodes[id]
    const parentId = vNode?.parentId ?? nextLayout.rootId
    const parentLive =
      (parentId ? livePositions.get(parentId) : undefined) ??
      (parentId && nextLayout.nodes[parentId]
        ? {
            x: nextLayout.nodes[parentId]!.x,
            y: nextLayout.nodes[parentId]!.y,
            scale: 1,
            opacity: 1,
          }
        : rootPos)
    start.set(id, {
      x: parentLive.x,
      y: parentLive.y,
      scale: 0.25,
      opacity: 0,
    })
  }
  return start
}

/** Interpolates camera transform with `easeCubicOut` (or instant snap when `reducedMotion`). */
export function interpolateCamera(
  from: CameraTransform,
  to: CameraTransform,
  rawT: number,
  reducedMotion: boolean,
): CameraTransform {
  if (reducedMotion || rawT >= 1) return to
  const t = easeCubicOut(Math.max(0, Math.min(1, rawT)))
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    k: from.k + (to.k - from.k) * t,
  }
}

/** Interpolates all visible node positions with `easeCubicOut` (or instant snap when `reducedMotion`). */
export function interpolateNodePositions(
  startPositions: ReadonlyMap<string, NodeTransitionState>,
  targetLayout: MapLayoutResult,
  rawT: number,
  reducedMotion: boolean,
): Map<string, NodeTransitionState> {
  const out = new Map<string, NodeTransitionState>()
  const t = reducedMotion || rawT >= 1 ? 1 : easeCubicOut(Math.max(0, Math.min(1, rawT)))
  for (const id of targetLayout.orderedIds) {
    const target = targetLayout.nodes[id]
    if (!target) continue
    const from = startPositions.get(id)
    if (!from || t >= 1) {
      out.set(id, { x: target.x, y: target.y, scale: 1, opacity: 1 })
      continue
    }
    out.set(id, {
      x: from.x + (target.x - from.x) * t,
      y: from.y + (target.y - from.y) * t,
      scale: from.scale + (1 - from.scale) * t,
      opacity: from.opacity + (1 - from.opacity) * t,
    })
  }
  return out
}

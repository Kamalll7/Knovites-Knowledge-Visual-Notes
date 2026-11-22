import {
  HORIZONTAL_WIDE_FAN_FADE_THRESHOLD,
  type ComputeVisibleResult,
  type MapLayoutEdge,
  type MapLayoutResult,
} from '@/domain/layout'

export type MapEdgeOrientation = 'radial' | 'horizontal'

/**
 * Shared wide-fan fade threshold (`12` visible sibling edges from one parent),
 * imported directly from `@/domain/layout` (`HORIZONTAL_WIDE_FAN_FADE_THRESHOLD`)
 * so radial and horizontal maps share identical fade behavior without modifying radial output.
 */
export const WIDE_FAN_FADE_THRESHOLD = HORIZONTAL_WIDE_FAN_FADE_THRESHOLD

/** Horizontal cubic Bezier control-point tension (`0.5` matches `d3.linkHorizontal`). */
export const HORIZONTAL_BEZIER_TENSION = 0.5

/** Edge opacity tokens aligned with Spike S3 (`RadialMapSpike.tsx` & `FR-MAP-09`). */
export const EDGE_OPACITY = Object.freeze({
  focus: 0.96,
  normal: 0.34,
  halo: 0.22,
  wideFanBaseStart: 0.08,
} as const)

/** Gradient stop offset where wide-fan base fade reaches full edge opacity (`FR-MAP-09`). */
export const WIDE_FAN_FADE_STOP_OFFSET = 0.28

/** Tapered stroke-width constants aligned with Spike S3 (`radial-layout.ts:420`). */
export const EDGE_STROKE = Object.freeze({
  baseWidthPx: 3.4,
  depthStepPx: 0.45,
  minWidthPx: 1.25,
  focusBoostPx: 1.1,
  haloExtraWidthPx: 7,
} as const)

export interface EdgeControlPoints {
  readonly sx: number
  readonly sy: number
  readonly cx1: number
  readonly cy1: number
  readonly cx2: number
  readonly cy2: number
  readonly tx: number
  readonly ty: number
}

export interface RenderedMapEdge {
  readonly id: string
  readonly sourceId: string
  readonly targetId: string
  readonly d: string
  readonly controlPoints: EdgeControlPoints
  readonly isOnFocusPath: boolean
  readonly strokeWidth: number
  readonly opacity: number
  readonly sourceFanCount: number
  readonly fadeSourceBase: boolean
  readonly gradientId: string | null
}

function hasHorizontalFanMetadata(
  edge: MapLayoutEdge,
): edge is MapLayoutEdge & { readonly sourceFanCount: number; readonly fadeSourceBase: boolean } {
  return (
    'fadeSourceBase' in edge &&
    'sourceFanCount' in edge &&
    typeof (edge as { fadeSourceBase?: unknown }).fadeSourceBase === 'boolean' &&
    typeof (edge as { sourceFanCount?: unknown }).sourceFanCount === 'number'
  )
}

/**
 * Computes cubic Bezier control points strictly anchored at the clipped node-perimeter
 * endpoints `(edge.sourceX, edge.sourceY) -> (edge.targetX, edge.targetY)`.
 */
export function computeEdgeControlPoints(
  edge: MapLayoutEdge,
  orientation: MapEdgeOrientation,
): EdgeControlPoints {
  const sx = edge.sourceX
  const sy = edge.sourceY
  const tx = edge.targetX
  const ty = edge.targetY

  if (orientation === 'horizontal') {
    const midX = sx + (tx - sx) * HORIZONTAL_BEZIER_TENSION
    return { sx, sy, cx1: midX, cy1: sy, cx2: midX, cy2: ty, tx, ty }
  }

  const rSrc = Math.hypot(sx, sy)
  const rDst = Math.hypot(tx, ty)
  const rMid = (rSrc + rDst) * 0.5
  const cx1 = rSrc > 1e-3 ? (sx / rSrc) * rMid : sx + (tx - sx) * 0.5
  const cy1 = rSrc > 1e-3 ? (sy / rSrc) * rMid : sy + (ty - sy) * 0.5
  const cx2 = rDst > 1e-3 ? (tx / rDst) * rMid : sx + (tx - sx) * 0.5
  const cy2 = rDst > 1e-3 ? (ty / rDst) * rMid : sy + (ty - sy) * 0.5
  return { sx, sy, cx1, cy1, cx2, cy2, tx, ty }
}

/** Formats cubic Bezier control points into an SVG `<path d="...">` string. */
export function formatEdgePathD(cp: EdgeControlPoints): string {
  const f = (n: number) => Number(n.toFixed(2))
  return `M ${f(cp.sx)} ${f(cp.sy)} C ${f(cp.cx1)} ${f(cp.cy1)}, ${f(cp.cx2)} ${f(cp.cy2)}, ${f(cp.tx)} ${f(cp.ty)}`
}

/** Samples `steps + 1` points along a cubic Bezier curve for geometric crossing checks. */
export function sampleCubicBezierPoints(
  cp: EdgeControlPoints,
  steps = 12,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const safeSteps = Math.max(2, Math.floor(steps))
  const points: Array<{ readonly x: number; readonly y: number }> = []
  for (let i = 0; i <= safeSteps; i += 1) {
    const t = i / safeSteps
    const mt = 1 - t
    const mt2 = mt * mt
    const t2 = t * t
    const x = mt2 * mt * cp.sx + 3 * mt2 * t * cp.cx1 + 3 * mt * t2 * cp.cx2 + t2 * t * cp.tx
    const y = mt2 * mt * cp.sy + 3 * mt2 * t * cp.cy1 + 3 * mt * t2 * cp.cy2 + t2 * t * cp.ty
    points.push({ x, y })
  }
  return points
}

/**
 * Builds renderable SVG edge descriptors for any `MapLayoutResult` (radial or horizontal).
 * Uses `fadeSourceBase`/`sourceFanCount` directly when provided by horizontal layout, and
 * derives sibling fan counts at the `features/map` layer for radial layout without altering
 * radial domain output.
 */
export function buildRenderedMapEdges(
  layout: MapLayoutResult,
  visible: ComputeVisibleResult,
  orientation: MapEdgeOrientation,
  wideFanThreshold = WIDE_FAN_FADE_THRESHOLD,
): readonly RenderedMapEdge[] {
  const outgoingCountBySource = new Map<string, number>()
  for (const edge of layout.edges) {
    outgoingCountBySource.set(edge.sourceId, (outgoingCountBySource.get(edge.sourceId) ?? 0) + 1)
  }

  return layout.edges.map((edge, idx) => {
    const cp = computeEdgeControlPoints(edge, orientation)
    const srcVisible = visible.nodes[edge.sourceId]
    const dstVisible = visible.nodes[edge.targetId]
    const isOnFocusPath = Boolean(srcVisible?.isOnFocusPath && dstVisible?.isOnFocusPath)
    const dstDepth = layout.nodes[edge.targetId]?.depth ?? dstVisible?.depth ?? 1
    const baseStroke = Math.max(
      EDGE_STROKE.minWidthPx,
      EDGE_STROKE.baseWidthPx - dstDepth * EDGE_STROKE.depthStepPx,
    )
    const strokeWidth = isOnFocusPath ? baseStroke + EDGE_STROKE.focusBoostPx : baseStroke
    const opacity = isOnFocusPath ? EDGE_OPACITY.focus : EDGE_OPACITY.normal

    const sourceFanCount = hasHorizontalFanMetadata(edge)
      ? edge.sourceFanCount
      : (outgoingCountBySource.get(edge.sourceId) ?? 1)
    const fadeSourceBase = hasHorizontalFanMetadata(edge)
      ? edge.fadeSourceBase
      : sourceFanCount >= wideFanThreshold

    return {
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      d: formatEdgePathD(cp),
      controlPoints: cp,
      isOnFocusPath,
      strokeWidth,
      opacity,
      sourceFanCount,
      fadeSourceBase,
      gradientId: fadeSourceBase ? `map-edge-fade-${idx}` : null,
    }
  })
}

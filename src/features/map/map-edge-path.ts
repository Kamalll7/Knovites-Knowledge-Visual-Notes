import {
  HORIZONTAL_WIDE_FAN_FADE_THRESHOLD,
  type ComputeVisibleResult,
  type MapLayoutEdge,
  type MapLayoutNode,
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

/** Edge opacity tokens (`FR-MAP-09`, `T3.5-fix`: normal raised to 0.48 for legibility). */
export const EDGE_OPACITY = Object.freeze({
  focus: 0.96,
  normal: 0.48,
  halo: 0.22,
  wideFanBaseStart: 0.08,
} as const)

/** Breathing clearance (px) kept around root's external labelBox when clipping radial 6-o'clock edges. */
const ROOT_LABEL_CLEARANCE_PX = 4

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

export interface LiveNodeEndpointState {
  readonly x: number
  readonly y: number
  readonly scale: number
}

function clipLiveNodeBoundary(
  pos: LiveNodeEndpointState,
  node: MapLayoutNode,
  dx: number,
  dy: number,
): { readonly x: number; readonly y: number } {
  const len = Math.hypot(dx, dy)
  if (len < 1e-3) return { x: pos.x, y: pos.y }
  if (node.shape === 'circle') {
    const r = (node.radius ?? node.width / 2) * pos.scale
    return { x: pos.x + (dx / len) * r, y: pos.y + (dy / len) * r }
  }
  const halfW = (node.width * pos.scale) / 2
  const halfH = (node.height * pos.scale) / 2
  const t = Math.min(
    dx !== 0 ? halfW / Math.abs(dx) : Infinity,
    dy !== 0 ? halfH / Math.abs(dy) : Infinity,
  )
  return { x: pos.x + dx * t, y: pos.y + dy * t }
}

/**
 * Advances a radial root edge start point past the root's external `labelBox` (expanded by
 * `padPx`) whenever the outgoing ray toward `(tx, ty)` would pierce the root label text
 * (e.g. 6-o'clock focus edge in radial mode, `T3.5-fix`).
 */
export function clipRadialSourcePastLabelBox(
  srcNode: MapLayoutNode | undefined,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  padPx: number = ROOT_LABEL_CLEARANCE_PX,
): { readonly x: number; readonly y: number } {
  if (!srcNode || srcNode.kind !== 'root' || !srcNode.labelBox) {
    return { x: sx, y: sy }
  }
  const lb = srcNode.labelBox
  const minX = lb.x - padPx
  const maxX = lb.x + lb.width + padPx
  const minY = lb.y - padPx
  const maxY = lb.y + lb.height + padPx
  const dx = tx - sx
  const dy = ty - sy

  let tEnter = 0
  let tExit = 1
  for (let axis = 0; axis < 2; axis += 1) {
    const d = axis === 0 ? dx : dy
    const p0 = axis === 0 ? sx : sy
    const lo = axis === 0 ? minX : minY
    const hi = axis === 0 ? maxX : maxY
    if (Math.abs(d) < 1e-9) {
      if (p0 < lo || p0 > hi) return { x: sx, y: sy }
    } else {
      let r0 = (lo - p0) / d
      let r1 = (hi - p0) / d
      if (r0 > r1) {
        const tmp = r0
        r0 = r1
        r1 = tmp
      }
      tEnter = Math.max(tEnter, r0)
      tExit = Math.min(tExit, r1)
      if (tEnter > tExit) return { x: sx, y: sy }
    }
  }

  if (tExit > 0 && tExit < 0.85) {
    return { x: sx + dx * tExit, y: sy + dy * tExit }
  }
  return { x: sx, y: sy }
}

/**
 * Computes a live interpolated SVG edge path (`d` + control points) following moving node
 * endpoints during RAF focus/orientation transitions (`T3.5-fix`, `T3.6`, `FR-MAP-05`).
 */
export function computeLiveEdgePath(
  srcNode: MapLayoutNode,
  dstNode: MapLayoutNode,
  srcPos: LiveNodeEndpointState,
  dstPos: LiveNodeEndpointState,
  orientation: MapEdgeOrientation,
): { readonly d: string; readonly controlPoints: EdgeControlPoints } {
  let sx: number
  let sy: number
  let tx: number
  let ty: number

  if (orientation === 'horizontal') {
    sx = srcPos.x + (srcNode.width * srcPos.scale) / 2
    sy = srcPos.y
    tx = dstPos.x - (dstNode.width * dstPos.scale) / 2
    ty = dstPos.y
  } else {
    const dx = dstPos.x - srcPos.x
    const dy = dstPos.y - srcPos.y
    const sPt = clipLiveNodeBoundary(srcPos, srcNode, dx, dy)
    const tPt = clipLiveNodeBoundary(dstPos, dstNode, -dx, -dy)
    const clippedSrc = clipRadialSourcePastLabelBox(
      srcNode.labelBox
        ? {
            ...srcNode,
            labelBox: {
              x: srcPos.x + (srcNode.labelBox.x - srcNode.x),
              y: srcPos.y + (srcNode.labelBox.y - srcNode.y),
              width: srcNode.labelBox.width,
              height: srcNode.labelBox.height,
            },
          }
        : srcNode,
      sPt.x,
      sPt.y,
      tPt.x,
      tPt.y,
    )
    sx = clippedSrc.x
    sy = clippedSrc.y
    tx = tPt.x
    ty = tPt.y
  }

  const cp = computeEdgeControlPoints(
    {
      id: `${srcNode.id}->${dstNode.id}`,
      sourceId: srcNode.id,
      targetId: dstNode.id,
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
    },
    orientation,
  )
  return { d: formatEdgePathD(cp), controlPoints: cp }
}

/**
 * Formats a horizontal edge routed through the obstacle-free inter-column gutter
 * `[gutterLeft, gutterRight]`. Horizontal stubs run along the parent's and child's
 * own rows (`sy`, `ty`), while the vertical S-curve stays strictly inside `[gutterLeft, gutterRight]`,
 * guaranteeing zero crossings over wider sibling capsules (`T3.4c-c`, `FR-MAP-04`).
 */
export function formatHorizontalGutterEdgePathD(
  cp: EdgeControlPoints,
  gutterLeft: number,
  gutterRight: number,
): string {
  if (!(gutterRight > gutterLeft + 1) || cp.sx > gutterLeft + 0.5 || cp.tx < gutterRight - 0.5) {
    return formatEdgePathD(cp)
  }
  const f = (n: number) => Number(n.toFixed(2))
  const gLeft = Math.max(cp.sx, gutterLeft)
  const gRight = Math.min(cp.tx, gutterRight)
  const gMid = (gLeft + gRight) * 0.5
  const startStub = gLeft - cp.sx > 0.5 ? ` L ${f(gLeft)} ${f(cp.sy)}` : ''
  const endStub = cp.tx - gRight > 0.5 ? ` L ${f(cp.tx)} ${f(cp.ty)}` : ''
  return `M ${f(cp.sx)} ${f(cp.sy)}${startStub} C ${f(gMid)} ${f(cp.sy)}, ${f(gMid)} ${f(cp.ty)}, ${f(gRight)} ${f(cp.ty)}${endStub}`
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

/** Samples points along an actual SVG `M ... [L ...] C ... [L ...]` path `d` string. */
export function sampleEdgePathPoints(
  d: string,
  stepsPerSegment = 12,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const safeSteps = Math.max(2, Math.floor(stepsPerSegment))
  const tokenRe = /([MLC])|(-?\d+(?:\.\d+)?)/g
  const tokens: string[] = []
  for (const m of d.matchAll(tokenRe)) {
    tokens.push(m[0])
  }

  const points: Array<{ readonly x: number; readonly y: number }> = []
  let i = 0
  let curX = 0
  let curY = 0
  let cmd = ''

  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok === 'M' || tok === 'L' || tok === 'C') {
      cmd = tok
      i += 1
      continue
    }
    if (cmd === 'M') {
      curX = Number.parseFloat(tokens[i]!)
      curY = Number.parseFloat(tokens[i + 1]!)
      points.push({ x: curX, y: curY })
      i += 2
      cmd = 'L'
    } else if (cmd === 'L') {
      const nx = Number.parseFloat(tokens[i]!)
      const ny = Number.parseFloat(tokens[i + 1]!)
      for (let s = 1; s <= safeSteps; s += 1) {
        const t = s / safeSteps
        points.push({ x: curX + (nx - curX) * t, y: curY + (ny - curY) * t })
      }
      curX = nx
      curY = ny
      i += 2
    } else if (cmd === 'C') {
      const cx1 = Number.parseFloat(tokens[i]!)
      const cy1 = Number.parseFloat(tokens[i + 1]!)
      const cx2 = Number.parseFloat(tokens[i + 2]!)
      const cy2 = Number.parseFloat(tokens[i + 3]!)
      const tx = Number.parseFloat(tokens[i + 4]!)
      const ty = Number.parseFloat(tokens[i + 5]!)
      const bez = sampleCubicBezierPoints(
        { sx: curX, sy: curY, cx1, cy1, cx2, cy2, tx, ty },
        safeSteps,
      )
      for (let s = 1; s < bez.length; s += 1) {
        points.push(bez[s]!)
      }
      curX = tx
      curY = ty
      i += 6
    } else {
      i += 1
    }
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

  const colMaxRight = new Map<number, number>()
  const colMinLeft = new Map<number, number>()
  if (orientation === 'horizontal') {
    for (const id of layout.orderedIds) {
      const n = layout.nodes[id]
      if (!n) continue
      colMaxRight.set(n.depth, Math.max(colMaxRight.get(n.depth) ?? -Infinity, n.x + n.width / 2))
      colMinLeft.set(n.depth, Math.min(colMinLeft.get(n.depth) ?? Infinity, n.x - n.width / 2))
    }
  }

  return layout.edges.map((edge, idx) => {
    const srcNode = layout.nodes[edge.sourceId]
    const effectiveEdge =
      orientation === 'radial'
        ? (() => {
            const clipped = clipRadialSourcePastLabelBox(
              srcNode,
              edge.sourceX,
              edge.sourceY,
              edge.targetX,
              edge.targetY,
            )
            return clipped.x === edge.sourceX && clipped.y === edge.sourceY
              ? edge
              : { ...edge, sourceX: clipped.x, sourceY: clipped.y }
          })()
        : edge
    const cp = computeEdgeControlPoints(effectiveEdge, orientation)
    const srcVisible = visible.nodes[edge.sourceId]
    const dstVisible = visible.nodes[edge.targetId]
    const isOnFocusPath = Boolean(srcVisible?.isOnFocusPath && dstVisible?.isOnFocusPath)
    const srcDepth = layout.nodes[edge.sourceId]?.depth ?? srcVisible?.depth ?? 0
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

    const d =
      orientation === 'horizontal' && colMaxRight.has(srcDepth) && colMinLeft.has(dstDepth)
        ? formatHorizontalGutterEdgePathD(cp, colMaxRight.get(srcDepth)!, colMinLeft.get(dstDepth)!)
        : formatEdgePathD(cp)

    return {
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      d,
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

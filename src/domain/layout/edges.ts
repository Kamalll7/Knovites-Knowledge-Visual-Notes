import type { BoxBounds, PlacedMutableNode, SizedNodeSpec } from './types'

export interface MutablePoint {
  x: number
  y: number
}

function clipRayInto(
  cx: number,
  cy: number,
  spec: SizedNodeSpec,
  dx: number,
  dy: number,
  out: MutablePoint,
): void {
  const len = Math.hypot(dx, dy)
  if (len === 0) {
    out.x = cx
    out.y = cy
    return
  }
  if (spec.shape === 'circle' && spec.radius !== null) {
    out.x = cx + (dx / len) * spec.radius
    out.y = cy + (dy / len) * spec.radius
    return
  }
  const t = Math.min(
    dx !== 0 ? spec.width / 2 / Math.abs(dx) : Infinity,
    dy !== 0 ? spec.height / 2 / Math.abs(dy) : Infinity,
  )
  out.x = cx + dx * t
  out.y = cy + dy * t
}

/** Clips both endpoints of `p <-> c` into `pOut` and `cOut` without allocations. */
export function clipEdgeEndpointsInto(
  p: PlacedMutableNode,
  c: PlacedMutableNode,
  pOut: MutablePoint,
  cOut: MutablePoint,
): void {
  clipRayInto(p.x, p.y, p.spec, c.x - p.x, c.y - p.y, pOut)
  clipRayInto(c.x, c.y, c.spec, p.x - c.x, p.y - c.y, cOut)
}

/** Clips the ray from node center `(cx, cy)` along `(dx, dy)` onto its capsule or circle boundary. */
export function clipRayToNodeEdge(
  cx: number,
  cy: number,
  spec: SizedNodeSpec,
  dx: number,
  dy: number,
): { readonly x: number; readonly y: number } {
  const out = { x: 0, y: 0 }
  clipRayInto(cx, cy, spec, dx, dy, out)
  return out
}

/** Allocation-free Liang–Barsky segment vs scalar `[minX, minY, maxX, maxY]` check. */
export function segmentIntersectsRawBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  let t0 = 0,
    t1 = 1
  const dx = x2 - x1,
    dy = y2 - y1
  for (let axis = 0; axis < 2; axis += 1) {
    const d = axis === 0 ? dx : dy
    const p0 = axis === 0 ? x1 : y1
    const lo = axis === 0 ? minX : minY
    const hi = axis === 0 ? maxX : maxY
    if (d === 0) {
      if (p0 < lo || p0 > hi) return false
    } else {
      const r0 = (lo - p0) / d,
        r1 = (hi - p0) / d
      t0 = Math.max(t0, Math.min(r0, r1))
      t1 = Math.min(t1, Math.max(r0, r1))
      if (t0 > t1) return false
    }
  }
  return t0 <= t1
}

/** Liang–Barsky intersection check between line segment `(x1, y1)->(x2, y2)` and AABB `box`. */
export function segmentIntersectsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: BoxBounds,
): boolean {
  return segmentIntersectsRawBounds(
    x1,
    y1,
    x2,
    y2,
    box.x,
    box.y,
    box.x + box.width,
    box.y + box.height,
  )
}

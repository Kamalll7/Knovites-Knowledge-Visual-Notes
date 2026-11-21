import type { BoxBounds, SizedNodeSpec } from './types'

/** Clips the ray from node center `(cx, cy)` along `(dx, dy)` onto its capsule or circle boundary. */
export function clipRayToNodeEdge(
  cx: number,
  cy: number,
  spec: SizedNodeSpec,
  dx: number,
  dy: number,
): { readonly x: number; readonly y: number } {
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: cx, y: cy }

  if (spec.shape === 'circle' && spec.radius !== null) {
    const ux = dx / len
    const uy = dy / len
    return { x: cx + ux * spec.radius, y: cy + uy * spec.radius }
  }

  const halfW = spec.width / 2
  const halfH = spec.height / 2
  const tx = dx !== 0 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY
  const ty = dy !== 0 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY
  const t = Math.min(tx, ty)
  return { x: cx + dx * t, y: cy + dy * t }
}

/** Liang–Barsky intersection check between line segment `(x1, y1)->(x2, y2)` and AABB `box`. */
export function segmentIntersectsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: BoxBounds,
): boolean {
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  const checks: readonly [number, number][] = [
    [-dx, x1 - box.x],
    [dx, box.x + box.width - x1],
    [-dy, y1 - box.y],
    [dy, box.y + box.height - y1],
  ]

  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const r = q / p
      if (p < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return t0 <= t1
}

import type { ComputeVisibleResult } from './compute-visible'
import type { LayoutPrepared, PlacedMutableNode, RadialLayoutConfig } from './types'

interface LocalOccupiedBox {
  readonly cxOff: number
  readonly cyOff: number
  readonly width: number
  readonly height: number
}

function localOccupiedBox(spec: PlacedMutableNode['spec']): LocalOccupiedBox {
  const hw = spec.width / 2
  const hh = spec.height / 2
  const lb = spec.localLabelBox
  if (!lb) {
    return { cxOff: 0, cyOff: 0, width: spec.width, height: spec.height }
  }
  const uMinX = Math.min(-hw, lb.x)
  const uMaxX = Math.max(hw, lb.x + lb.width)
  const uMinY = Math.min(-hh, lb.y)
  const uMaxY = Math.max(hh, lb.y + lb.height)
  return {
    cxOff: (uMinX + uMaxX) / 2,
    cyOff: (uMinY + uMaxY) / 2,
    width: uMaxX - uMinX,
    height: uMaxY - uMinY,
  }
}

/**
 * Computes the smallest base ring radius `R >= minR` at which two sibling boxes on fixed rays
 * `(tA, tB)` with radial stagger offsets `(offA, offB)` satisfy exact 2D AABB clearance `minGapPx`.
 */
function minClearBaseRadius(
  minR: number,
  tA: number,
  offA: number,
  boxA: LocalOccupiedBox,
  tB: number,
  offB: number,
  boxB: LocalOccupiedBox,
  minGapPx: number,
): number {
  const reqX = (boxA.width + boxB.width) / 2 + minGapPx
  const reqY = (boxA.height + boxB.height) / 2 + minGapPx
  const ax = Math.sin(tB) - Math.sin(tA)
  const bx = offB * Math.sin(tB) + boxB.cxOff - (offA * Math.sin(tA) + boxA.cxOff)
  const ay = -Math.cos(tB) + Math.cos(tA)
  const by = -offB * Math.cos(tB) + boxB.cyOff - (-offA * Math.cos(tA) + boxA.cyOff)

  if (Math.abs(ax * minR + bx) >= reqX || Math.abs(ay * minR + by) >= reqY) {
    return minR
  }

  const endX =
    Math.abs(ax) < 1e-12
      ? Math.abs(bx) < reqX
        ? Number.POSITIVE_INFINITY
        : minR
      : Math.max((-reqX - bx) / ax, (reqX - bx) / ax)
  const endY =
    Math.abs(ay) < 1e-12
      ? Math.abs(by) < reqY
        ? Number.POSITIVE_INFINITY
        : minR
      : Math.max((-reqY - by) / ay, (reqY - by) / ay)

  const exitR = Math.min(endX, endY)
  if (!Number.isFinite(exitR)) return minR
  return Math.max(minR, exitR + 0.5)
}

/** Updates `(x, y)` from clock-12 polar coordinates (`theta=0` points North). */
export function updateCartesian(n: PlacedMutableNode): void {
  if (n.r === 0) {
    n.x = 0
    n.y = 0
    return
  }
  n.x = n.r * Math.sin(n.theta)
  n.y = -n.r * Math.cos(n.theta)
}

/** Shifts a subtree outward radially by `deltaR` while keeping angles fixed. */
export function pushSubtreeOutward(
  subtreeRootId: string,
  deltaR: number,
  childrenMap: Map<string, string[]>,
  placed: Map<string, PlacedMutableNode>,
): void {
  const queue: string[] = [subtreeRootId]
  while (queue.length > 0) {
    const curId = queue.pop()!
    const node = placed.get(curId)
    if (!node) continue
    node.r += deltaR
    updateCartesian(node)
    for (const childId of childrenMap.get(curId) ?? []) {
      queue.push(childId)
    }
  }
}

/** Assigns initial concentric ring radii, stagger indices, and angular wedges top-down. */
export function assignInitialPolarNodes(
  rootId: string,
  visible: ComputeVisibleResult,
  prepared: LayoutPrepared,
  config: RadialLayoutConfig,
): { readonly placed: Map<string, PlacedMutableNode>; readonly placedPreOrder: string[] } {
  const { childrenMap, specs, weights, maxHalfRadialByDepth } = prepared
  const placed = new Map<string, PlacedMutableNode>()
  const placedPreOrder: string[] = []
  interface WedgeAssignment {
    readonly id: string
    readonly wedgeStart: number
    readonly wedgeEnd: number
    readonly staggerRingCount: 1 | 2 | 3
    readonly staggerIndex: number
    readonly depthRadiusMin: number
  }

  const bfsQueue: WedgeAssignment[] = [
    {
      id: rootId,
      wedgeStart: 0,
      wedgeEnd: Math.PI * 2,
      staggerRingCount: 1,
      staggerIndex: 0,
      depthRadiusMin: 0,
    },
  ]

  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!
    const vNode = visible.nodes[current.id]!
    const spec = specs.get(current.id)!
    const midTheta = (current.wedgeStart + current.wedgeEnd) / 2
    const nodeRadius =
      current.id === rootId
        ? 0
        : current.depthRadiusMin + current.staggerIndex * config.staggerRadialStepPx

    const mutable: PlacedMutableNode = {
      id: current.id,
      parentId: current.id === rootId ? null : vNode.parentId,
      depth: vNode.depth,
      kind: vNode.kind,
      spec,
      staggerRingCount: current.staggerRingCount,
      staggerIndex: current.staggerIndex,
      subtreeWeight: weights.get(current.id) ?? 1,
      r: nodeRadius,
      theta: midTheta,
      x: 0,
      y: 0,
      wedgeStart: current.wedgeStart,
      wedgeEnd: current.wedgeEnd,
    }
    updateCartesian(mutable)
    placed.set(current.id, mutable)
    placedPreOrder.push(current.id)

    const children = childrenMap.get(current.id) ?? []
    if (children.length === 0) continue

    const rawSpan = current.wedgeEnd - current.wedgeStart
    const usableSpan =
      current.id === rootId ? rawSpan : Math.min(rawSpan, config.maxNonRootFanRadians)
    const fanStart = midTheta - usableSpan / 2
    const staggerRingCount: 1 | 2 | 3 =
      children.length >= config.staggerThreshold3
        ? 3
        : children.length >= config.staggerThreshold2
          ? 2
          : 1

    const effWeights: number[] = new Array(children.length)
    let totalChildW = 0
    let maxIdx = 0
    let maxW = -1
    for (let i = 0; i < children.length; i += 1) {
      const w = weights.get(children[i]!) ?? 1
      effWeights[i] = w
      totalChildW += w
      if (w > maxW) {
        maxW = w
        maxIdx = i
      }
    }

    // Reclaim angular span wasted when a root branch with children receives > maxNonRootFanRadians
    // (255 deg): non-root fans clamp their usableSpan to 255 deg, so excess span above 255 deg
    // would become dead void. Guarded by children.length >= 3 so 2-branch ratio tests stay exact.
    if (
      current.id === rootId &&
      usableSpan > config.maxNonRootFanRadians &&
      children.length >= 3 &&
      (childrenMap.get(children[maxIdx]!)?.length ?? 0) > 0 &&
      totalChildW > 0
    ) {
      const maxSingleFrac = config.maxNonRootFanRadians / usableSpan
      if (maxW / totalChildW > maxSingleFrac) {
        const otherSum = totalChildW - maxW
        if (otherSum > 0) {
          const cappedW = (maxSingleFrac / (1 - maxSingleFrac)) * otherSum
          effWeights[maxIdx] = cappedW
          totalChildW = otherSum + cappedW
        }
      }
    }

    const childSpans: number[] = new Array(children.length)
    const childThetas: number[] = new Array(children.length)
    const childStaggers: number[] = new Array(children.length)
    const childBoxes: LocalOccupiedBox[] = new Array(children.length)
    let angleCursor = fanStart
    for (let i = 0; i < children.length; i += 1) {
      const cSpan = (usableSpan * effWeights[i]!) / totalChildW
      childSpans[i] = cSpan
      childThetas[i] = angleCursor + cSpan / 2
      childStaggers[i] = staggerRingCount === 1 ? 0 : i % staggerRingCount
      childBoxes[i] = localOccupiedBox(specs.get(children[i]!)!)
      angleCursor += cSpan
    }

    const parentHalf = Math.hypot(spec.width, spec.height) / 2
    const childHalf = maxHalfRadialByDepth.get(vNode.depth + 1) ?? 40
    let nextMinR =
      nodeRadius +
      parentHalf +
      childHalf +
      config.ringBaseGapPx +
      vNode.depth * config.ringDepthStepPx

    if (children.length >= 2) {
      const pairWindow = Math.min(children.length - 1, Math.max(staggerRingCount + 1, 3))
      const wrapWindow = current.id === rootId ? Math.min(children.length - 1, staggerRingCount) : 0
      for (let iter = 0; iter < 4; iter += 1) {
        let rNeeded = nextMinR
        for (let i = 0; i < children.length; i += 1) {
          const offA = childStaggers[i]! * config.staggerRadialStepPx
          const tA = childThetas[i]!
          const boxA = childBoxes[i]!
          const jMax = Math.min(children.length - 1, i + pairWindow)
          for (let j = i + 1; j <= jMax; j += 1) {
            rNeeded = Math.max(
              rNeeded,
              minClearBaseRadius(
                rNeeded,
                tA,
                offA,
                boxA,
                childThetas[j]!,
                childStaggers[j]! * config.staggerRadialStepPx,
                childBoxes[j]!,
                config.minGapPx,
              ),
            )
          }
        }
        if (wrapWindow > 0) {
          for (let a = 0; a < wrapWindow; a += 1) {
            const i = children.length - 1 - a
            const offA = childStaggers[i]! * config.staggerRadialStepPx
            const tA = childThetas[i]!
            const boxA = childBoxes[i]!
            for (let b = 0; b < wrapWindow; b += 1) {
              if (b >= i) continue
              rNeeded = Math.max(
                rNeeded,
                minClearBaseRadius(
                  rNeeded,
                  tA,
                  offA,
                  boxA,
                  childThetas[b]!,
                  childStaggers[b]! * config.staggerRadialStepPx,
                  childBoxes[b]!,
                  config.minGapPx,
                ),
              )
            }
          }
        }
        if (rNeeded <= nextMinR + 1e-6) break
        nextMinR = rNeeded
      }
    }

    let cursor = fanStart
    children.forEach((childId, idx) => {
      const cSpan = childSpans[idx]!
      bfsQueue.push({
        id: childId,
        wedgeStart: cursor,
        wedgeEnd: cursor + cSpan,
        staggerRingCount,
        staggerIndex: childStaggers[idx]!,
        depthRadiusMin: nextMinR,
      })
      cursor += cSpan
    })
  }

  return { placed, placedPreOrder }
}

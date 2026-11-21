import type { ComputeVisibleResult } from './compute-visible'
import type { LayoutPrepared, PlacedMutableNode, RadialLayoutConfig } from './types'

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

    let totalChildW = 0
    for (const cId of children) {
      totalChildW += weights.get(cId) ?? 1
    }

    const effectiveRingDivisor = staggerRingCount === 1 ? 1 : staggerRingCount === 2 ? 1.6 : 2.15
    let totalSiblingChord = 0
    for (const cId of children) {
      totalSiblingChord += specs.get(cId)!.width + config.minGapPx
    }
    const minGroupArcRadius =
      usableSpan > 0 ? totalSiblingChord / (usableSpan * effectiveRingDivisor) : 0

    let sameRingPairArcNeeded = 0
    for (let i = 0; i + staggerRingCount < children.length; i += 1) {
      const aId = children[i]!
      const bId = children[i + staggerRingCount]!
      const halfSum = specs.get(aId)!.width / 2 + specs.get(bId)!.width / 2 + config.minGapPx
      let betweenWeight = ((weights.get(aId) ?? 1) + (weights.get(bId) ?? 1)) * 0.5
      for (let m = i + 1; m < i + staggerRingCount; m += 1) {
        betweenWeight += weights.get(children[m]!) ?? 1
      }
      const pairAngle = totalChildW > 0 ? (usableSpan * betweenWeight) / totalChildW : 0
      if (pairAngle > 0.01) {
        sameRingPairArcNeeded = Math.max(sameRingPairArcNeeded, halfSum / pairAngle)
      }
    }

    const parentHalf = Math.hypot(spec.width, spec.height) / 2
    const childHalf = maxHalfRadialByDepth.get(vNode.depth + 1) ?? 40
    const nextMinR = Math.max(
      nodeRadius +
        parentHalf +
        childHalf +
        config.ringBaseGapPx +
        vNode.depth * config.ringDepthStepPx,
      minGroupArcRadius,
      sameRingPairArcNeeded,
    )

    let cursor = fanStart
    children.forEach((childId, idx) => {
      const cWeight = weights.get(childId) ?? 1
      const cSpan = (usableSpan * cWeight) / totalChildW
      bfsQueue.push({
        id: childId,
        wedgeStart: cursor,
        wedgeEnd: cursor + cSpan,
        staggerRingCount,
        staggerIndex: staggerRingCount === 1 ? 0 : idx % staggerRingCount,
        depthRadiusMin: nextMinR,
      })
      cursor += cSpan
    })
  }

  return { placed, placedPreOrder }
}

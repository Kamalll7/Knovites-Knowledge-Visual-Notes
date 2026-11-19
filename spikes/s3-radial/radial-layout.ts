import { hierarchy } from 'd3-hierarchy'
import type { ComputeVisibleResult, VisibleMapNode, ZoomTier } from './compute-visible'

export const MIN_GAP_PX = 12
export const RING_BASE_GAP = 148
export const RING_DEPTH_STEP = 116

export interface PositionedMapNode extends VisibleMapNode {
  /** Polar angle in radians, 0 at 12 o'clock (-y), increasing clockwise (d3.linkRadial convention). */
  theta: number
  /** Polar radius from (0, 0) in px. */
  r: number
  /** Angular wedge assigned by weighted partition [thetaStart, thetaEnd]. */
  thetaStart: number
  thetaEnd: number
  /** Cartesian x center (`r * Math.sin(theta)`). */
  x: number
  /** Cartesian y center (`-r * Math.cos(theta)`). */
  y: number
  width: number
  height: number
  weight: number
}

export interface PositionedMapEdge {
  id: string
  sourceId: string
  targetId: string
  sourceTheta: number
  sourceR: number
  targetTheta: number
  targetR: number
  isOnFocusPath: boolean
  branchRootId: string | null
  strokeWidth: number
}

export interface RadialLayoutResult {
  nodes: Record<string, PositionedMapNode>
  orderedIds: string[]
  edges: PositionedMapEdge[]
  ringRadii: number[]
  overlapCount: number
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
}

export function polarToCartesian(theta: number, r: number): { x: number; y: number } {
  return {
    x: r * Math.sin(theta),
    y: -r * Math.cos(theta),
  }
}

function measureNodeDimensions(
  node: VisibleMapNode,
  zoomTier: ZoomTier,
): {
  width: number
  height: number
} {
  if (node.kind === 'root') {
    const labelLen = Math.min(36, node.title.length)
    return {
      width: Math.max(150, Math.min(328, Math.round(56 + labelLen * 7.6))),
      height: 46,
    }
  }

  if (node.kind === 'overflow') {
    const label = node.title
    return {
      width: Math.max(58, 26 + label.length * 8),
      height: 34,
    }
  }

  if (zoomTier === 0) {
    // Overview zoom tier: keep circles large enough to see & click; labels shown cleanly around depth-1/focus
    const size = Math.round(38 + Math.min(18, Math.log2(1 + node.totalDescendants) * 3.5))
    return {
      width: size + (node.depth === 1 || node.isFocus ? 104 : 0),
      height: size + (node.depth === 1 || node.isFocus ? 22 : 0),
    }
  }

  const badgeText = node.totalDescendants > 0 ? ` · ${node.totalDescendants}` : ''
  const clippedLen = Math.min(26, node.title.length)
  const scaleBoost = Math.round(Math.log2(1 + node.totalDescendants) * 2.5)
  const baseWidth = 58 + clippedLen * 7.2 + badgeText.length * 6.5 + scaleBoost
  const width = Math.max(118, Math.min(268, Math.round(baseWidth)))
  const baseHeight = node.isGrandchildPreview ? 32 : zoomTier === 2 ? 48 : 38
  const height = node.isFocus ? Math.max(baseHeight, 44) : baseHeight

  return { width, height }
}

/**
 * Axis-aligned bounding-box overlap check with optional minimum clearance `gap`.
 */
export function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number,
): boolean {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  const reqX = (a.width + b.width) / 2 + gap
  const reqY = (a.height + b.height) / 2 + gap
  return dx < reqX && dy < reqY
}

export function countOverlappingPairs(
  nodes: readonly { id: string; x: number; y: number; width: number; height: number }[],
  gap: number = 0,
): number {
  let count = 0
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (boxesOverlap(nodes[i]!, nodes[j]!, gap)) {
        count += 1
      }
    }
  }
  return count
}

interface HierarchyDatum {
  node: VisibleMapNode
  weight: number
}

/**
 * Pure radial layout with proportional angular wedges (`FR-MAP-03`):
 * - Uses `d3-hierarchy` to compute tree depth, links, and bottom-up proportional weights.
 * - Allocates angular wedges `[thetaStart, thetaEnd]` proportionally to child weights.
 * - Uses adaptive ring radii + deterministic sub-ring staggering for dense sibling fans (>= 12
 *   visible children) and minimum-clearance radial projection so ZERO nodes overlap (`MIN_GAP = 12px`).
 */
export function computeRadialLayout(
  visible: ComputeVisibleResult,
  zoomTier: ZoomTier,
): RadialLayoutResult {
  const rootDatum = visible.nodes[visible.rootId]!
  const hRoot = hierarchy<VisibleMapNode>(rootDatum, (d) =>
    d.visibleChildIds.map((id) => visible.nodes[id]).filter((n): n is VisibleMapNode => !!n),
  )

  // Bottom-up angular weight per FR-MAP-03:
  // Expanded active branches naturally accumulate their visible children's weights so focus fans
  // receive generous angular wedges instead of being starved by collapsed heavy cousins.
  const weightById = new Map<string, number>()
  const dimsById = new Map<string, { width: number; height: number }>()

  hRoot.eachAfter((hNode) => {
    const vNode = hNode.data
    dimsById.set(vNode.id, measureNodeDimensions(vNode, zoomTier))

    if (!hNode.children || hNode.children.length === 0) {
      const leafWeight = 1 + 0.35 * Math.log2(1 + vNode.hiddenCount)
      weightById.set(vNode.id, Math.max(1, leafWeight))
      return
    }

    let childWeightSum = 0
    for (const child of hNode.children) {
      childWeightSum += weightById.get(child.data.id) ?? 1
    }
    const focusBoost = vNode.isOnFocusPath ? 2.5 : 0
    const selfBase = 1 + 0.35 * Math.log2(1 + vNode.hiddenCount) + focusBoost
    weightById.set(vNode.id, Math.max(selfBase, childWeightSum + focusBoost))
  })

  // Assign proportional angular wedges top-down
  const thetaById = new Map<string, number>()
  const wedgeById = new Map<string, { start: number; end: number }>()
  const staggerOffsetById = new Map<string, number>()

  // Start root wedge from 12 o'clock (-π..+π or 0..2π); placing first child at ~ -20 deg balances focus-forward look
  thetaById.set(visible.rootId, 0)
  wedgeById.set(visible.rootId, { start: 0, end: Math.PI * 2 })
  staggerOffsetById.set(visible.rootId, 0)

  const assignWedges = (parentId: string) => {
    const parentNode = visible.nodes[parentId]
    if (!parentNode) return
    const childIds = parentNode.visibleChildIds
    if (childIds.length === 0) return

    const parentWedge = wedgeById.get(parentId)!
    const parentSpan = parentWedge.end - parentWedge.start

    // For non-root single-parent huge fans (e.g., wide60Children), constrain fan within an outward
    // forward arc (up to ~245 deg centered on parent's theta) so edges never fold backward through (0, 0)
    let activeStart = parentWedge.start
    let activeSpan = parentSpan
    if (parentId !== visible.rootId && childIds.length > 1 && parentSpan > Math.PI * 1.45) {
      const parentTheta = thetaById.get(parentId) ?? 0
      const clampedSpan = Math.min(parentSpan, Math.PI * 1.42)
      activeStart = parentTheta - clampedSpan / 2
      activeSpan = clampedSpan
    }

    let totalChildWeight = 0
    for (const cid of childIds) {
      totalChildWeight += weightById.get(cid) ?? 1
    }

    // Stagger dense sibling fans radially across 2 or 3 sub-tiers so neighboring pills never collide horizontally
    const staggerTiers = childIds.length >= 34 ? 3 : childIds.length >= 12 ? 2 : 1
    const staggerStep = childIds.length >= 34 ? 56 : 52

    let cursorAngle = activeStart
    childIds.forEach((cid, idx) => {
      const childWeight = weightById.get(cid) ?? 1
      const share = (childWeight / totalChildWeight) * activeSpan
      const cStart = cursorAngle
      const cEnd = cursorAngle + share
      cursorAngle = cEnd

      const midTheta = (cStart + cEnd) / 2
      thetaById.set(cid, midTheta)
      wedgeById.set(cid, { start: cStart, end: cEnd })
      const tierIdx = staggerTiers === 1 ? 0 : idx % staggerTiers
      staggerOffsetById.set(cid, tierIdx * staggerStep)

      assignWedges(cid)
    })
  }

  assignWedges(visible.rootId)

  // Compute adaptive base radius per depth ring (monotonic r(d) > r(d-1) + clearance)
  const nodesByDepth = new Map<number, VisibleMapNode[]>()
  let maxDepth = 0
  for (const id of visible.orderedIds) {
    const n = visible.nodes[id]!
    maxDepth = Math.max(maxDepth, n.depth)
    const list = nodesByDepth.get(n.depth) ?? []
    list.push(n)
    nodesByDepth.set(n.depth, list)
  }

  const baseRingRadii: number[] = [0]
  for (let d = 1; d <= maxDepth; d += 1) {
    const prevNodes = nodesByDepth.get(d - 1) ?? []
    const curNodes = nodesByDepth.get(d) ?? []

    let maxPrevReach = 0
    for (const pn of prevNodes) {
      const pDims = dimsById.get(pn.id)!
      const pStagger = staggerOffsetById.get(pn.id) ?? 0
      const halfDiag = Math.max(pDims.width, pDims.height) * 0.5
      maxPrevReach = Math.max(maxPrevReach, pStagger + halfDiag)
    }

    let maxCurHalfDiag = 24
    let circumferenceNeed = 0
    for (const cn of curNodes) {
      const cDims = dimsById.get(cn.id)!
      maxCurHalfDiag = Math.max(maxCurHalfDiag, Math.max(cDims.width, cDims.height) * 0.5)
      circumferenceNeed += cDims.width * 0.72 + MIN_GAP_PX
    }

    const minFromPrevRing =
      d === 1
        ? Math.max(RING_BASE_GAP, 46 + maxCurHalfDiag + MIN_GAP_PX)
        : baseRingRadii[d - 1]! + Math.max(RING_DEPTH_STEP, maxPrevReach + maxCurHalfDiag + 18)

    const minFromCircumference =
      curNodes.length > 1 ? Math.round(circumferenceNeed / (Math.PI * 2)) : 0

    // Bound runaway growth on circumference when stagger already handles dense arcs
    const cappedCircumference =
      curNodes.length >= 12
        ? Math.min(minFromCircumference, minFromPrevRing + 160)
        : minFromCircumference

    baseRingRadii[d] = Math.max(minFromPrevRing, cappedCircumference)
  }

  // Initial polar radii including stagger offset
  const radiusById = new Map<string, number>()
  const posList: Array<{
    id: string
    depth: number
    theta: number
    r: number
    x: number
    y: number
    width: number
    height: number
  }> = []

  for (const id of visible.orderedIds) {
    const n = visible.nodes[id]!
    const theta = thetaById.get(id) ?? 0
    const r = n.depth === 0 ? 0 : baseRingRadii[n.depth]! + (staggerOffsetById.get(id) ?? 0)
    radiusById.set(id, r)
    const { x, y } = polarToCartesian(theta, r)
    const dims = dimsById.get(id)!
    posList.push({
      id,
      depth: n.depth,
      theta,
      r,
      x,
      y,
      width: dims.width,
      height: dims.height,
    })
  }

  // Deterministic radial collision resolution (preserves theta/wedges & parent<child ordering):
  // Process outward by depth and radius; push colliding outer box radially outward along its own theta ray
  // until zero AABB overlaps exist with MIN_GAP_PX clearance.
  posList.sort((a, b) => a.depth - b.depth || a.r - b.r || a.theta - b.theta)
  const placed: typeof posList = []

  for (const item of posList) {
    if (item.depth > 0) {
      const parentId = visible.nodes[item.id]?.parentId
      if (parentId) {
        const parentRadius = radiusById.get(parentId) ?? 0
        const minChildR = parentRadius + 78
        if (item.r < minChildR) {
          item.r = minChildR
          const p = polarToCartesian(item.theta, item.r)
          item.x = p.x
          item.y = p.y
        }
      }
    }

    if (item.depth > 0) {
      let guard = 0
      while (guard < 80) {
        guard += 1
        let blocker: (typeof posList)[number] | null = null
        for (const prev of placed) {
          if (boxesOverlap(item, prev, MIN_GAP_PX)) {
            blocker = prev
            break
          }
        }
        if (!blocker) break

        // Compute smallest outward radial increment along unit vector u = (sin theta, -cos theta)
        // that guarantees item clears blocker horizontally OR vertically
        const ux = Math.sin(item.theta)
        const uy = -Math.cos(item.theta)
        const reqX = (item.width + blocker.width) / 2 + MIN_GAP_PX
        const reqY = (item.height + blocker.height) / 2 + MIN_GAP_PX

        const candidates: number[] = []
        if (Math.abs(ux) > 1e-4) {
          const t1 = (blocker.x + reqX - item.x) / ux
          const t2 = (blocker.x - reqX - item.x) / ux
          if (t1 > 0.5) candidates.push(t1)
          if (t2 > 0.5) candidates.push(t2)
        }
        if (Math.abs(uy) > 1e-4) {
          const t3 = (blocker.y + reqY - item.y) / uy
          const t4 = (blocker.y - reqY - item.y) / uy
          if (t3 > 0.5) candidates.push(t3)
          if (t4 > 0.5) candidates.push(t4)
        }

        const step = candidates.length > 0 ? Math.max(4, Math.min(...candidates) + 0.5) : 16
        item.r += step
        const nextPt = polarToCartesian(item.theta, item.r)
        item.x = nextPt.x
        item.y = nextPt.y
      }
    }

    radiusById.set(item.id, item.r)
    placed.push(item)
  }

  // Assemble final PositionedMapNode map & edges
  const nodes: Record<string, PositionedMapNode> = {}
  let minX = 0
  let maxX = 0
  let minY = 0
  let maxY = 0

  for (const item of placed) {
    const vNode = visible.nodes[item.id]!
    const wedge = wedgeById.get(item.id)!
    nodes[item.id] = {
      ...vNode,
      theta: item.theta,
      r: item.r,
      thetaStart: wedge.start,
      thetaEnd: wedge.end,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      weight: weightById.get(item.id) ?? 1,
    }

    minX = Math.min(minX, item.x - item.width / 2)
    maxX = Math.max(maxX, item.x + item.width / 2)
    minY = Math.min(minY, item.y - item.height / 2)
    maxY = Math.max(maxY, item.y + item.height / 2)
  }

  const edges: PositionedMapEdge[] = []
  for (const link of hRoot.links()) {
    const src = nodes[link.source.data.id]!
    const dst = nodes[link.target.data.id]!
    const onFocusPath = src.isOnFocusPath && dst.isOnFocusPath
    // Tapered stroke width inspired by organic tree reference image #2
    const trunkScale = Math.max(1.25, 3.8 - dst.depth * 0.48)
    edges.push({
      id: `${src.id}->${dst.id}`,
      sourceId: src.id,
      targetId: dst.id,
      sourceTheta: src.theta,
      sourceR: src.r,
      targetTheta: dst.theta,
      targetR: dst.r,
      isOnFocusPath: onFocusPath,
      branchRootId: dst.branchRootId,
      strokeWidth: onFocusPath ? trunkScale + 1.2 : trunkScale,
    })
  }

  return {
    nodes,
    orderedIds: visible.orderedIds,
    edges,
    ringRadii: baseRingRadii,
    overlapCount: countOverlappingPairs(placed, 0),
    bounds: { minX, maxX, minY, maxY },
  }
}

export type { HierarchyDatum }

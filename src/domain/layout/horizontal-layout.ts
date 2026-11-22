import { boxesOverlapWithGap, occupiedLayoutNodeBounds } from '@/domain/layout/collision'
import { MAP_ROOT_ID } from '@/domain/layout/compute-visible'
import {
  DEFAULT_HORIZONTAL_LAYOUT_CONFIG,
  mergeHorizontalConfig,
  type HorizontalLayoutConfig,
  type HorizontalLayoutEdge,
  type HorizontalLayoutInput,
  type HorizontalLayoutNode,
  type HorizontalLayoutResult,
} from '@/domain/layout/horizontal-types'
import {
  resolveScreenZoomTier,
  type ScreenTierResolution,
  type SizedNodeSpec,
} from '@/domain/layout/types'
import {
  buildSortedChildrenMap,
  computeNodeBoxSpec,
  computePostOrderIds,
} from '@/domain/layout/weights'

export interface HorizontalGeometryDiagnostics {
  readonly overlapCount: number
}

interface SubtreeBandMetrics {
  readonly spec: SizedNodeSpec
  readonly topExtentPx: number
  readonly visibleDescendants: number
  readonly subtreeWeight: number
  readonly bandHeightPx: number
  readonly parentRelYPx: number
  readonly childrenStartRelYPx: number
}

interface PlacementFrame {
  readonly id: string
  readonly columnIndex: number
  readonly bandTopPx: number
}

function occupiedColumnWidthPx(spec: SizedNodeSpec): number {
  return spec.localLabelBox ? Math.max(spec.width, spec.localLabelBox.width) : spec.width
}

function computeColumnCenters(
  rootId: string,
  childrenMap: ReadonlyMap<string, readonly string[]>,
  metricsById: ReadonlyMap<string, SubtreeBandMetrics>,
  columnGapPx: number,
): number[] {
  const columnWidths: number[] = []
  const queue: Array<{ id: string; col: number }> = [{ id: rootId, col: 0 }]

  for (let head = 0; head < queue.length; head += 1) {
    const { id, col } = queue[head]!
    const width = occupiedColumnWidthPx(metricsById.get(id)!.spec)
    columnWidths[col] = Math.max(columnWidths[col] ?? 0, width)
    const children = childrenMap.get(id)
    if (!children) continue
    for (const childId of children) queue.push({ id: childId, col: col + 1 })
  }

  const centers: number[] = []
  for (let col = 0; col < columnWidths.length; col += 1) {
    if (col === 0) {
      centers.push(0)
      continue
    }
    centers.push(
      centers[col - 1]! + columnWidths[col - 1]! / 2 + columnGapPx + columnWidths[col]! / 2,
    )
  }
  return centers
}

function computeBandMetrics(
  postOrderIds: readonly string[],
  input: HorizontalLayoutInput,
  resolution: ScreenTierResolution,
  config: HorizontalLayoutConfig,
  childrenMap: ReadonlyMap<string, readonly string[]>,
): Map<string, SubtreeBandMetrics> {
  const metricsById = new Map<string, SubtreeBandMetrics>()

  for (const id of postOrderIds) {
    if (input.stats) input.stats.nodesVisited += 1
    const vNode = input.visible.nodes[id]!
    const spec = computeNodeBoxSpec(vNode, resolution, input.measureText, config)
    const topExtentPx = spec.height / 2
    const bottomExtentPx = spec.localLabelBox
      ? Math.max(spec.height / 2, spec.localLabelBox.y + spec.localLabelBox.height)
      : spec.height / 2
    const selfHeightPx = topExtentPx + bottomExtentPx
    const children = childrenMap.get(id) ?? []

    let visibleDescendants = 0
    let childrenSpanPx = 0
    for (const childId of children) {
      const child = metricsById.get(childId)!
      visibleDescendants += 1 + child.visibleDescendants
      childrenSpanPx += child.bandHeightPx
    }
    if (children.length > 1) childrenSpanPx += (children.length - 1) * config.minGapPx

    if (children.length === 0) {
      metricsById.set(id, {
        spec,
        topExtentPx,
        visibleDescendants: 0,
        subtreeWeight: 1,
        bandHeightPx: selfHeightPx,
        parentRelYPx: topExtentPx,
        childrenStartRelYPx: 0,
      })
      continue
    }

    const proportionalHeightPx = selfHeightPx + visibleDescendants * config.descendantSpacingPx
    const extraTopPadPx = Math.max(0, (proportionalHeightPx - childrenSpanPx) / 2)
    const firstChild = metricsById.get(children[0]!)!
    const lastChild = metricsById.get(children[children.length - 1]!)!
    const firstCenterRelY = extraTopPadPx + firstChild.parentRelYPx
    const lastCenterRelY =
      extraTopPadPx + childrenSpanPx - lastChild.bandHeightPx + lastChild.parentRelYPx
    const prelimParentRelY = (firstCenterRelY + lastCenterRelY) / 2
    const shiftChildrenDownPx = Math.max(0, topExtentPx - prelimParentRelY)
    const parentRelYPx = prelimParentRelY + shiftChildrenDownPx
    const childrenStartRelYPx = extraTopPadPx + shiftChildrenDownPx
    const bandHeightPx = Math.max(
      childrenStartRelYPx + childrenSpanPx,
      proportionalHeightPx + shiftChildrenDownPx,
      parentRelYPx + bottomExtentPx,
    )

    metricsById.set(id, {
      spec,
      topExtentPx,
      visibleDescendants,
      subtreeWeight: 1 + visibleDescendants,
      bandHeightPx,
      parentRelYPx,
      childrenStartRelYPx,
    })
  }

  return metricsById
}

/**
 * Computes a deterministic pure left-to-right mind-map layout (`FR-MAP-04`).
 * Columns align tree depths along +X; subtrees occupy disjoint vertical bands
 * proportional to visible descendant count with parents centered on children.
 */
export function computeHorizontalLayout(input: HorizontalLayoutInput): HorizontalLayoutResult {
  const config = mergeHorizontalConfig(input.config)
  const safeScale =
    input.scale === undefined
      ? 1
      : Number.isFinite(input.scale) && input.scale > 0
        ? input.scale
        : 1
  const resolution = resolveScreenZoomTier(safeScale, input.tier, config)
  const rootId = input.visible.nodes[input.visible.rootId] ? input.visible.rootId : MAP_ROOT_ID
  const minEffectiveFontPx = resolution.labelVisible ? resolution.effectiveFontPx : 0

  if (!input.visible.nodes[rootId]) {
    return {
      rootId,
      tier: resolution.tier,
      scale: safeScale,
      nodes: {},
      orderedIds: [],
      edges: [],
      diagnostics: {
        nodeCount: 0,
        edgeCount: 0,
        truncatedCount: 0,
        hiddenLabelCount: 0,
        minEffectiveFontPx,
        columnCount: 0,
      },
    }
  }

  const childrenMap = buildSortedChildrenMap(input.visible)
  const postOrderIds = computePostOrderIds(rootId, childrenMap)
  const metricsById = computeBandMetrics(postOrderIds, input, resolution, config, childrenMap)
  const columnCenters = computeColumnCenters(rootId, childrenMap, metricsById, config.columnGapPx)

  const nodes: Record<string, HorizontalLayoutNode> = {}
  const orderedIds: string[] = []
  const edges: HorizontalLayoutEdge[] = []
  let truncatedCount = 0
  let hiddenLabelCount = 0

  const rootMetrics = metricsById.get(rootId)!
  const stack: PlacementFrame[] = [
    { id: rootId, columnIndex: 0, bandTopPx: -rootMetrics.parentRelYPx },
  ]

  while (stack.length > 0) {
    const frame = stack.pop()!
    if (input.stats) input.stats.nodesVisited += 1
    const vNode = input.visible.nodes[frame.id]!
    const metrics = metricsById.get(frame.id)!
    const { spec } = metrics
    const x = columnCenters[frame.columnIndex]!
    const y = frame.bandTopPx + metrics.parentRelYPx

    if (spec.isTruncated) truncatedCount += 1
    if (!spec.labelVisible) hiddenLabelCount += 1

    const labelBox = spec.localLabelBox
      ? {
          x: x + spec.localLabelBox.x,
          y: y + spec.localLabelBox.y,
          width: spec.localLabelBox.width,
          height: spec.localLabelBox.height,
        }
      : null

    nodes[frame.id] = {
      id: frame.id,
      parentId: vNode.parentId,
      depth: vNode.depth,
      kind: vNode.kind,
      shape: spec.shape,
      tier: resolution.tier,
      displayTitle: spec.displayTitle,
      isTruncated: spec.isTruncated,
      labelVisible: spec.labelVisible,
      modelFontPx: resolution.modelFontPx,
      effectiveFontPx: minEffectiveFontPx,
      x,
      y,
      width: spec.width,
      height: spec.height,
      radius: spec.radius,
      labelBox,
      subtreeWeight: metrics.subtreeWeight,
      columnIndex: frame.columnIndex,
      visibleDescendants: metrics.visibleDescendants,
      bandHeightPx: metrics.bandHeightPx,
    }
    orderedIds.push(frame.id)

    if (vNode.parentId !== null) {
      const parentNode = nodes[vNode.parentId]
      if (parentNode) {
        if (input.stats) input.stats.edgeAnchorsComputed += 1
        const sourceFanCount = childrenMap.get(vNode.parentId)?.length ?? 1
        edges.push({
          id: `${vNode.parentId}->${frame.id}`,
          sourceId: vNode.parentId,
          targetId: frame.id,
          sourceX: parentNode.x + parentNode.width / 2,
          sourceY: parentNode.y,
          targetX: x - spec.width / 2,
          targetY: y,
          sourceFanCount,
          fadeSourceBase: sourceFanCount >= config.wideFanFadeThreshold,
        })
      }
    }

    const children = childrenMap.get(frame.id)
    if (!children || children.length === 0) continue

    const childFrames: PlacementFrame[] = []
    let cursorTopPx = frame.bandTopPx + metrics.childrenStartRelYPx
    for (const childId of children) {
      const childMetrics = metricsById.get(childId)!
      childFrames.push({ id: childId, columnIndex: frame.columnIndex + 1, bandTopPx: cursorTopPx })
      cursorTopPx += childMetrics.bandHeightPx + config.minGapPx
    }
    for (let i = childFrames.length - 1; i >= 0; i -= 1) stack.push(childFrames[i]!)
  }

  return {
    rootId,
    tier: resolution.tier,
    scale: safeScale,
    nodes,
    orderedIds,
    edges,
    diagnostics: {
      nodeCount: orderedIds.length,
      edgeCount: edges.length,
      truncatedCount,
      hiddenLabelCount,
      minEffectiveFontPx,
      columnCount: columnCenters.length,
    },
  }
}

/** Counts pairs whose occupied bounds violate `minGapPx` outside the hot layout path. */
export function computeHorizontalGeometryDiagnostics(
  layout: HorizontalLayoutResult,
  configOverride?: Partial<HorizontalLayoutConfig>,
): HorizontalGeometryDiagnostics {
  const minGapPx = configOverride?.minGapPx ?? DEFAULT_HORIZONTAL_LAYOUT_CONFIG.minGapPx
  const bounds = layout.orderedIds.map((id) => occupiedLayoutNodeBounds(layout.nodes[id]!))

  let overlapCount = 0
  for (let i = 0; i < bounds.length; i += 1) {
    for (let j = i + 1; j < bounds.length; j += 1) {
      if (boxesOverlapWithGap(bounds[i]!, bounds[j]!, minGapPx)) overlapCount += 1
    }
  }

  return { overlapCount }
}

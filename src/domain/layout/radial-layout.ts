import { computeRadialGeometryDiagnostics, resolveCollisionsAndCrossings } from './collision'
import { MAP_ROOT_ID } from './compute-visible'
import { clipRayToNodeEdge } from './edges'
import { assignInitialPolarNodes } from './rings'
import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  formatLayoutFont,
  mergeRadialConfig,
  resolveScreenZoomTier,
  type BoxBounds,
  type CollisionStats,
  type PlacedMutableNode,
  type RadialFontSpec,
  type RadialGeometryDiagnostics,
  type RadialLayoutConfig,
  type RadialLayoutDiagnostics,
  type RadialLayoutEdge,
  type RadialLayoutInput,
  type RadialLayoutNode,
  type RadialLayoutResult,
  type ScreenTierResolution,
  type TextMeasurerFn,
} from './types'
import { prepareSpecsAndWeights } from './weights'

export {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  computeRadialGeometryDiagnostics,
  formatLayoutFont,
  resolveScreenZoomTier,
  type BoxBounds,
  type CollisionStats,
  type RadialFontSpec,
  type RadialGeometryDiagnostics,
  type RadialLayoutConfig,
  type RadialLayoutDiagnostics,
  type RadialLayoutEdge,
  type RadialLayoutInput,
  type RadialLayoutNode,
  type RadialLayoutResult,
  type ScreenTierResolution,
  type TextMeasurerFn,
}

export function finalizeRadialResult(
  rootId: string,
  scale: number,
  resolution: ScreenTierResolution,
  placedPreOrder: readonly string[],
  placed: Map<string, PlacedMutableNode>,
  passesUsed: number,
): RadialLayoutResult {
  const outNodes: Record<string, RadialLayoutNode> = {}
  const edges: RadialLayoutEdge[] = []
  let truncatedCount = 0
  let hiddenLabelCount = 0
  let minEffectiveFontPx = Number.POSITIVE_INFINITY

  for (const id of placedPreOrder) {
    const m = placed.get(id)!
    const lb = m.spec.localLabelBox
      ? {
          x: m.x + m.spec.localLabelBox.x,
          y: m.y + m.spec.localLabelBox.y,
          width: m.spec.localLabelBox.width,
          height: m.spec.localLabelBox.height,
        }
      : null

    if (m.spec.isTruncated) truncatedCount += 1
    if (!m.spec.labelVisible) {
      hiddenLabelCount += 1
    } else if (resolution.effectiveFontPx < minEffectiveFontPx) {
      minEffectiveFontPx = resolution.effectiveFontPx
    }

    outNodes[id] = {
      id: m.id,
      parentId: m.parentId,
      depth: m.depth,
      kind: m.kind,
      shape: m.spec.shape,
      tier: resolution.tier,
      displayTitle: m.spec.displayTitle,
      isTruncated: m.spec.isTruncated,
      labelVisible: m.spec.labelVisible,
      modelFontPx: resolution.modelFontPx,
      effectiveFontPx: resolution.effectiveFontPx,
      x: m.x,
      y: m.y,
      width: m.spec.width,
      height: m.spec.height,
      radius: m.spec.radius,
      labelBox: lb,
      r: m.r,
      theta: m.theta,
      wedgeStart: m.wedgeStart,
      wedgeEnd: m.wedgeEnd,
      staggerRingCount: m.staggerRingCount,
      staggerIndex: m.staggerIndex,
      subtreeWeight: m.subtreeWeight,
    }

    if (m.parentId) {
      const parent = placed.get(m.parentId)
      if (parent) {
        const sAnchor = clipRayToNodeEdge(
          parent.x,
          parent.y,
          parent.spec,
          m.x - parent.x,
          m.y - parent.y,
        )
        const tAnchor = clipRayToNodeEdge(m.x, m.y, m.spec, parent.x - m.x, parent.y - m.y)
        edges.push({
          id: `${parent.id}->${m.id}`,
          sourceId: parent.id,
          targetId: m.id,
          sourceX: sAnchor.x,
          sourceY: sAnchor.y,
          targetX: tAnchor.x,
          targetY: tAnchor.y,
        })
      }
    }
  }

  return {
    rootId,
    tier: resolution.tier,
    scale,
    nodes: outNodes,
    orderedIds: placedPreOrder,
    edges,
    diagnostics: {
      nodeCount: placedPreOrder.length,
      edgeCount: edges.length,
      truncatedCount,
      hiddenLabelCount,
      minEffectiveFontPx: Number.isFinite(minEffectiveFontPx) ? minEffectiveFontPx : 0,
      collisionPassesUsed: passesUsed,
    },
  }
}

/** Computes a pure deterministic radial tree layout for visible map nodes. */
export function computeRadialLayout(input: RadialLayoutInput): RadialLayoutResult {
  const config = mergeRadialConfig(input.config)
  const scale =
    input.scale !== undefined && Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1
  const resolution = resolveScreenZoomTier(scale, input.tier, config)
  const rootId = input.visible.nodes[input.visible.rootId] ? input.visible.rootId : MAP_ROOT_ID

  if (!input.visible.nodes[rootId]) {
    return {
      rootId,
      tier: resolution.tier,
      scale,
      nodes: {},
      orderedIds: [],
      edges: [],
      diagnostics: {
        nodeCount: 0,
        edgeCount: 0,
        truncatedCount: 0,
        hiddenLabelCount: 0,
        minEffectiveFontPx: 0,
        collisionPassesUsed: 0,
      },
    }
  }

  const prepared = prepareSpecsAndWeights(
    rootId,
    input.visible,
    resolution,
    input.measureText,
    config,
  )
  const { placed, placedPreOrder } = assignInitialPolarNodes(
    rootId,
    input.visible,
    prepared,
    config,
  )
  const passesUsed = resolveCollisionsAndCrossings(
    rootId,
    placedPreOrder,
    prepared.childrenMap,
    placed,
    config,
    input.stats,
  )
  return finalizeRadialResult(rootId, scale, resolution, placedPreOrder, placed, passesUsed)
}

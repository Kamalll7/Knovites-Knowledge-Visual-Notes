import { boxesOverlapWithGap, occupiedBounds } from '../collision'
import { MAP_ROOT_ID } from '../compute-visible'
import { clipRayToNodeEdge, segmentIntersectsBox } from '../edges'
import { finalizeRadialResult } from '../radial-layout'
import { assignInitialPolarNodes, pushSubtreeOutward } from '../rings'
import {
  mergeRadialConfig,
  resolveScreenZoomTier,
  type PlacedMutableNode,
  type RadialLayoutConfig,
  type RadialLayoutInput,
  type RadialLayoutResult,
} from '../types'
import { prepareSpecsAndWeights } from '../weights'

/**
 * Frozen O(n^2) pre-optimization reference collision resolver captured from T3.2b (`4e656e6`).
 * Strictly test-only (`src/domain/layout/__reference__/`) for differential verification.
 */
export function resolveCollisionsAndCrossingsReference(
  rootId: string,
  placedPreOrder: readonly string[],
  childrenMap: Map<string, string[]>,
  placed: Map<string, PlacedMutableNode>,
  config: RadialLayoutConfig,
): number {
  let passesUsed = 0
  for (let pass = 0; pass < config.maxCollisionPasses; pass += 1) {
    let adjusted = false

    for (let i = 0; i < placedPreOrder.length; i += 1) {
      const a = placed.get(placedPreOrder[i]!)!
      const boxA = occupiedBounds(a)
      for (let j = i + 1; j < placedPreOrder.length; j += 1) {
        const b = placed.get(placedPreOrder[j]!)!
        if (b.id === rootId) continue
        const boxB = occupiedBounds(b)
        if (!boxesOverlapWithGap(boxA, boxB, config.minGapPx)) continue

        if (a.parentId !== null && a.parentId === b.parentId) {
          for (const sibId of childrenMap.get(a.parentId) ?? []) {
            pushSubtreeOutward(sibId, config.staggerRadialStepPx, childrenMap, placed)
          }
          adjusted = true
          break
        }

        const pushTarget = b.r >= a.r ? b : a
        const stationary = pushTarget === b ? a : b
        const sBox = stationary === a ? boxA : boxB
        const pBox = pushTarget === b ? boxB : boxA
        const radialClearanceNeeded = Math.min(
          Math.max(
            0,
            (sBox.width + pBox.width) / 2 + config.minGapPx - Math.abs(stationary.x - pushTarget.x),
          ),
          Math.max(
            0,
            (sBox.height + pBox.height) / 2 +
              config.minGapPx -
              Math.abs(stationary.y - pushTarget.y),
          ),
        )
        const deltaR = Math.max(config.minGapPx, Math.ceil(radialClearanceNeeded) + config.minGapPx)
        pushSubtreeOutward(pushTarget.id, deltaR, childrenMap, placed)
        adjusted = true
      }
      if (adjusted) break
    }

    for (const childId of placedPreOrder) {
      const child = placed.get(childId)!
      if (!child.parentId) continue
      const parent = placed.get(child.parentId)
      if (!parent) continue
      const pAnchor = clipRayToNodeEdge(
        parent.x,
        parent.y,
        parent.spec,
        child.x - parent.x,
        child.y - parent.y,
      )
      const cAnchor = clipRayToNodeEdge(
        child.x,
        child.y,
        child.spec,
        parent.x - child.x,
        parent.y - child.y,
      )

      for (const otherId of placedPreOrder) {
        if (otherId === child.id || otherId === parent.id) continue
        const other = placed.get(otherId)!
        if (
          !segmentIntersectsBox(pAnchor.x, pAnchor.y, cAnchor.x, cAnchor.y, occupiedBounds(other))
        ) {
          continue
        }
        if (other.depth < parent.depth && parent.id !== rootId) {
          pushSubtreeOutward(parent.id, config.staggerRadialStepPx, childrenMap, placed)
        } else if (other.parentId === child.parentId) {
          for (const sibId of childrenMap.get(other.parentId!) ?? []) {
            pushSubtreeOutward(sibId, config.staggerRadialStepPx, childrenMap, placed)
          }
        } else if (other.id !== rootId && other.depth >= child.depth) {
          const jump = Math.max(
            config.staggerRadialStepPx,
            Math.ceil(child.r - other.r) + config.staggerRadialStepPx,
          )
          pushSubtreeOutward(other.id, jump, childrenMap, placed)
        } else {
          pushSubtreeOutward(child.id, config.staggerRadialStepPx, childrenMap, placed)
        }
        adjusted = true
        break
      }
    }

    passesUsed = pass + 1
    if (!adjusted) break
  }
  return passesUsed
}

/** Runs the frozen reference radial layout end-to-end for byte-exact differential testing. */
export function computeRadialLayoutReference(input: RadialLayoutInput): RadialLayoutResult {
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
  const passesUsed = resolveCollisionsAndCrossingsReference(
    rootId,
    placedPreOrder,
    prepared.childrenMap,
    placed,
    config,
  )
  return finalizeRadialResult(rootId, scale, resolution, placedPreOrder, placed, passesUsed)
}

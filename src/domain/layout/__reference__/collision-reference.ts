import { exactUniformSiblingClearDeltaR, occupiedBounds } from '../collision'
import { MAP_ROOT_ID } from '../compute-visible'
import { clipRayToNodeEdge, segmentIntersectsBox } from '../edges'
import { finalizeRadialResult } from '../radial-layout'
import { assignInitialPolarNodes, updateCartesian } from '../rings'
import {
  mergeRadialConfig,
  resolveScreenZoomTier,
  type PlacedMutableNode,
  type RadialLayoutConfig,
  type RadialLayoutInput,
  type RadialLayoutResult,
} from '../types'
import { prepareSpecsAndWeights } from '../weights'

function occupiedExtents(n: PlacedMutableNode): { x0: number; y0: number; x1: number; y1: number } {
  const hw = n.spec.width / 2
  const hh = n.spec.height / 2
  const lb = n.spec.localLabelBox
  return {
    x0: lb ? Math.min(n.x - hw, n.x + lb.x) : n.x - hw,
    x1: lb ? Math.max(n.x + hw, n.x + lb.x + lb.width) : n.x + hw,
    y0: lb ? Math.min(n.y - hh, n.y + lb.y) : n.y - hh,
    y1: lb ? Math.max(n.y + hh, n.y + lb.y + lb.height) : n.y + hh,
  }
}

/**
 * Unoptimized O(n^2) reference collision resolver (updated for T3.2f Opsi B: multi-parent parallel
 * overlap resolution + analytical sibling jump).
 * Strictly test-only (`src/domain/layout/__reference__/`) for differential verification against the
 * spatial-grid + dirty-rect solver in `collision.ts`.
 */
export function resolveCollisionsAndCrossingsReference(
  rootId: string,
  placedPreOrder: readonly string[],
  childrenMap: Map<string, string[]>,
  placed: Map<string, PlacedMutableNode>,
  config: RadialLayoutConfig,
): number {
  const n = placedPreOrder.length
  const idToIdx = new Map<string, number>()
  const nodes: PlacedMutableNode[] = new Array(n)
  for (let i = 0; i < n; i += 1) {
    const id = placedPreOrder[i]!
    idToIdx.set(id, i)
    nodes[i] = placed.get(id)!
  }

  const childrenIndices: number[][] = new Array(n)
  const parentIndex = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i += 1) {
    const cIdx: number[] = []
    for (const cid of childrenMap.get(nodes[i]!.id) ?? []) {
      const idx = idToIdx.get(cid)
      if (idx !== undefined) {
        cIdx.push(idx)
        parentIndex[idx] = i
      }
    }
    childrenIndices[i] = cIdx
  }

  const nodeLastMoved = new Int32Array(n).fill(-2)
  const parentPushedPass = new Int32Array(n).fill(-2)

  const pushSubtreeTracked = (rootSubIdx: number, deltaR: number, passNum: number): void => {
    const stack: number[] = [rootSubIdx]
    while (stack.length > 0) {
      const idx = stack.pop()!
      const node = nodes[idx]!
      nodeLastMoved[idx] = passNum
      node.r += deltaR
      updateCartesian(node)
      for (const childIdx of childrenIndices[idx]!) stack.push(childIdx)
    }
  }

  let passesUsed = 0
  for (let pass = 0; pass < config.maxCollisionPasses; pass += 1) {
    let adjusted = false

    for (let i = 0; i < n; i += 1) {
      if (nodeLastMoved[i] === pass) continue
      const a = nodes[i]!
      const extA = occupiedExtents(a)
      for (let j = i + 1; j < n; j += 1) {
        const b = nodes[j]!
        if (b.id === rootId || nodeLastMoved[j] === pass) continue
        const extB = occupiedExtents(b)
        if (
          extA.x1 + config.minGapPx <= extB.x0 ||
          extB.x1 + config.minGapPx <= extA.x0 ||
          extA.y1 + config.minGapPx <= extB.y0 ||
          extB.y1 + config.minGapPx <= extA.y0
        ) {
          continue
        }

        if (a.parentId !== null && a.parentId === b.parentId) {
          const pIdx = parentIndex[i]!
          if (pIdx >= 0 && parentPushedPass[pIdx] !== pass) {
            const dR = exactUniformSiblingClearDeltaR(
              a.theta,
              (extA.x0 + extA.x1) * 0.5,
              (extA.y0 + extA.y1) * 0.5,
              extA.x1 - extA.x0,
              extA.y1 - extA.y0,
              b.theta,
              (extB.x0 + extB.x1) * 0.5,
              (extB.y0 + extB.y1) * 0.5,
              extB.x1 - extB.x0,
              extB.y1 - extB.y0,
              config.minGapPx,
              config.staggerRadialStepPx,
            )
            parentPushedPass[pIdx] = pass
            for (const sibIdx of childrenIndices[pIdx]!) {
              pushSubtreeTracked(sibIdx, dR, pass)
            }
            adjusted = true
          }
          break
        }

        const pushIsB = b.r >= a.r
        const pushTarget = pushIsB ? b : a
        const stationary = pushIsB ? a : b
        const rx = Math.max(
          0,
          (extA.x1 - extA.x0 + extB.x1 - extB.x0) / 2 +
            config.minGapPx -
            Math.abs(stationary.x - pushTarget.x),
        )
        const ry = Math.max(
          0,
          (extA.y1 - extA.y0 + extB.y1 - extB.y0) / 2 +
            config.minGapPx -
            Math.abs(stationary.y - pushTarget.y),
        )
        const deltaR = Math.max(config.minGapPx, Math.ceil(Math.min(rx, ry)) + config.minGapPx)
        pushSubtreeTracked(pushIsB ? j : i, deltaR, pass)
        adjusted = true
        if (!pushIsB) break
      }
    }

    for (let cIdx = 0; cIdx < n; cIdx += 1) {
      const pIdx = parentIndex[cIdx]!
      if (pIdx < 0) continue
      const child = nodes[cIdx]!
      const parent = nodes[pIdx]!
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

      for (let otherIdx = 0; otherIdx < n; otherIdx += 1) {
        if (otherIdx === cIdx || otherIdx === pIdx) continue
        const other = nodes[otherIdx]!
        if (
          !segmentIntersectsBox(pAnchor.x, pAnchor.y, cAnchor.x, cAnchor.y, occupiedBounds(other))
        ) {
          continue
        }
        if (other.depth < parent.depth && parent.id !== rootId) {
          pushSubtreeTracked(pIdx, config.staggerRadialStepPx, pass)
        } else if (other.parentId === child.parentId) {
          for (const sibIdx of childrenIndices[pIdx]!) {
            pushSubtreeTracked(sibIdx, config.staggerRadialStepPx, pass)
          }
        } else if (other.id !== rootId && other.depth >= child.depth) {
          const jump = Math.max(
            config.staggerRadialStepPx,
            Math.ceil(child.r - other.r) + config.staggerRadialStepPx,
          )
          pushSubtreeTracked(otherIdx, jump, pass)
        } else {
          pushSubtreeTracked(cIdx, config.staggerRadialStepPx, pass)
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

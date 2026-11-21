import { clipRayToNodeEdge, segmentIntersectsBox } from './edges'
import { pushSubtreeOutward } from './rings'
import type { BoxBounds, PlacedMutableNode, RadialLayoutConfig } from './types'

/** Returns the outer axis-aligned bounding box including any visible external tier-0 label. */
export function occupiedBounds(n: PlacedMutableNode): BoxBounds {
  const minX = n.x - n.spec.width / 2
  const maxX = n.x + n.spec.width / 2
  const minY = n.y - n.spec.height / 2
  const maxY = n.y + n.spec.height / 2
  const lb = n.spec.localLabelBox
  if (!lb) {
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }
  const uMinX = Math.min(minX, n.x + lb.x)
  const uMaxX = Math.max(maxX, n.x + lb.x + lb.width)
  const uMinY = Math.min(minY, n.y + lb.y)
  const uMaxY = Math.max(maxY, n.y + lb.y + lb.height)
  return { x: uMinX, y: uMinY, width: uMaxX - uMinX, height: uMaxY - uMinY }
}

/** Checks whether two bounding boxes violate the minimum gap clearance `minGapPx`. */
export function boxesOverlapWithGap(a: BoxBounds, b: BoxBounds, minGapPx: number): boolean {
  const halfGap = minGapPx / 2
  return !(
    a.x + a.width + halfGap <= b.x - halfGap ||
    b.x + b.width + halfGap <= a.x - halfGap ||
    a.y + a.height + halfGap <= b.y - halfGap ||
    b.y + b.height + halfGap <= a.y - halfGap
  )
}

/** Iteratively pushes overlapping subtrees and crossing-blocking nodes outward radially. */
export function resolveCollisionsAndCrossings(
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
          // Siblings in one concentric fan: expand the whole sibling ring together
          // so tangential arc widens without stranding one sibling behind another.
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

    // Ensure every parent->child segment clears unrelated node boxes.
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
          // Secant chord dipped back onto an inner ancestor ring: lift parent & subtree outward.
          pushSubtreeOutward(parent.id, config.staggerRadialStepPx, childrenMap, placed)
        } else if (other.parentId === child.parentId) {
          // Expand sibling fan ring uniformly so tangential arc clears intermediate siblings.
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

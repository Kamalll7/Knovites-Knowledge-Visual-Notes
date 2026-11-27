import { canMutateTreeNode } from '@/app/store'
import { OVERFLOW_NODE_PREFIX, type MapLayoutNode, type MapLayoutResult } from '@/domain/layout'
import { isVirtualRootId, type TreeState } from '@/domain/tree'
import type { CameraTransform } from '@/features/map/map-camera'
import { canMoveNodeToTarget, type MoveTargetBlockReason } from '@/features/map/move-target-picker'

/** Minimum pointer travel distance (screen px) before a click becomes a drag reparent (`FR-MAP-15`). */
export const DRAG_REPARENT_THRESHOLD_PX = 7

/** Extra hit-test padding around rendered nodes in world coordinates for comfortable drop targeting. */
const DROP_TARGET_HIT_PAD_PX = 6

export type DragDropEvaluation =
  | { readonly status: 'none'; readonly targetId: null }
  | { readonly status: 'valid'; readonly targetId: string; readonly newParentId: string | null }
  | {
      readonly status: 'invalid'
      readonly targetId: string
      readonly reason: MoveTargetBlockReason
    }

/**
 * Determines whether a map node is eligible to start drag-and-drop reparenting (`FR-MAP-15`).
 * Reuses `canMutateTreeNode` so virtual root `'__root__'`, `+N` bubbles, read-only tabs, and
 * corrupt/newer-schema nodes can never be dragged.
 */
export function canStartNodeDrag(tree: TreeState, nodeId: string, writeDisabled: boolean): boolean {
  if (writeDisabled) return false
  if (nodeId.startsWith(OVERFLOW_NODE_PREFIX)) return false
  if (!canMutateTreeNode(nodeId)) return false
  const node = tree.nodes[nodeId]
  if (!node || node.corrupt || node.newerSchemaVersion !== undefined) return false
  return true
}

/**
 * Evaluates dropping `draggedNodeId` onto `targetNodeId` (`FR-MAP-15`) strictly via
 * `canMoveNodeToTarget` from `move-target-picker.ts` (zero duplicated cycle/root rules).
 */
export function evaluateDragDropTarget(
  tree: TreeState,
  draggedNodeId: string,
  targetNodeId: string | null,
): DragDropEvaluation {
  if (targetNodeId === null || targetNodeId.startsWith(OVERFLOW_NODE_PREFIX)) {
    return { status: 'none', targetId: null }
  }
  const check = canMoveNodeToTarget(tree, draggedNodeId, targetNodeId)
  if (check.allowed) {
    return {
      status: 'valid',
      targetId: targetNodeId,
      newParentId: isVirtualRootId(targetNodeId) ? null : targetNodeId,
    }
  }
  return {
    status: 'invalid',
    targetId: targetNodeId,
    reason: check.reason ?? 'readonly_target',
  }
}

/** Converts viewport client coordinates into SVG camera world coordinates. */
export function screenPointToWorldPoint(
  clientX: number,
  clientY: number,
  svgRect: { readonly left: number; readonly top: number },
  camera: CameraTransform,
): { readonly x: number; readonly y: number } {
  const safeK = Number.isFinite(camera.k) && camera.k > 0 ? camera.k : 1
  return {
    x: (clientX - svgRect.left - camera.x) / safeK,
    y: (clientY - svgRect.top - camera.y) / safeK,
  }
}

function isWorldPointInsideNode(worldX: number, worldY: number, node: MapLayoutNode): boolean {
  if (node.shape === 'circle') {
    const r = (node.radius ?? node.width / 2) + DROP_TARGET_HIT_PAD_PX
    const dx = worldX - node.x
    const dy = worldY - node.y
    return dx * dx + dy * dy <= r * r
  }
  const halfW = node.width / 2 + DROP_TARGET_HIT_PAD_PX
  const halfH = node.height / 2 + DROP_TARGET_HIT_PAD_PX
  return Math.abs(worldX - node.x) <= halfW && Math.abs(worldY - node.y) <= halfH
}

/**
 * Hit-tests rendered map nodes at `(worldX, worldY)` in reverse paint order, skipping `+N`
 * overflow bubbles and prioritizing non-self targets over `draggedNodeId`.
 */
export function findDropTargetAtWorldPoint(
  worldX: number,
  worldY: number,
  layout: MapLayoutResult,
  draggedNodeId: string,
): string | null {
  let selfHit = false
  for (let i = layout.orderedIds.length - 1; i >= 0; i -= 1) {
    const id = layout.orderedIds[i]!
    const node = layout.nodes[id]
    if (!node || node.kind === 'overflow') continue
    if (!isWorldPointInsideNode(worldX, worldY, node)) continue
    if (id === draggedNodeId) {
      selfHit = true
      continue
    }
    return id
  }
  return selfHit ? draggedNodeId : null
}

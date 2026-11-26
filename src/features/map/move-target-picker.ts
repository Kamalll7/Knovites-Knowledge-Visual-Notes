import { VIRTUAL_ROOT_ID, isVirtualRootId, type TreeState } from '@/domain/tree'

export type MoveTargetBlockReason =
  'self' | 'descendant' | 'same_parent' | 'readonly_target' | 'virtual_root'

export interface MoveTargetOption {
  readonly id: string
  readonly parentId: string | null
  readonly title: string
  readonly depth: number
  readonly pathLabel: string
  readonly disabled: boolean
  readonly disabledReason?: MoveTargetBlockReason
}

/** Collects the node and all of its descendants in DFS order (`FR-NODE-04`, `FR-NODE-05`). */
export function collectSubtreeIdSet(tree: TreeState, rootId: string): ReadonlySet<string> {
  const result = new Set<string>()
  if (isVirtualRootId(rootId) || !tree.nodes[rootId]) return result
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = tree.nodes[id]
    if (!node || result.has(id)) continue
    result.add(id)
    for (let i = node.childrenIds.length - 1; i >= 0; i -= 1) {
      stack.push(node.childrenIds[i]!)
    }
  }
  return result
}

/** Counts strict descendants (excluding the node itself) for Delete/Move previews (`FR-NODE-05`). */
export function countDescendants(tree: TreeState, nodeId: string): number {
  const subtree = collectSubtreeIdSet(tree, nodeId)
  return subtree.size > 0 ? subtree.size - 1 : 0
}

/**
 * Checks whether moving `nodeId` under `targetParentId` (`null` or `'__root__'` = Home root)
 * is permitted without forming a cycle or violating read-only guards (`FR-NODE-04`).
 */
export function canMoveNodeToTarget(
  tree: TreeState,
  nodeId: string,
  targetParentId: string | null,
): { readonly allowed: boolean; readonly reason?: MoveTargetBlockReason } {
  if (isVirtualRootId(nodeId)) {
    return { allowed: false, reason: 'virtual_root' }
  }
  const source = tree.nodes[nodeId]
  if (!source) {
    return { allowed: false, reason: 'readonly_target' }
  }

  const normalizedTarget =
    targetParentId === null || isVirtualRootId(targetParentId) ? null : targetParentId

  if (normalizedTarget === nodeId) {
    return { allowed: false, reason: 'self' }
  }

  if (normalizedTarget !== null) {
    const subtreeIds = collectSubtreeIdSet(tree, nodeId)
    if (subtreeIds.has(normalizedTarget)) {
      return { allowed: false, reason: 'descendant' }
    }
    const dest = tree.nodes[normalizedTarget]
    if (!dest || dest.corrupt || dest.newerSchemaVersion !== undefined) {
      return { allowed: false, reason: 'readonly_target' }
    }
  }

  if (source.parentId === normalizedTarget) {
    return { allowed: false, reason: 'same_parent' }
  }

  return { allowed: true }
}

/**
 * Builds the flat indented hierarchical list of potential move targets (Home root + DFS nodes),
 * marking self, descendants, current parent, and corrupt targets as disabled (`FR-NODE-04`).
 */
export function buildMoveTargetOptions(
  tree: TreeState,
  nodeId: string,
  query = '',
  rootTitle = 'Home',
): readonly MoveTargetOption[] {
  const options: MoveTargetOption[] = []

  const rootCheck = canMoveNodeToTarget(tree, nodeId, null)
  options.push({
    id: VIRTUAL_ROOT_ID,
    parentId: null,
    title: rootTitle,
    depth: 0,
    pathLabel: rootTitle,
    disabled: !rootCheck.allowed,
    ...(rootCheck.reason ? { disabledReason: rootCheck.reason } : {}),
  })

  const visit = (id: string, depth: number, parentTrail: string) => {
    const node = tree.nodes[id]
    if (!node) return
    const title = node.meta.title || node.slug || node.id
    const pathLabel = `${parentTrail} / ${title}`
    const check = canMoveNodeToTarget(tree, nodeId, id)
    options.push({
      id,
      parentId: id,
      title,
      depth,
      pathLabel,
      disabled: !check.allowed,
      ...(check.reason ? { disabledReason: check.reason } : {}),
    })
    for (const childId of node.childrenIds) {
      visit(childId, depth + 1, pathLabel)
    }
  }

  for (const rootChildId of tree.rootIds) {
    visit(rootChildId, 1, rootTitle)
  }

  const trimmed = query.trim().toLowerCase()
  if (trimmed.length === 0) return options

  return options.filter(
    (opt) =>
      opt.title.toLowerCase().includes(trimmed) || opt.pathLabel.toLowerCase().includes(trimmed),
  )
}

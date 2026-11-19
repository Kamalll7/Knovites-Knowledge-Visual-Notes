import type { NodeStatus, NodeType } from '@/domain/schema'
import type { TreeNode, TreeState } from '@/domain/tree'

export const VIRTUAL_ROOT_ID = '__virtual_root__'
export const MAX_CHILDREN_SHOWN = 24
export const MAX_GRANDCHILDREN_PER_CHILD = 6
export const MAX_VISIBLE_NODES = 300

export type ZoomTier = 0 | 1 | 2

export interface VisibleMapNode {
  id: string
  parentId: string | null
  kind: 'root' | 'node' | 'overflow'
  /** For `'overflow'` bubble nodes, the ID of the parent whose overflowed children it represents. */
  overflowParentId?: string
  overflowCount?: number
  title: string
  type: NodeType | 'root' | 'overflow'
  status: NodeStatus
  tags: string[]
  order: string
  color: string | null
  depth: number
  /** Index of the depth-1 ancestor (0..based deterministic branch id source). */
  branchRootId: string | null
  /** True if the node sits on the active Root -> Focus path. */
  isOnFocusPath: boolean
  isFocus: boolean
  isGrandchildPreview: boolean
  /** True if the node has unexpanded descendants (badge `'Title · N'`). */
  isCollapsedWithChildren: boolean
  totalDescendants: number
  visibleDescendants: number
  hiddenCount: number
  visibleChildIds: string[]
}

export interface ComputeVisibleInput {
  tree: TreeState
  rootTitle: string
  focusId: string
  pinnedIds?: ReadonlySet<string>
  expandedOverflowParentIds?: ReadonlySet<string>
  zoomTier: ZoomTier
}

export interface ComputeVisibleResult {
  rootId: string
  focusId: string
  nodes: Record<string, VisibleMapNode>
  orderedIds: string[]
  focusPathIds: Set<string>
  totalSubtreeCounts: Record<string, number>
}

export function overflowBubbleId(parentId: string): string {
  return `__overflow__:${parentId}`
}

function getAllChildrenIds(tree: TreeState, parentId: string): readonly string[] {
  if (parentId === VIRTUAL_ROOT_ID) {
    return tree.rootIds
  }
  return tree.nodes[parentId]?.childrenIds ?? []
}

/**
 * Pure visibility selection following `spec-map.md` §6.2 FR-MAP-02:
 * - Root, all ancestors of `focusId`, and `focusId` are always visible.
 * - Up to `MAX_CHILDREN_SHOWN = 24` children per expanded parent unless `+N` is expanded.
 * - Siblings of focus and each ancestor appear collapsed with total descendant count badge.
 * - Focus grandchildren appear only at `zoomTier >= 2` within the ~300-node render budget.
 */
export function computeVisible(input: ComputeVisibleInput): ComputeVisibleResult {
  const { tree, rootTitle, zoomTier } = input
  const pinnedIds = input.pinnedIds ?? new Set<string>()
  const expandedOverflow = input.expandedOverflowParentIds ?? new Set<string>()

  const resolvedFocusId =
    input.focusId === VIRTUAL_ROOT_ID || tree.nodes[input.focusId] ? input.focusId : VIRTUAL_ROOT_ID

  // 1. Precompute full-tree descendant counts bottom-up iteratively
  const totalSubtreeCounts: Record<string, number> = {}
  const postOrder: string[] = []
  const stack: Array<{ id: string; visited: boolean }> = tree.rootIds.map((id) => ({
    id,
    visited: false,
  }))

  while (stack.length > 0) {
    const top = stack.pop()!
    const node = tree.nodes[top.id]
    if (!node) continue
    if (top.visited) {
      postOrder.push(top.id)
    } else {
      stack.push({ id: top.id, visited: true })
      for (const childId of node.childrenIds) {
        stack.push({ id: childId, visited: false })
      }
    }
  }

  for (const id of postOrder) {
    const node = tree.nodes[id]
    if (!node) continue
    let count = 0
    for (const childId of node.childrenIds) {
      count += 1 + (totalSubtreeCounts[childId] ?? 0)
    }
    totalSubtreeCounts[id] = count
  }

  let rootTotalDescendants = 0
  for (const rootChildId of tree.rootIds) {
    rootTotalDescendants += 1 + (totalSubtreeCounts[rootChildId] ?? 0)
  }
  totalSubtreeCounts[VIRTUAL_ROOT_ID] = rootTotalDescendants

  // 2. Build focus ancestor path (Root -> ... -> Focus)
  const focusPathList: string[] = []
  if (resolvedFocusId !== VIRTUAL_ROOT_ID) {
    let cursor: string | null = resolvedFocusId
    while (cursor !== null) {
      const node: TreeNode | undefined = tree.nodes[cursor]
      if (!node) break
      focusPathList.push(cursor)
      cursor = node.parentId
    }
  }
  focusPathList.push(VIRTUAL_ROOT_ID)
  focusPathList.reverse()
  const focusPathSet = new Set(focusPathList)

  const depthMap = new Map<string, number>([[VIRTUAL_ROOT_ID, 0]])
  const branchRootMap = new Map<string, string | null>([[VIRTUAL_ROOT_ID, null]])

  // Determine parent expansion rules
  const childrenShownForParent = new Map<string, string[]>()
  const overflowCountForParent = new Map<string, number>()

  const visibleParentIds = new Set<string>(focusPathList)
  for (const pinnedId of pinnedIds) {
    if (pinnedId === VIRTUAL_ROOT_ID || tree.nodes[pinnedId]) {
      visibleParentIds.add(pinnedId)
    }
  }

  // Track which real node IDs have been admitted within the ~300-node budget
  const admittedIds = new Set<string>([VIRTUAL_ROOT_ID])
  for (const ancestorId of focusPathList) {
    admittedIds.add(ancestorId)
  }

  // First pass: admit children along the focus path and pinned nodes
  const expandParentChildren = (parentId: string, maxLimit: number): string[] => {
    const allChildren = getAllChildrenIds(tree, parentId)
    if (allChildren.length === 0) return []

    const showAll = expandedOverflow.has(parentId)
    const limit = showAll ? allChildren.length : maxLimit

    // Ensure the child on the active focus path is always included even if beyond index 24
    const focusChildOnPath = allChildren.find((cid) => focusPathSet.has(cid))
    const selected: string[] = []

    for (const cid of allChildren) {
      if (selected.length >= limit) break
      selected.push(cid)
    }
    if (focusChildOnPath && !selected.includes(focusChildOnPath)) {
      if (selected.length > 0) {
        selected[selected.length - 1] = focusChildOnPath
      } else {
        selected.push(focusChildOnPath)
      }
    }

    const admittedForParent: string[] = []
    for (const cid of selected) {
      if (admittedIds.size >= MAX_VISIBLE_NODES && !admittedIds.has(cid)) continue
      admittedIds.add(cid)
      admittedForParent.push(cid)
    }

    const remaining = allChildren.length - admittedForParent.length
    childrenShownForParent.set(parentId, admittedForParent)
    if (remaining > 0) {
      overflowCountForParent.set(parentId, remaining)
    }
    return admittedForParent
  }

  for (const parentId of focusPathList) {
    expandParentChildren(parentId, MAX_CHILDREN_SHOWN)
  }
  for (const pinnedId of pinnedIds) {
    if (!focusPathSet.has(pinnedId)) {
      expandParentChildren(pinnedId, MAX_CHILDREN_SHOWN)
    }
  }

  // Grandchildren of focus visible at zoomTier >= 2 (rule 4)
  const grandchildIds = new Set<string>()
  if (zoomTier >= 2) {
    const focusChildren = childrenShownForParent.get(resolvedFocusId) ?? []
    for (const fcId of focusChildren) {
      if (admittedIds.size >= MAX_VISIBLE_NODES) break
      const allGrand = getAllChildrenIds(tree, fcId)
      if (allGrand.length === 0 || childrenShownForParent.has(fcId)) continue
      const slice = expandedOverflow.has(fcId)
        ? allGrand
        : allGrand.slice(0, MAX_GRANDCHILDREN_PER_CHILD)
      const admittedGrand: string[] = []
      for (const gid of slice) {
        if (admittedIds.size >= MAX_VISIBLE_NODES) break
        admittedIds.add(gid)
        admittedGrand.push(gid)
        grandchildIds.add(gid)
      }
      if (admittedGrand.length > 0) {
        childrenShownForParent.set(fcId, admittedGrand)
        const hiddenGrand = allGrand.length - admittedGrand.length
        if (hiddenGrand > 0 && allGrand.length > MAX_GRANDCHILDREN_PER_CHILD) {
          overflowCountForParent.set(fcId, hiddenGrand)
        }
      }
    }
  }

  // Assign depth & branchRootId top-down across admitted visible tree
  const queue: string[] = [VIRTUAL_ROOT_ID]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    const currentDepth = depthMap.get(currentId) ?? 0
    const currentBranchRoot = branchRootMap.get(currentId) ?? null
    const children = childrenShownForParent.get(currentId) ?? []
    for (const cid of children) {
      depthMap.set(cid, currentDepth + 1)
      branchRootMap.set(cid, currentDepth === 0 ? cid : currentBranchRoot)
      queue.push(cid)
    }
  }

  // Build VisibleMapNode entries + visibleDescendants post-order
  const nodes: Record<string, VisibleMapNode> = {}
  const orderedIds: string[] = []

  const collectDfs = (nodeId: string, parentId: string | null) => {
    orderedIds.push(nodeId)
    const childIds = [...(childrenShownForParent.get(nodeId) ?? [])]
    const overflowCount = overflowCountForParent.get(nodeId) ?? 0
    const childOverflowId = overflowCount > 0 ? overflowBubbleId(nodeId) : null

    if (childOverflowId) {
      childIds.push(childOverflowId)
    }

    const realChildrenOnly = childrenShownForParent.get(nodeId) ?? []
    for (const cid of realChildrenOnly) {
      collectDfs(cid, nodeId)
    }

    if (childOverflowId && overflowCount > 0) {
      const parentDepth = depthMap.get(nodeId) ?? 0
      const branchId = parentDepth === 0 ? childOverflowId : (branchRootMap.get(nodeId) ?? null)
      orderedIds.push(childOverflowId)
      nodes[childOverflowId] = {
        id: childOverflowId,
        parentId: nodeId,
        kind: 'overflow',
        overflowParentId: nodeId,
        overflowCount,
        title: `+${overflowCount}`,
        type: 'overflow',
        status: 'none',
        tags: [],
        order: '~overflow',
        color: null,
        depth: parentDepth + 1,
        branchRootId: branchId,
        isOnFocusPath: false,
        isFocus: false,
        isGrandchildPreview: false,
        isCollapsedWithChildren: false,
        totalDescendants: 0,
        visibleDescendants: 0,
        hiddenCount: 0,
        visibleChildIds: [],
      }
    }

    let visibleDescendants = 0
    for (const cid of realChildrenOnly) {
      visibleDescendants += 1 + (nodes[cid]?.visibleDescendants ?? 0)
    }

    const totalDescendants = totalSubtreeCounts[nodeId] ?? 0
    const hiddenCount = Math.max(0, totalDescendants - visibleDescendants)

    if (nodeId === VIRTUAL_ROOT_ID) {
      nodes[nodeId] = {
        id: VIRTUAL_ROOT_ID,
        parentId: null,
        kind: 'root',
        title: rootTitle,
        type: 'root',
        status: 'none',
        tags: [],
        order: '',
        color: null,
        depth: 0,
        branchRootId: null,
        isOnFocusPath: true,
        isFocus: resolvedFocusId === VIRTUAL_ROOT_ID,
        isGrandchildPreview: false,
        isCollapsedWithChildren: hiddenCount > 0 && realChildrenOnly.length === 0,
        totalDescendants,
        visibleDescendants,
        hiddenCount,
        visibleChildIds: childIds,
      }
      return
    }

    const domainNode = tree.nodes[nodeId]!
    const hasHiddenChildren = hiddenCount > 0 && realChildrenOnly.length === 0
    nodes[nodeId] = {
      id: nodeId,
      parentId,
      kind: 'node',
      title: domainNode.meta.title,
      type: domainNode.meta.type,
      status: domainNode.meta.status,
      tags: domainNode.meta.tags,
      order: domainNode.meta.order,
      color: domainNode.meta.color,
      depth: depthMap.get(nodeId) ?? 1,
      branchRootId: branchRootMap.get(nodeId) ?? nodeId,
      isOnFocusPath: focusPathSet.has(nodeId),
      isFocus: resolvedFocusId === nodeId,
      isGrandchildPreview: grandchildIds.has(nodeId),
      isCollapsedWithChildren: hasHiddenChildren || hiddenCount > 0,
      totalDescendants,
      visibleDescendants,
      hiddenCount,
      visibleChildIds: childIds,
    }
  }

  collectDfs(VIRTUAL_ROOT_ID, null)

  return {
    rootId: VIRTUAL_ROOT_ID,
    focusId: resolvedFocusId,
    nodes,
    orderedIds,
    focusPathIds: focusPathSet,
    totalSubtreeCounts,
  }
}

import type { NodeStatus, NodeType } from '@/domain/schema'
import { compareSiblings, type TreeNode, type TreeState } from '@/domain/tree'

/**
 * Canonical map root identifier aligned with D3 decision (`'__root__'`).
 * `spikes/s3-radial` used `'__virtual_root__'`; M1/M2 had no root ID constant in `src/`.
 */
export const MAP_ROOT_ID = '__root__'

/** Prefix for synthetic `+N` overflow bubble node IDs. */
export const OVERFLOW_NODE_PREFIX = '__overflow__:'

export type ZoomTier = 0 | 1 | 2

/**
 * Named visibility bounds & thresholds with documented origins (`spec-map.md` vs `S3`).
 */
export interface VisibilityConfig {
  /** `spec-map.md` §6.2 FR-MAP-02 #2/#3/#5: max children per expanded parent before `+N`. */
  maxChildrenShown: number
  /** `spec-map.md` §6.2 FR-MAP-17 & `S3`: hard ceiling on simultaneously rendered nodes (~300). */
  maxVisibleNodes: number
  /** `spec-map.md` §6.2 FR-MAP-02 #4: lowest zoom tier where focus grandchildren appear. */
  minZoomTierForGrandchildren: ZoomTier
  /** `spec-map.md` §6.2 FR-MAP-02 #2/#4: max depth below focus when `zoomTier < 2`. */
  focusExpandDepthBelowTier2: number
  /** `spec-map.md` §6.2 FR-MAP-02 #4: max depth below focus when `zoomTier >= 2`. */
  focusExpandDepthAtTier2: number
  /** `S3` (`compute-visible.ts`): per-child grandchild cap at tier >= 2 to prevent one branch consuming the 300-node budget. */
  maxGrandchildrenPerChild: number
  /** `spec-map.md` §6.2 FR-MAP-02 #3: ancestor/focus siblings expand 0 levels (collapsed depth +1 from parent). */
  siblingCollapsedDepth: number
}

export const DEFAULT_VISIBILITY_CONFIG: Readonly<VisibilityConfig> = Object.freeze({
  maxChildrenShown: 24,
  maxVisibleNodes: 300,
  minZoomTierForGrandchildren: 2,
  focusExpandDepthBelowTier2: 1,
  focusExpandDepthAtTier2: 2,
  maxGrandchildrenPerChild: 6,
  siblingCollapsedDepth: 1,
})

export interface VisibleMapNode {
  id: string
  parentId: string | null
  kind: 'root' | 'node' | 'overflow'
  overflowParentId?: string
  overflowCount?: number
  title: string
  type: NodeType | 'root' | 'overflow'
  status: NodeStatus
  tags: readonly string[]
  order: string
  color: string | null
  depth: number
  branchRootId: string | null
  isOnFocusPath: boolean
  isFocus: boolean
  isGrandchildPreview: boolean
  isCollapsedWithChildren: boolean
  totalDescendants: number
  visibleDescendants: number
  hiddenCount: number
  visibleChildIds: readonly string[]
}

export interface ComputeVisibleInput {
  tree: TreeState
  rootTitle: string
  focusId: string
  pinnedIds?: ReadonlySet<string>
  expandedOverflowParentIds?: ReadonlySet<string>
  zoomTier: ZoomTier
  config?: Partial<VisibilityConfig>
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
  return `${OVERFLOW_NODE_PREFIX}${parentId}`
}

function getSortedChildIds(tree: TreeState, parentId: string): string[] {
  const rawIds = parentId === MAP_ROOT_ID ? tree.rootIds : (tree.nodes[parentId]?.childrenIds ?? [])

  const items: Array<{ id: string; order: string }> = []
  const seen = new Set<string>()
  for (const cid of rawIds) {
    if (seen.has(cid)) continue
    seen.add(cid)
    const node = tree.nodes[cid]
    if (!node) continue
    items.push({ id: cid, order: node.meta.order })
  }

  items.sort(compareSiblings)
  return items.map((item) => item.id)
}

function computePostOrderAndSubtreeCounts(tree: TreeState): Record<string, number> {
  const counts: Record<string, number> = {}
  const visited = new Set<string>()
  const postOrder: string[] = []
  const rootChildren = getSortedChildIds(tree, MAP_ROOT_ID)
  const stack: Array<{ id: string; expanded: boolean }> = []

  for (let i = rootChildren.length - 1; i >= 0; i -= 1) {
    stack.push({ id: rootChildren[i]!, expanded: false })
  }

  while (stack.length > 0) {
    const top = stack.pop()!
    if (!tree.nodes[top.id]) continue

    if (top.expanded) {
      postOrder.push(top.id)
      continue
    }

    if (visited.has(top.id)) continue
    visited.add(top.id)
    stack.push({ id: top.id, expanded: true })

    const children = getSortedChildIds(tree, top.id)
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const cid = children[i]!
      if (!visited.has(cid)) {
        stack.push({ id: cid, expanded: false })
      }
    }
  }

  for (const id of postOrder) {
    const children = getSortedChildIds(tree, id)
    let sum = 0
    for (const cid of children) {
      sum += 1 + (counts[cid] ?? 0)
    }
    counts[id] = sum
  }

  let rootTotal = 0
  for (const rootChildId of rootChildren) {
    rootTotal += 1 + (counts[rootChildId] ?? 0)
  }
  counts[MAP_ROOT_ID] = rootTotal

  return counts
}

function resolveFocusPath(
  tree: TreeState,
  focusId: string,
): {
  resolvedFocusId: string
  focusPathList: string[]
  focusPathSet: Set<string>
} {
  const resolvedFocusId = focusId === MAP_ROOT_ID || tree.nodes[focusId] ? focusId : MAP_ROOT_ID

  const focusPathList: string[] = []
  const seen = new Set<string>()
  if (resolvedFocusId !== MAP_ROOT_ID) {
    let cursor: string | null = resolvedFocusId
    while (cursor !== null && !seen.has(cursor)) {
      const node: TreeNode | undefined = tree.nodes[cursor]
      if (!node) break
      seen.add(cursor)
      focusPathList.push(cursor)
      cursor = node.parentId
    }
  }
  focusPathList.push(MAP_ROOT_ID)
  focusPathList.reverse()

  return {
    resolvedFocusId,
    focusPathList,
    focusPathSet: new Set(focusPathList),
  }
}

/**
 * Pure visible-node selection following `spec-map.md` §6.2 FR-MAP-02:
 * - Deterministic regardless of input array/key ordering (always sorts siblings via `compareSiblings`).
 * - Focus node and its entire path from `MAP_ROOT_ID` are admitted first and never evicted.
 * - Parent-closed: only reachable parents expand children up to the `maxVisibleNodes` ceiling.
 * - Does not mutate any input object (`tree`, `pinnedIds`, `expandedOverflowParentIds`, `config`).
 */
export function computeVisible(input: ComputeVisibleInput): ComputeVisibleResult {
  const cfg: VisibilityConfig = {
    ...DEFAULT_VISIBILITY_CONFIG,
    ...input.config,
  }
  const { tree, rootTitle, zoomTier } = input
  const pinnedIds = input.pinnedIds ?? new Set<string>()
  const expandedOverflow = input.expandedOverflowParentIds ?? new Set<string>()

  const totalSubtreeCounts = computePostOrderAndSubtreeCounts(tree)
  const { resolvedFocusId, focusPathList, focusPathSet } = resolveFocusPath(tree, input.focusId)

  const admittedReal = new Set<string>(focusPathList)
  const childrenShownForParent = new Map<string, string[]>()
  const overflowCountForParent = new Map<string, number>()

  const totalUsedSlots = (): number => admittedReal.size + overflowCountForParent.size

  const expandParentChildren = (
    parentId: string,
    perParentCap: number,
    options?: { allowOverflowBubble?: boolean },
  ): string[] => {
    const allChildren = getSortedChildIds(tree, parentId)
    if (allChildren.length === 0) {
      childrenShownForParent.set(parentId, [])
      return []
    }

    const showAll = expandedOverflow.has(parentId)
    const desiredCount = showAll ? allChildren.length : Math.min(allChildren.length, perParentCap)
    const focusChildOnPath = allChildren.find((cid) => focusPathSet.has(cid))

    // Pick first `desiredCount` by canonical sibling order, always keeping the focus-path child
    const candidates: string[] = []
    for (let i = 0; i < desiredCount; i += 1) {
      candidates.push(allChildren[i]!)
    }
    if (focusChildOnPath && !candidates.includes(focusChildOnPath)) {
      if (candidates.length > 0) {
        candidates[candidates.length - 1] = focusChildOnPath
      } else {
        candidates.push(focusChildOnPath)
      }
      candidates.sort((a, b) => {
        const na = tree.nodes[a]!
        const nb = tree.nodes[b]!
        return compareSiblings(
          { id: na.id, order: na.meta.order },
          { id: nb.id, order: nb.meta.order },
        )
      })
    }

    const allowOverflow = options?.allowOverflowBubble ?? true
    const alreadyHadOverflow = overflowCountForParent.has(parentId)
    const admittedForParent: string[] = []

    for (let i = 0; i < candidates.length; i += 1) {
      const cid = candidates[i]!
      if (admittedReal.has(cid)) {
        admittedForParent.push(cid)
        continue
      }

      const remainingBefore = cfg.maxVisibleNodes - totalUsedSlots()
      if (remainingBefore <= 0) break

      // Reserve 1 slot for the `+N` bubble when truncation will occur and overflow bubble is enabled
      const moreRemainAfterThis = admittedForParent.length + 1 < allChildren.length
      if (allowOverflow && !alreadyHadOverflow && remainingBefore === 1 && moreRemainAfterThis) {
        break
      }

      admittedReal.add(cid)
      admittedForParent.push(cid)
    }

    const hiddenChildrenCount = allChildren.length - admittedForParent.length
    if (hiddenChildrenCount > 0 && allowOverflow) {
      if (alreadyHadOverflow || totalUsedSlots() < cfg.maxVisibleNodes) {
        overflowCountForParent.set(parentId, hiddenChildrenCount)
      }
    } else if (hiddenChildrenCount <= 0 && alreadyHadOverflow) {
      overflowCountForParent.delete(parentId)
    }

    childrenShownForParent.set(parentId, admittedForParent)
    return admittedForParent
  }

  // 1. Expand focus node children first (FR-MAP-02 #2), then ancestors bottom-up or top-down (#3)
  // Expanding focus first ensures focus's own children are never starved if budget is near 300.
  for (let i = focusPathList.length - 1; i >= 0; i -= 1) {
    expandParentChildren(focusPathList[i]!, cfg.maxChildrenShown)
  }

  // 2. Assign deterministic depth & branchRootId so only reachable pinned nodes can expand (#5)
  const depthMap = new Map<string, number>([[MAP_ROOT_ID, 0]])
  const branchRootMap = new Map<string, string | null>([[MAP_ROOT_ID, null]])

  const refreshReachableDepths = (): void => {
    const queue: string[] = [MAP_ROOT_ID]
    let head = 0
    while (head < queue.length) {
      const currentId = queue[head]!
      head += 1
      const currentDepth = depthMap.get(currentId) ?? 0
      const currentBranchRoot = branchRootMap.get(currentId) ?? null
      const children = childrenShownForParent.get(currentId) ?? []
      for (const cid of children) {
        depthMap.set(cid, currentDepth + 1)
        branchRootMap.set(cid, currentDepth === 0 ? cid : currentBranchRoot)
        queue.push(cid)
      }
    }
  }

  refreshReachableDepths()

  // Expand pinned nodes deterministically by (depth, order, id); only nodes currently reachable expand
  if (pinnedIds.size > 0) {
    const expandedPinned = new Set<string>()
    let progressed = true
    while (progressed) {
      progressed = false
      const candidates = [...pinnedIds]
        .filter(
          (id) =>
            !expandedPinned.has(id) &&
            !childrenShownForParent.has(id) &&
            depthMap.has(id) &&
            (id === MAP_ROOT_ID || Boolean(tree.nodes[id])),
        )
        .sort((a, b) => {
          const da = depthMap.get(a) ?? 0
          const db = depthMap.get(b) ?? 0
          if (da !== db) return da - db
          if (a === MAP_ROOT_ID) return -1
          if (b === MAP_ROOT_ID) return 1
          return compareSiblings(
            { id: a, order: tree.nodes[a]!.meta.order },
            { id: b, order: tree.nodes[b]!.meta.order },
          )
        })

      for (const pinnedId of candidates) {
        expandedPinned.add(pinnedId)
        expandParentChildren(pinnedId, cfg.maxChildrenShown)
        refreshReachableDepths()
        progressed = true
      }
    }
  }

  // 3. Focus grandchildren preview at zoomTier >= 2 (FR-MAP-02 #4)
  const grandchildIds = new Set<string>()
  const focusDepth = focusPathList.length - 1
  const maxDepthAllowed =
    zoomTier >= cfg.minZoomTierForGrandchildren
      ? focusDepth + cfg.focusExpandDepthAtTier2
      : focusDepth + cfg.focusExpandDepthBelowTier2

  if (
    zoomTier >= cfg.minZoomTierForGrandchildren &&
    focusDepth + cfg.focusExpandDepthAtTier2 <= maxDepthAllowed
  ) {
    const focusChildren = childrenShownForParent.get(resolvedFocusId) ?? []
    for (const fcId of focusChildren) {
      if (totalUsedSlots() >= cfg.maxVisibleNodes) break
      if (childrenShownForParent.has(fcId)) continue
      const allGrand = getSortedChildIds(tree, fcId)
      if (allGrand.length === 0) continue

      const admittedGrand = expandParentChildren(fcId, cfg.maxGrandchildrenPerChild, {
        allowOverflowBubble: true,
      })
      for (const gid of admittedGrand) {
        grandchildIds.add(gid)
      }
    }
    refreshReachableDepths()
  }

  // 4. Assemble deterministic DFS output + compute bottom-up visibleDescendants / hiddenCount
  const nodes: Record<string, VisibleMapNode> = {}
  const orderedIds: string[] = []

  const collectDfs = (nodeId: string, parentId: string | null): void => {
    orderedIds.push(nodeId)
    const realChildren = childrenShownForParent.get(nodeId) ?? []
    const overflowCount = overflowCountForParent.get(nodeId) ?? 0
    const childOverflowId = overflowCount > 0 ? overflowBubbleId(nodeId) : null

    for (const cid of realChildren) {
      collectDfs(cid, nodeId)
    }

    const visibleChildIds = [...realChildren]
    if (childOverflowId && overflowCount > 0) {
      visibleChildIds.push(childOverflowId)
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
    for (const cid of realChildren) {
      visibleDescendants += 1 + (nodes[cid]?.visibleDescendants ?? 0)
    }

    const totalDescendants = totalSubtreeCounts[nodeId] ?? 0
    const hiddenCount = Math.max(0, totalDescendants - visibleDescendants)

    if (nodeId === MAP_ROOT_ID) {
      nodes[nodeId] = {
        id: MAP_ROOT_ID,
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
        isFocus: resolvedFocusId === MAP_ROOT_ID,
        isGrandchildPreview: false,
        isCollapsedWithChildren: hiddenCount > 0,
        totalDescendants,
        visibleDescendants,
        hiddenCount,
        visibleChildIds,
      }
      return
    }

    const domainNode = tree.nodes[nodeId]!
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
      isCollapsedWithChildren: hiddenCount > 0,
      totalDescendants,
      visibleDescendants,
      hiddenCount,
      visibleChildIds,
    }
  }

  collectDfs(MAP_ROOT_ID, null)

  return {
    rootId: MAP_ROOT_ID,
    focusId: resolvedFocusId,
    nodes,
    orderedIds,
    focusPathIds: focusPathSet,
    totalSubtreeCounts,
  }
}

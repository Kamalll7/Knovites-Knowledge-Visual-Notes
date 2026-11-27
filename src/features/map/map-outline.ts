import type { NodeStatus, NodeType } from '@/domain/schema'
import { VIRTUAL_ROOT_ID, type TreeState } from '@/domain/tree'

export interface OutlineRow {
  readonly id: string
  readonly parentId: string | null
  readonly isRoot: boolean
  readonly title: string
  readonly type: NodeType | null
  readonly status: NodeStatus
  readonly level: number
  readonly posInSet: number
  readonly setSize: number
  readonly hasChildren: boolean
  readonly isExpanded: boolean
  readonly childCount: number
  readonly descendantCount: number
  readonly isLocked: boolean
  readonly tags: readonly string[]
}

export type OutlineKeyCommand =
  | { readonly type: 'focus'; readonly nodeId: string }
  | { readonly type: 'expand'; readonly nodeId: string }
  | { readonly type: 'collapse'; readonly nodeId: string }
  | { readonly type: 'open'; readonly nodeId: string }
  | null

/**
 * Collects ancestor IDs (starting with `VIRTUAL_ROOT_ID`) strictly above `nodeId`.
 * Returns an empty array when `nodeId === VIRTUAL_ROOT_ID`.
 */
export function collectAncestorIds(tree: TreeState, nodeId: string): string[] {
  if (nodeId === VIRTUAL_ROOT_ID) return []
  const ancestors: string[] = []
  const seen = new Set<string>()
  let cur = tree.nodes[nodeId]?.parentId ?? null
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    ancestors.push(cur)
    cur = tree.nodes[cur]?.parentId ?? null
  }
  ancestors.push(VIRTUAL_ROOT_ID)
  ancestors.reverse()
  return ancestors
}

/**
 * Builds the default expanded set for Outline View: expands virtual Home root,
 * top-level branches, and all ancestors of `focusId` so the active node is visible.
 */
export function buildInitialExpandedIds(tree: TreeState, focusId: string): Set<string> {
  const expanded = new Set<string>([VIRTUAL_ROOT_ID])
  for (const rootChildId of tree.rootIds) {
    expanded.add(rootChildId)
  }
  for (const ancestorId of collectAncestorIds(tree, focusId)) {
    expanded.add(ancestorId)
  }
  return expanded
}

function computeDescendantCounts(tree: TreeState): Map<string, number> {
  const counts = new Map<string, number>()
  const visit = (id: string, stack: Set<string>): number => {
    const cached = counts.get(id)
    if (cached !== undefined) return cached
    if (stack.has(id)) return 0
    stack.add(id)
    const node = tree.nodes[id]
    let total = 0
    if (node) {
      for (const childId of node.childrenIds) {
        if (!tree.nodes[childId]) continue
        total += 1 + visit(childId, stack)
      }
    }
    stack.delete(id)
    counts.set(id, total)
    return total
  }
  const stack = new Set<string>()
  for (const id of Object.keys(tree.nodes)) {
    visit(id, stack)
  }
  return counts
}

/**
 * Flattens the visible portion of `tree` into pre-order WAI-ARIA TreeView rows (`FR-MAP-14`).
 */
export function flattenOutlineRows(
  tree: TreeState,
  rootTitle: string,
  expandedIds: ReadonlySet<string>,
): OutlineRow[] {
  const descendantCounts = computeDescendantCounts(tree)
  const rows: OutlineRow[] = []
  const rootChildren = tree.rootIds.filter((id) => Boolean(tree.nodes[id]))
  const rootExpanded = rootChildren.length > 0 && expandedIds.has(VIRTUAL_ROOT_ID)

  rows.push({
    id: VIRTUAL_ROOT_ID,
    parentId: null,
    isRoot: true,
    title: rootTitle,
    type: null,
    status: 'none',
    level: 1,
    posInSet: 1,
    setSize: 1,
    hasChildren: rootChildren.length > 0,
    isExpanded: rootExpanded,
    childCount: rootChildren.length,
    descendantCount: Object.keys(tree.nodes).length,
    isLocked: false,
    tags: [],
  })

  if (!rootExpanded) return rows

  const visitChildren = (parentId: string, childIds: readonly string[], level: number) => {
    const validIds = childIds.filter((id) => Boolean(tree.nodes[id]))
    const setSize = validIds.length
    for (let i = 0; i < setSize; i += 1) {
      const id = validIds[i]!
      const node = tree.nodes[id]!
      const nestedChildren = node.childrenIds.filter((cid) => Boolean(tree.nodes[cid]))
      const hasChildren = nestedChildren.length > 0
      const isExpanded = hasChildren && expandedIds.has(id)
      rows.push({
        id,
        parentId,
        isRoot: false,
        title: node.meta.title || node.slug,
        type: node.meta.type,
        status: node.meta.status,
        level,
        posInSet: i + 1,
        setSize,
        hasChildren,
        isExpanded,
        childCount: nestedChildren.length,
        descendantCount: descendantCounts.get(id) ?? 0,
        isLocked: node.corrupt || node.newerSchemaVersion !== undefined,
        tags: node.meta.tags,
      })
      if (isExpanded) {
        visitChildren(id, nestedChildren, level + 1)
      }
    }
  }

  visitChildren(VIRTUAL_ROOT_ID, rootChildren, 2)
  return rows
}

/**
 * Resolves WAI-ARIA TreeView keyboard navigation commands (`FR-MAP-14`).
 */
export function resolveOutlineKeyCommand(
  key: string,
  rows: readonly OutlineRow[],
  activeId: string,
): OutlineKeyCommand {
  if (rows.length === 0) return null
  const idx = rows.findIndex((r) => r.id === activeId)
  if (idx < 0) return { type: 'focus', nodeId: rows[0]!.id }
  const current = rows[idx]!

  switch (key) {
    case 'ArrowDown':
      return idx + 1 < rows.length ? { type: 'focus', nodeId: rows[idx + 1]!.id } : null
    case 'ArrowUp':
      return idx > 0 ? { type: 'focus', nodeId: rows[idx - 1]!.id } : null
    case 'ArrowRight':
      if (!current.hasChildren) return null
      if (!current.isExpanded) return { type: 'expand', nodeId: current.id }
      if (idx + 1 < rows.length && rows[idx + 1]!.parentId === current.id) {
        return { type: 'focus', nodeId: rows[idx + 1]!.id }
      }
      return null
    case 'ArrowLeft':
      if (current.hasChildren && current.isExpanded) {
        return { type: 'collapse', nodeId: current.id }
      }
      if (current.parentId !== null) {
        return { type: 'focus', nodeId: current.parentId }
      }
      return null
    case 'Home':
      return { type: 'focus', nodeId: rows[0]!.id }
    case 'End':
      return { type: 'focus', nodeId: rows[rows.length - 1]!.id }
    case 'Enter':
      return { type: 'open', nodeId: current.id }
    default:
      return null
  }
}

import { VIRTUAL_ROOT_ID, type TreeState } from '@/domain/tree'

export interface BreadcrumbItem {
  readonly id: string
  readonly title: string
  readonly isCurrent: boolean
}

/**
 * Pure helper building the clickable breadcrumb path `Home > ... > Focused` (`FR-MAP-11`).
 */
export function buildBreadcrumbTrail(
  tree: TreeState,
  focusId: string,
  rootTitle = 'Home',
): BreadcrumbItem[] {
  const trail: Array<{ id: string; title: string }> = []
  const visited = new Set<string>()
  let cursor = focusId !== VIRTUAL_ROOT_ID ? tree.nodes[focusId] : undefined

  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    trail.push({ id: cursor.id, title: cursor.meta.title || cursor.slug })
    cursor = cursor.parentId !== null ? tree.nodes[cursor.parentId] : undefined
  }

  trail.reverse()
  const full = [{ id: VIRTUAL_ROOT_ID, title: rootTitle }, ...trail]
  const currentId = full[full.length - 1]!.id

  return full.map((item) => ({
    ...item,
    isCurrent: item.id === currentId,
  }))
}

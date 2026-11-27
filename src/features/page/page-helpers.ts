import { selectPageTarget, type PageTarget, type RootHomeState } from '@/app/store'
import { VIRTUAL_ROOT_ID, isVirtualRootId, type TreeNode, type TreeState } from '@/domain/tree'
import { en } from '@/i18n/en'

/** Legacy sample route ID kept for T0.4 shell & navigation tests (`e2e/shell.spec.ts`). */
export const SAMPLE_DEMO_NODE_ID = 'demo-ret2win' as const

export type NodePageSaveStatus = 'idle' | 'lazy-empty' | 'saving' | 'saved' | 'error' | 'readonly'
export type RightPanelTab = 'links' | 'children' | 'info'

export interface PageBreadcrumbItem {
  readonly id: string
  readonly title: string
  readonly route: string
}

export type ResolvedNodePageView =
  | { readonly kind: 'loading'; readonly nodeId: string }
  | { readonly kind: 'not-found'; readonly nodeId: string }
  | { readonly kind: 'sample'; readonly nodeId: string; readonly title: string }
  | {
      readonly kind: 'home'
      readonly nodeId: typeof VIRTUAL_ROOT_ID
      readonly title: string
      readonly target: Extract<PageTarget, { kind: 'home' }>
    }
  | {
      readonly kind: 'node'
      readonly nodeId: string
      readonly title: string
      readonly target: Extract<PageTarget, { kind: 'node' }>
      readonly node: TreeNode
      readonly ancestors: readonly PageBreadcrumbItem[]
    }

export function buildNodeAncestors(tree: TreeState, node: TreeNode): PageBreadcrumbItem[] {
  const ancestors: PageBreadcrumbItem[] = []
  const seen = new Set<string>([node.id])
  let current = node.parentId !== null ? tree.nodes[node.parentId] : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    ancestors.push({
      id: current.id,
      title: current.meta.title,
      route: `/n/${current.id}`,
    })
    current = current.parentId !== null ? tree.nodes[current.parentId] : undefined
  }
  ancestors.reverse()
  return ancestors
}

export function resolveNodePageView(params: {
  readonly tree: TreeState
  readonly rootHome: RootHomeState
  readonly hydrated: boolean
  readonly rawNodeId: string
}): ResolvedNodePageView {
  const { tree, rootHome, hydrated, rawNodeId } = params

  if (isVirtualRootId(rawNodeId)) {
    const target = selectPageTarget({ tree, rootHome }, VIRTUAL_ROOT_ID)
    if (target && target.kind === 'home') {
      return {
        kind: 'home',
        nodeId: VIRTUAL_ROOT_ID,
        title: target.title,
        target,
      }
    }
  }

  const target = selectPageTarget({ tree, rootHome }, rawNodeId)
  if (target && target.kind === 'node') {
    const node = tree.nodes[rawNodeId]
    if (node) {
      return {
        kind: 'node',
        nodeId: node.id,
        title: target.title,
        target,
        node,
        ancestors: buildNodeAncestors(tree, node),
      }
    }
  }

  if (rawNodeId === SAMPLE_DEMO_NODE_ID) {
    return {
      kind: 'sample',
      nodeId: rawNodeId,
      title: `${en.nodePage.titlePrefix}: ${rawNodeId}`,
    }
  }

  if (!hydrated) {
    return { kind: 'loading', nodeId: rawNodeId }
  }

  return { kind: 'not-found', nodeId: rawNodeId }
}

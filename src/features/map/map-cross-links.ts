import type { MapLayoutNode, MapLayoutResult } from '@/domain/layout'
import { VIRTUAL_ROOT_ID, compareLexicographical, type TreeState } from '@/domain/tree'

export interface CrossLinkEdge {
  readonly id: string
  readonly sourceId: string
  readonly targetId: string
  readonly label?: string
}

export interface CrossLinkArcGeometry {
  readonly pathD: string
  readonly arrowD: string
}

const ARC_ENDPOINT_GAP_PX = 3
const ARROW_LENGTH_PX = 7
const ARROW_HALF_WIDTH_PX = 3.5

/**
 * Collects deduplicated directed cross-link pairs `(sourceId -> targetId)` from both
 * `node.meta.links` (`FR-MAP-16`, `data-format.md` §5.3) and inline `knovites:<ulid>` links
 * extracted from active canvases (`data-format.md` §5.4).
 * Ignores self-links, broken links to missing tree nodes, and duplicates.
 */
export function collectWorkspaceCrossLinks(
  tree: TreeState,
  canvasLinkTargetsByNode: Readonly<Record<string, readonly string[]>> = {},
): CrossLinkEdge[] {
  const validNodeIds = new Set(Object.keys(tree.nodes))
  const byId = new Map<string, CrossLinkEdge>()

  const addLink = (sourceId: string, targetId: string, label?: string) => {
    if (sourceId === targetId) return
    if (sourceId !== VIRTUAL_ROOT_ID && !validNodeIds.has(sourceId)) return
    if (!validNodeIds.has(targetId)) return
    const id = `${sourceId}->${targetId}`
    const existing = byId.get(id)
    if (existing) {
      if (!existing.label && label) {
        byId.set(id, { id, sourceId, targetId, label })
      }
      return
    }
    byId.set(id, label ? { id, sourceId, targetId, label } : { id, sourceId, targetId })
  }

  for (const node of Object.values(tree.nodes)) {
    for (const link of node.meta.links) {
      addLink(node.id, link.to, link.label)
    }
  }

  for (const [sourceId, targetIds] of Object.entries(canvasLinkTargetsByNode)) {
    for (const targetId of targetIds) {
      addLink(sourceId, targetId)
    }
  }

  return [...byId.values()].sort((a, b) => compareLexicographical(a.id, b.id))
}

/**
 * Filters workspace cross-links strictly to those incident on a currently focused or hovered node
 * (`FR-MAP-16`), requiring both endpoints to be present in the active `layout`.
 */
export function selectActiveCrossLinks(
  allLinks: readonly CrossLinkEdge[],
  activeNodeIds: ReadonlySet<string>,
  layout: MapLayoutResult,
): CrossLinkEdge[] {
  if (allLinks.length === 0 || activeNodeIds.size === 0) return []
  const active: CrossLinkEdge[] = []
  for (const link of allLinks) {
    if (!activeNodeIds.has(link.sourceId) && !activeNodeIds.has(link.targetId)) continue
    if (!layout.nodes[link.sourceId] || !layout.nodes[link.targetId]) continue
    active.push(link)
  }
  return active
}

function clipRayToNodePerimeter(
  node: MapLayoutNode,
  dirX: number,
  dirY: number,
): { readonly x: number; readonly y: number } {
  const len = Math.hypot(dirX, dirY)
  if (len < 1e-3) return { x: node.x, y: node.y }
  const ux = dirX / len
  const uy = dirY / len
  if (node.shape === 'circle') {
    const r = (node.radius ?? node.width / 2) + ARC_ENDPOINT_GAP_PX
    return { x: node.x + ux * r, y: node.y + uy * r }
  }
  const halfW = node.width / 2 + ARC_ENDPOINT_GAP_PX
  const halfH = node.height / 2 + ARC_ENDPOINT_GAP_PX
  const t = Math.min(
    Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity,
  )
  return { x: node.x + ux * t, y: node.y + uy * t }
}

/**
 * Computes a quadratic Bezier arc and target arrowhead between two visible layout nodes.
 */
export function buildCrossLinkArcGeometry(
  sourceNode: MapLayoutNode,
  targetNode: MapLayoutNode,
): CrossLinkArcGeometry | null {
  const dx = targetNode.x - sourceNode.x
  const dy = targetNode.y - sourceNode.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return null

  const nx = -dy / dist
  const ny = dx / dist
  const bend = Math.min(96, Math.max(30, dist * 0.24))
  const cx = (sourceNode.x + targetNode.x) / 2 + nx * bend
  const cy = (sourceNode.y + targetNode.y) / 2 + ny * bend

  const start = clipRayToNodePerimeter(sourceNode, cx - sourceNode.x, cy - sourceNode.y)
  const end = clipRayToNodePerimeter(targetNode, cx - targetNode.x, cy - targetNode.y)

  const tanX = end.x - cx
  const tanY = end.y - cy
  const tanLen = Math.hypot(tanX, tanY) || 1
  const tx = tanX / tanLen
  const ty = tanY / tanLen
  const px = -ty
  const py = tx

  const tipX = end.x
  const tipY = end.y
  const baseX = tipX - tx * ARROW_LENGTH_PX
  const baseY = tipY - ty * ARROW_LENGTH_PX
  const leftX = baseX + px * ARROW_HALF_WIDTH_PX
  const leftY = baseY + py * ARROW_HALF_WIDTH_PX
  const rightX = baseX - px * ARROW_HALF_WIDTH_PX
  const rightY = baseY - py * ARROW_HALF_WIDTH_PX

  const f = (n: number) => Number(n.toFixed(2))
  return {
    pathD: `M ${f(start.x)} ${f(start.y)} Q ${f(cx)} ${f(cy)} ${f(end.x)} ${f(end.y)}`,
    arrowD: `M ${f(leftX)} ${f(leftY)} L ${f(tipX)} ${f(tipY)} L ${f(rightX)} ${f(rightY)}`,
  }
}

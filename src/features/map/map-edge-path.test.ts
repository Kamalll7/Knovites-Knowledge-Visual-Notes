import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  HORIZONTAL_WIDE_FAN_FADE_THRESHOLD,
  MAP_ROOT_ID,
  computeHorizontalLayout,
  computeRadialLayout,
  type ComputeVisibleResult,
  type VisibleMapNode,
} from '@/domain/layout'
import {
  EDGE_OPACITY,
  WIDE_FAN_FADE_THRESHOLD,
  buildRenderedMapEdges,
  sampleEdgePathPoints,
} from '@/features/map/map-edge-path'

const measure75 = (text: string) => text.length * 7.5

function makeVisibleNode(
  partial: Partial<VisibleMapNode> & Pick<VisibleMapNode, 'id' | 'parentId' | 'title' | 'depth'>,
): VisibleMapNode {
  return {
    kind: partial.kind ?? (partial.id === MAP_ROOT_ID ? 'root' : 'node'),
    type: partial.type ?? (partial.id === MAP_ROOT_ID ? 'root' : 'concept'),
    status: partial.status ?? 'none',
    tags: partial.tags ?? [],
    order: partial.order ?? `a_${partial.id}`,
    color: partial.color ?? null,
    branchRootId: partial.branchRootId ?? (partial.depth === 1 ? partial.id : null),
    isOnFocusPath: partial.isOnFocusPath ?? partial.id === MAP_ROOT_ID,
    isFocus: partial.isFocus ?? partial.id === MAP_ROOT_ID,
    isGrandchildPreview: partial.isGrandchildPreview ?? false,
    isCollapsedWithChildren: partial.isCollapsedWithChildren ?? false,
    totalDescendants: partial.totalDescendants ?? 0,
    visibleDescendants: partial.visibleDescendants ?? 0,
    hiddenCount: partial.hiddenCount ?? 0,
    visibleChildIds: partial.visibleChildIds ?? [],
    ...partial,
  }
}

function makeFanVisible(childCount: number): ComputeVisibleResult {
  const nodes: Record<string, VisibleMapNode> = {}
  const childIds: string[] = []
  for (let i = 0; i < childCount; i += 1) {
    const id = `c_${i}`
    childIds.push(id)
    nodes[id] = makeVisibleNode({
      id,
      parentId: MAP_ROOT_ID,
      title: `Branch ${i}`,
      depth: 1,
      order: `k_${String(i).padStart(3, '0')}`,
      isOnFocusPath: i === 0,
      isFocus: i === 0,
    })
  }
  nodes[MAP_ROOT_ID] = makeVisibleNode({
    id: MAP_ROOT_ID,
    parentId: null,
    title: 'Root',
    depth: 0,
    isOnFocusPath: true,
    isFocus: false,
    visibleChildIds: childIds,
  })
  return {
    rootId: MAP_ROOT_ID,
    focusId: childIds[0] ?? MAP_ROOT_ID,
    nodes,
    orderedIds: [MAP_ROOT_ID, ...childIds],
    focusPathIds: new Set([MAP_ROOT_ID, ...(childIds[0] ? [childIds[0]] : [])]),
    totalSubtreeCounts: Object.fromEntries(
      [MAP_ROOT_ID, ...childIds].map((id) => [id, id === MAP_ROOT_ID ? childCount : 0]),
    ),
  }
}

describe('map-edge-path [T3.4a, FR-MAP-09]', () => {
  it('shares HORIZONTAL_WIDE_FAN_FADE_THRESHOLD (12) and applies base fade consistently on radial and horizontal layouts', () => {
    expect(WIDE_FAN_FADE_THRESHOLD).toBe(HORIZONTAL_WIDE_FAN_FADE_THRESHOLD)
    expect(WIDE_FAN_FADE_THRESHOLD).toBe(12)

    const vis11 = makeFanVisible(11)
    const vis12 = makeFanVisible(12)

    // Radial: layout edges carry NO fadeSourceBase; map-edge-path derives it from visible fan count
    const rad11 = computeRadialLayout({ visible: vis11, measureText: measure75, scale: 1, tier: 1 })
    const rad12 = computeRadialLayout({ visible: vis12, measureText: measure75, scale: 1, tier: 1 })
    expect('fadeSourceBase' in rad12.edges[0]!).toBe(false)

    const renRad11 = buildRenderedMapEdges(rad11, vis11, 'radial')
    const renRad12 = buildRenderedMapEdges(rad12, vis12, 'radial')
    expect(
      renRad11.every((e) => e.sourceFanCount === 11 && !e.fadeSourceBase && e.gradientId === null),
    ).toBe(true)
    expect(
      renRad12.every((e) => e.sourceFanCount === 12 && e.fadeSourceBase && e.gradientId !== null),
    ).toBe(true)

    // Horizontal: uses horizontal layout's own fadeSourceBase/sourceFanCount contract
    const hor11 = computeHorizontalLayout({
      visible: vis11,
      measureText: measure75,
      scale: 1,
      tier: 1,
    })
    const hor12 = computeHorizontalLayout({
      visible: vis12,
      measureText: measure75,
      scale: 1,
      tier: 1,
    })
    const renHor11 = buildRenderedMapEdges(hor11, vis11, 'horizontal')
    const renHor12 = buildRenderedMapEdges(hor12, vis12, 'horizontal')
    expect(
      renHor11.every((e) => e.sourceFanCount === 11 && !e.fadeSourceBase && e.gradientId === null),
    ).toBe(true)
    expect(
      renHor12.every((e) => e.sourceFanCount === 12 && e.fadeSourceBase && e.gradientId !== null),
    ).toBe(true)

    // Focus path edge is highlighted with higher strokeWidth & opacity (normal raised to 0.48)
    expect(EDGE_OPACITY.normal).toBe(0.48)
    expect(EDGE_OPACITY.focus).toBe(0.96)
    const focusEdge = renRad12.find((e) => e.targetId === 'c_0')!
    const otherEdge = renRad12.find((e) => e.targetId === 'c_1')!
    expect(focusEdge.isOnFocusPath).toBe(true)
    expect(otherEdge.isOnFocusPath).toBe(false)
    expect(focusEdge.opacity).toBe(EDGE_OPACITY.focus)
    expect(otherEdge.opacity).toBe(EDGE_OPACITY.normal)
    expect(focusEdge.strokeWidth).toBeGreaterThan(otherEdge.strokeWidth)
  })

  it('anchors every SVG cubic Bezier strictly at layout perimeter endpoints across random radial & horizontal trees', () => {
    const nodeGenArb = fc.record({
      parentIdx: fc.nat(),
      title: fc.string({ minLength: 1, maxLength: 20 }),
      order: fc.string({ minLength: 1, maxLength: 4 }),
    })

    fc.assert(
      fc.property(
        fc.array(nodeGenArb, { minLength: 1, maxLength: 25 }),
        fc.constantFrom<'radial' | 'horizontal'>('radial', 'horizontal'),
        (specs, orientation) => {
          const list: VisibleMapNode[] = [
            makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
          ]
          for (let i = 0; i < specs.length; i += 1) {
            const s = specs[i]!
            const parent = list[s.parentIdx % list.length]!
            list.push(
              makeVisibleNode({
                id: `n_${i}`,
                parentId: parent.id,
                title: s.title,
                depth: parent.depth + 1,
                order: `${s.order}_${i}`,
              }),
            )
          }
          const nodes: Record<string, VisibleMapNode> = {}
          const childMap = new Map<string, string[]>()
          for (const n of list) {
            nodes[n.id] = n
            if (n.parentId) {
              const arr = childMap.get(n.parentId) ?? []
              arr.push(n.id)
              childMap.set(n.parentId, arr)
            }
          }
          for (const [pid, cids] of childMap.entries()) {
            nodes[pid] = { ...nodes[pid]!, visibleChildIds: cids }
          }
          const visible: ComputeVisibleResult = {
            rootId: MAP_ROOT_ID,
            focusId: MAP_ROOT_ID,
            nodes,
            orderedIds: list.map((n) => n.id),
            focusPathIds: new Set([MAP_ROOT_ID]),
            totalSubtreeCounts: Object.fromEntries(list.map((n) => [n.id, 0])),
          }

          const layout =
            orientation === 'radial'
              ? computeRadialLayout({ visible, measureText: measure75, scale: 1, tier: 1 })
              : computeHorizontalLayout({ visible, measureText: measure75, scale: 1, tier: 1 })

          const rendered = buildRenderedMapEdges(layout, visible, orientation)
          expect(rendered).toHaveLength(layout.edges.length)

          for (let i = 0; i < rendered.length; i += 1) {
            const rEdge = rendered[i]!
            const rawEdge = layout.edges[i]!
            const startX = rEdge.controlPoints.sx
            const startY = rEdge.controlPoints.sy
            if (orientation === 'horizontal' || rawEdge.sourceId !== MAP_ROOT_ID) {
              expect(startX).toBeCloseTo(rawEdge.sourceX, 6)
              expect(startY).toBeCloseTo(rawEdge.sourceY, 6)
            }
            expect(
              rEdge.d.startsWith(`M ${Number(startX.toFixed(2))} ${Number(startY.toFixed(2))} `),
            ).toBe(true)
            expect(
              rEdge.d.endsWith(
                `${Number(rawEdge.targetX.toFixed(2))} ${Number(rawEdge.targetY.toFixed(2))}`,
              ),
            ).toBe(true)
            expect(rEdge.d.includes(' C ')).toBe(true)
            expect(rEdge.d.includes('NaN')).toBe(false)

            // Sample points along the ACTUAL rendered SVG path `d` (including horizontal gutter stubs!)
            const pts = sampleEdgePathPoints(rEdge.d, 10)
            expect(pts[0]!.x).toBeCloseTo(startX, 1)
            expect(pts[0]!.y).toBeCloseTo(startY, 1)
            expect(pts[pts.length - 1]!.x).toBeCloseTo(rawEdge.targetX, 1)
            expect(pts[pts.length - 1]!.y).toBeCloseTo(rawEdge.targetY, 1)

            if (orientation === 'horizontal') {
              const cMatch = / C ([-\d.]+) [-\d.]+, ([-\d.]+) [-\d.]+, ([-\d.]+) [-\d.]+/.exec(
                rEdge.d,
              )
              expect(cMatch).not.toBeNull()
              const cx1 = Number.parseFloat(cMatch![1]!)
              const cx2 = Number.parseFloat(cMatch![2]!)
              const gRight = Number.parseFloat(cMatch![3]!)
              expect(cx1).toBeGreaterThanOrEqual(rawEdge.sourceX - 0.5)
              expect(cx1).toBeLessThanOrEqual(gRight + 0.5)
              expect(cx2).toBeGreaterThanOrEqual(rawEdge.sourceX - 0.5)
              expect(cx2).toBeLessThanOrEqual(gRight + 0.5)

              // Actual gutter path `d` must NEVER cross any unrelated sibling capsule in horizontal mode
              for (let p = 1; p < pts.length - 1; p += 1) {
                const pt = pts[p]!
                for (const nid of layout.orderedIds) {
                  if (nid === rEdge.sourceId || nid === rEdge.targetId) continue
                  const node = layout.nodes[nid]!
                  const inside =
                    pt.x > node.x - node.width / 2 + 0.5 &&
                    pt.x < node.x + node.width / 2 - 0.5 &&
                    pt.y > node.y - node.height / 2 + 0.5 &&
                    pt.y < node.y + node.height / 2 - 0.5
                  expect(
                    inside,
                    `horizontal gutter path ${rEdge.id} crossed node ${nid} at (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`,
                  ).toBe(false)
                }
              }
            } else if (rawEdge.sourceId === MAP_ROOT_ID) {
              const rootLb = layout.nodes[MAP_ROOT_ID]?.labelBox
              if (rootLb) {
                for (const pt of pts) {
                  const insideLabel =
                    pt.x > rootLb.x + 0.5 &&
                    pt.x < rootLb.x + rootLb.width - 0.5 &&
                    pt.y > rootLb.y + 0.5 &&
                    pt.y < rootLb.y + rootLb.height - 0.5
                  expect(
                    insideLabel,
                    `radial root edge ${rEdge.id} pierced root labelBox at (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`,
                  ).toBe(false)
                }
              }
            }
          }
        },
      ),
      { numRuns: 60 },
    )
  })
})

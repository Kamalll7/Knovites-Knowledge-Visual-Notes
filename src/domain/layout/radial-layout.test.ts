import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  MAP_ROOT_ID,
  computeRadialLayout,
  computeVisible,
  resolveScreenZoomTier,
  type ComputeVisibleResult,
  type RadialLayoutResult,
  type TextMeasurerFn,
  type VisibleMapNode,
} from '@/domain/layout'
import { buildTree, type TreeBuildEntry } from '@/domain/tree'

const fixedWidthMeasure = (pxPerChar: number): TextMeasurerFn => {
  return (text) => text.length * pxPerChar
}

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
    isCollapsedWithChildren: partial.isCollapsedWithChildren ?? (partial.hiddenCount ?? 0) > 0,
    totalDescendants: partial.totalDescendants ?? 0,
    visibleDescendants: partial.visibleDescendants ?? 0,
    hiddenCount: partial.hiddenCount ?? 0,
    visibleChildIds: partial.visibleChildIds ?? [],
    ...partial,
  }
}

function buildSyntheticVisible(
  nodesList: VisibleMapNode[],
  focusId = MAP_ROOT_ID,
): ComputeVisibleResult {
  const nodes: Record<string, VisibleMapNode> = {}
  const childMap = new Map<string, string[]>()
  for (const n of nodesList) {
    nodes[n.id] = n
    if (n.parentId) {
      const list = childMap.get(n.parentId) ?? []
      list.push(n.id)
      childMap.set(n.parentId, list)
    }
  }
  for (const [parentId, ids] of childMap.entries()) {
    const parent = nodes[parentId]
    if (parent && parent.visibleChildIds.length === 0) {
      nodes[parentId] = { ...parent, visibleChildIds: ids }
    }
  }
  const totalSubtreeCounts: Record<string, number> = {}
  for (const n of nodesList) {
    totalSubtreeCounts[n.id] = n.totalDescendants
  }
  return {
    rootId: MAP_ROOT_ID,
    focusId,
    nodes,
    orderedIds: nodesList.map((n) => n.id),
    focusPathIds: new Set(nodesList.filter((n) => n.isOnFocusPath).map((n) => n.id)),
    totalSubtreeCounts,
  }
}

function makeStarVisible(
  rootChildrenCount: number,
  options?: { hiddenAtIndex?: ReadonlyMap<number, number>; nonRootChildrenCount?: number },
): ComputeVisibleResult {
  const nodes: VisibleMapNode[] = [
    makeVisibleNode({
      id: MAP_ROOT_ID,
      parentId: null,
      title: 'Root Hub',
      depth: 0,
      isOnFocusPath: true,
      isFocus: true,
    }),
  ]
  for (let i = 0; i < rootChildrenCount; i += 1) {
    const id = `c_${String(i).padStart(3, '0')}`
    const hidden = options?.hiddenAtIndex?.get(i) ?? 0
    nodes.push(
      makeVisibleNode({
        id,
        parentId: MAP_ROOT_ID,
        title: `Topic ${i + 1}`,
        depth: 1,
        order: `a${String(i).padStart(4, '0')}`,
        hiddenCount: hidden,
        totalDescendants: hidden,
      }),
    )
  }
  if (options?.nonRootChildrenCount && rootChildrenCount >= 1) {
    const parentId = 'c_000'
    for (let j = 0; j < options.nonRootChildrenCount; j += 1) {
      nodes.push(
        makeVisibleNode({
          id: `gc_${String(j).padStart(3, '0')}`,
          parentId,
          title: `Subtopic ${j + 1}`,
          depth: 2,
          order: `b${String(j).padStart(4, '0')}`,
        }),
      )
    }
  }
  return buildSyntheticVisible(nodes)
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Set || obj instanceof Map) return Object.freeze(obj)
  Object.freeze(obj)
  for (const val of Object.values(obj as Record<string, unknown>)) {
    deepFreeze(val)
  }
  return obj
}

function assertRadialInvariants(layout: RadialLayoutResult): void {
  expect(layout.rootId).toBe(MAP_ROOT_ID)
  expect(layout.diagnostics.overlapCount).toBe(0)
  const minGap = DEFAULT_RADIAL_LAYOUT_CONFIG.minGapPx
  const allNodes = Object.values(layout.nodes)
  const eps = 1e-6
  let crossingDetail = ''
  if (layout.diagnostics.edgeCrossingsCount > 0) {
    for (const e of layout.edges) {
      for (const n of allNodes) {
        if (n.id === e.sourceId || n.id === e.targetId) continue
        const minX = Math.min(n.x - n.width / 2, n.labelBox ? n.labelBox.x : n.x - n.width / 2)
        const maxX = Math.max(
          n.x + n.width / 2,
          n.labelBox ? n.labelBox.x + n.labelBox.width : n.x + n.width / 2,
        )
        const minY = Math.min(n.y - n.height / 2, n.labelBox ? n.labelBox.y : n.y - n.height / 2)
        const maxY = Math.max(
          n.y + n.height / 2,
          n.labelBox ? n.labelBox.y + n.labelBox.height : n.y + n.height / 2,
        )
        let t0 = 0
        let t1 = 1
        const dx = e.targetX - e.sourceX
        const dy = e.targetY - e.sourceY
        let hit = true
        for (const [p, q] of [
          [-dx, e.sourceX - minX],
          [dx, maxX - e.sourceX],
          [-dy, e.sourceY - minY],
          [dy, maxY - e.sourceY],
        ] as const) {
          if (p === 0) {
            if (q < 0) {
              hit = false
              break
            }
          } else {
            const r = q / p
            if (p < 0) {
              if (r > t1) {
                hit = false
                break
              }
              if (r > t0) t0 = r
            } else {
              if (r < t0) {
                hit = false
                break
              }
              if (r < t1) t1 = r
            }
          }
        }
        if (hit && t0 <= t1) {
          const src = layout.nodes[e.sourceId]!
          const dst = layout.nodes[e.targetId]!
          crossingDetail += `[${src.id}(d=${src.depth},r=${src.r.toFixed(0)},t=${src.theta.toFixed(2)})->${dst.id}(d=${dst.depth},r=${dst.r.toFixed(0)},t=${dst.theta.toFixed(2)}) hits ${n.id}(d=${n.depth},r=${n.r.toFixed(0)},t=${n.theta.toFixed(2)})]; `
        }
      }
    }
  }
  expect(
    layout.diagnostics.edgeCrossingsCount,
    `nodes=${layout.diagnostics.nodeCount} tier=${layout.tier} scale=${layout.scale} ${crossingDetail}`,
  ).toBe(0)

  for (const n of allNodes) {
    if (n.labelVisible) {
      expect(n.effectiveFontPx).toBeGreaterThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.minScreenFontPx)
    }
    if (n.id === layout.rootId) {
      expect(n.r).toBe(0)
      expect(n.x).toBe(0)
      expect(n.y).toBe(0)
    } else {
      // Clock-12 polar coordinate contract: x = r*sin(theta), y = -r*cos(theta)
      expect(Math.abs(n.x - n.r * Math.sin(n.theta))).toBeLessThan(1e-5)
      expect(Math.abs(n.y + n.r * Math.cos(n.theta))).toBeLessThan(1e-5)
      expect(n.theta).toBeGreaterThanOrEqual(n.wedgeStart - eps)
      expect(n.theta).toBeLessThanOrEqual(n.wedgeEnd + eps)

      if (n.parentId) {
        const parent = layout.nodes[n.parentId]!
        expect(n.r).toBeGreaterThan(parent.r)
        expect(n.theta).toBeGreaterThanOrEqual(parent.wedgeStart - eps)
        expect(n.theta).toBeLessThanOrEqual(parent.wedgeEnd + eps)
        if (parent.id !== layout.rootId) {
          const span = n.wedgeEnd - n.wedgeStart
          expect(span).toBeLessThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.maxNonRootFanRadians + 1e-6)
        }
      }
    }

    if (n.shape === 'capsule') {
      expect(n.width).toBeGreaterThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMinWidthPx)
      expect(n.width).toBeLessThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMaxWidthPx)
    }
  }

  for (let i = 0; i < allNodes.length; i += 1) {
    const a = allNodes[i]!
    const aBox = {
      x: Math.min(a.x - a.width / 2, a.labelBox ? a.labelBox.x : a.x - a.width / 2),
      y: Math.min(a.y - a.height / 2, a.labelBox ? a.labelBox.y : a.y - a.height / 2),
      maxX: Math.max(
        a.x + a.width / 2,
        a.labelBox ? a.labelBox.x + a.labelBox.width : a.x + a.width / 2,
      ),
      maxY: Math.max(
        a.y + a.height / 2,
        a.labelBox ? a.labelBox.y + a.labelBox.height : a.y + a.height / 2,
      ),
    }
    for (let j = i + 1; j < allNodes.length; j += 1) {
      const b = allNodes[j]!
      const bBox = {
        x: Math.min(b.x - b.width / 2, b.labelBox ? b.labelBox.x : b.x - b.width / 2),
        y: Math.min(b.y - b.height / 2, b.labelBox ? b.labelBox.y : b.y - b.height / 2),
        maxX: Math.max(
          b.x + b.width / 2,
          b.labelBox ? b.labelBox.x + b.labelBox.width : b.x + b.width / 2,
        ),
        maxY: Math.max(
          b.y + b.height / 2,
          b.labelBox ? b.labelBox.y + b.labelBox.height : b.y + b.height / 2,
        ),
      }
      const xSeparated = aBox.maxX + minGap <= bBox.x + 1e-6 || bBox.maxX + minGap <= aBox.x + 1e-6
      const ySeparated = aBox.maxY + minGap <= bBox.y + 1e-6 || bBox.maxY + minGap <= aBox.y + 1e-6
      expect(xSeparated || ySeparated).toBe(true)
    }
  }

  for (const edge of layout.edges) {
    const src = layout.nodes[edge.sourceId]!
    const dst = layout.nodes[edge.targetId]!
    expect(Math.hypot(edge.sourceX - src.x, edge.sourceY - src.y)).toBeGreaterThan(1)
    expect(Math.hypot(edge.targetX - dst.x, edge.targetY - dst.y)).toBeGreaterThan(1)
    if (src.shape === 'circle' && src.radius !== null) {
      expect(
        Math.abs(Math.hypot(edge.sourceX - src.x, edge.sourceY - src.y) - src.radius),
      ).toBeLessThan(1e-4)
    } else {
      const rx = Math.abs(edge.sourceX - src.x) / (src.width / 2)
      const ry = Math.abs(edge.sourceY - src.y) / (src.height / 2)
      expect(Math.abs(Math.max(rx, ry) - 1)).toBeLessThan(1e-4)
    }
    if (dst.shape === 'circle' && dst.radius !== null) {
      expect(
        Math.abs(Math.hypot(edge.targetX - dst.x, edge.targetY - dst.y) - dst.radius),
      ).toBeLessThan(1e-4)
    } else {
      const rx = Math.abs(edge.targetX - dst.x) / (dst.width / 2)
      const ry = Math.abs(edge.targetY - dst.y) / (dst.height / 2)
      expect(Math.abs(Math.max(rx, ry) - 1)).toBeLessThan(1e-4)
    }
  }
}

describe('computeRadialLayout (FR-MAP-03)', () => {
  it('enforces exact stagger thresholds at >= 12 (2 rings) and >= 34 (3 rings)', () => {
    const s11 = computeRadialLayout({
      visible: makeStarVisible(11),
      measureText: fixedWidthMeasure(8),
    })
    const s12 = computeRadialLayout({
      visible: makeStarVisible(12),
      measureText: fixedWidthMeasure(8),
    })
    const s33 = computeRadialLayout({
      visible: makeStarVisible(33),
      measureText: fixedWidthMeasure(8),
    })
    const s34 = computeRadialLayout({
      visible: makeStarVisible(34),
      measureText: fixedWidthMeasure(8),
    })

    expect(s11.nodes.c_000!.staggerRingCount).toBe(1)
    expect(s12.nodes.c_000!.staggerRingCount).toBe(2)
    expect(s12.nodes.c_001!.staggerIndex).toBe(1)
    expect(s33.nodes.c_000!.staggerRingCount).toBe(2)
    expect(s34.nodes.c_000!.staggerRingCount).toBe(3)
    expect(s34.nodes.c_002!.staggerIndex).toBe(2)
  })

  it('caps non-root child fan arc at <= 255 degrees even when parent owns a 360 degree wedge', () => {
    const visible = makeStarVisible(1, { nonRootChildrenCount: 6 })
    const layout = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(8),
      scale: 1,
      tier: 1,
    })

    const children = Object.values(layout.nodes).filter((n) => n.parentId === 'c_000')
    expect(children).toHaveLength(6)
    const minStart = Math.min(...children.map((c) => c.wedgeStart))
    const maxEnd = Math.max(...children.map((c) => c.wedgeEnd))
    const totalFanSpan = maxEnd - minStart
    expect(totalFanSpan).toBeLessThanOrEqual((255 * Math.PI) / 180 + 1e-6)
    expect(totalFanSpan).toBeCloseTo((255 * Math.PI) / 180, 5)
    assertRadialInvariants(layout)
  })

  it('allocates angular weight proportionally using 0.35 * log2(1 + hiddenCount)', () => {
    const visible = makeStarVisible(2, {
      hiddenAtIndex: new Map([
        [0, 15],
        [1, 0],
      ]),
    })
    const layout = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(8),
      scale: 1,
      tier: 1,
    })

    const c0 = layout.nodes.c_000!
    const c1 = layout.nodes.c_001!
    const span0 = c0.wedgeEnd - c0.wedgeStart
    const span1 = c1.wedgeEnd - c1.wedgeStart
    const expectedW0 = 1 + 0.35 * Math.log2(16)
    expect(c0.subtreeWeight).toBeCloseTo(expectedW0, 6)
    expect(c1.subtreeWeight).toBeCloseTo(1, 6)
    expect(span0 / span1).toBeCloseTo(expectedW0, 5)
  })

  it('uses injected measureText for adaptive capsule width and only truncates titles at the end', () => {
    const longTitle = 'Hyperbolic Geometry Fundamentals For Knowledge Graphs'
    const shortTitle = 'Alpha Beta Gamma'
    const visible = buildSyntheticVisible([
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({ id: 'a', parentId: MAP_ROOT_ID, title: shortTitle, depth: 1, order: 'a0' }),
      makeVisibleNode({ id: 'b', parentId: MAP_ROOT_ID, title: longTitle, depth: 1, order: 'a1' }),
    ])

    const narrow = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(4),
      scale: 1,
      tier: 1,
    })
    const wide = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(11),
      scale: 1,
      tier: 1,
    })

    expect(wide.nodes.a!.width).toBeGreaterThan(narrow.nodes.a!.width)
    expect(wide.nodes.a!.width).toBe(
      shortTitle.length * 11 + DEFAULT_RADIAL_LAYOUT_CONFIG.capsulePaddingXPx,
    )
    expect(wide.nodes.b!.width).toBeLessThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMaxWidthPx)
    expect(wide.nodes.b!.width).toBeGreaterThan(DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMinWidthPx)
    expect(wide.nodes.b!.isTruncated).toBe(true)
    expect(wide.nodes.b!.displayTitle.endsWith('…')).toBe(true)
    const preservedPrefix = wide.nodes.b!.displayTitle.slice(0, -1)
    expect(longTitle.startsWith(preservedPrefix)).toBe(true)
  })

  it('enforces minimum 11 px effective on-screen font across zoom scales and tiers', () => {
    const rLow = resolveScreenZoomTier(0.5, 2)
    expect(rLow.tier).toBe(0)
    expect(rLow.labelVisible).toBe(false)

    const rTier0Visible = resolveScreenZoomTier(0.8, 0)
    expect(rTier0Visible.tier).toBe(0)
    expect(rTier0Visible.labelVisible).toBe(true)
    expect(rTier0Visible.effectiveFontPx).toBeGreaterThanOrEqual(11)

    const visible = makeStarVisible(5)
    const layoutLow = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(8),
      scale: 0.4,
      tier: 2,
    })
    expect(layoutLow.tier).toBe(0)
    expect(layoutLow.diagnostics.hiddenLabelCount).toBe(layoutLow.diagnostics.nodeCount)
    assertRadialInvariants(layoutLow)
  })

  it('is completely deterministic and invariant to input node key, orderedIds, and visibleChildIds permutation', () => {
    const canonical = makeStarVisible(8, { hiddenAtIndex: new Map([[2, 7]]) })
    const reversedEntries = Object.entries(canonical.nodes)
      .reverse()
      .map(([id, n]) => [id, { ...n, visibleChildIds: [...n.visibleChildIds].reverse() }])
    const scrambled: ComputeVisibleResult = {
      ...canonical,
      orderedIds: [...canonical.orderedIds].reverse(),
      nodes: Object.fromEntries(reversedEntries),
    }

    const r1 = computeRadialLayout({
      visible: deepFreeze(canonical),
      measureText: fixedWidthMeasure(8),
    })
    const r2 = computeRadialLayout({
      visible: deepFreeze(scrambled),
      measureText: fixedWidthMeasure(8),
    })
    expect(r2).toEqual(r1)
  })

  it('validates all 5 mandatory datasets cleanly across tiers and measures large2000 compute time', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const datasetMap = createMandatoryDatasets()
    const datasets = Object.values(datasetMap)
    expect(datasets).toHaveLength(5)

    for (const ds of datasets) {
      const { state: tree } = buildTree(ds.entries)
      // Pick the node with the most children or deepest entry so visible sets exercise dense fans & paths.
      let richestFocus = ds.entries[Math.floor(ds.entries.length / 2)]?.node?.id ?? MAP_ROOT_ID
      let maxChildren = -1
      for (const n of Object.values(tree.nodes)) {
        if (n.childrenIds.length > maxChildren) {
          maxChildren = n.childrenIds.length
          richestFocus = n.id
        }
      }
      const deepFocus = ds.entries[ds.entries.length - 1]?.node?.id ?? MAP_ROOT_ID
      for (const focusTarget of [MAP_ROOT_ID, richestFocus, deepFocus]) {
        for (const [scale, tier] of [
          [1, 1] as const,
          [1, 2] as const,
          [0.85, 0] as const,
          [0.35, 0] as const,
        ]) {
          const visible = computeVisible({
            tree,
            rootTitle: ds.manifest.title,
            focusId: focusTarget,
            zoomTier: tier,
          })
          const layout = computeRadialLayout({
            visible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          assertRadialInvariants(layout)
        }
      }
    }

    const large = datasetMap.large2000
    const { state: largeTree } = buildTree(large.entries)
    const largeDeepFocus = large.entries[large.entries.length - 1]?.node?.id ?? MAP_ROOT_ID
    const largeVisible = computeVisible({
      tree: largeTree,
      rootTitle: large.manifest.title,
      focusId: largeDeepFocus,
      zoomTier: 2,
    })
    const times: number[] = []
    for (let i = 0; i < 5; i += 1) {
      computeRadialLayout({
        visible: largeVisible,
        measureText: fixedWidthMeasure(7.5),
        scale: 1,
        tier: 1,
      })
    }
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now()
      computeRadialLayout({
        visible: largeVisible,
        measureText: fixedWidthMeasure(7.5),
        scale: 1,
        tier: 1,
      })
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    const medianMs = Number(times[Math.floor(times.length / 2)]!.toFixed(3))
    console.info(
      `[T3_2A_RADIAL_TIMING] ${JSON.stringify({ large2000_visible: largeVisible.orderedIds.length, runs: times.length, medianMs, minMs: Number(times[0]!.toFixed(3)), maxMs: Number(times[times.length - 1]!.toFixed(3)) })}`,
    )
    expect(medianMs).toBeGreaterThanOrEqual(0)
  })

  it('satisfies radial invariants under fast-check randomized trees', () => {
    const specArb = fc.array(
      fc.record({
        parentPick: fc.nat(100),
        titleLen: fc.integer({ min: 2, max: 45 }),
        hiddenCount: fc.integer({ min: 0, max: 40 }),
      }),
      { minLength: 1, maxLength: 38 },
    )

    fc.assert(
      fc.property(specArb, (specs) => {
        const ids = [MAP_ROOT_ID]
        const list: VisibleMapNode[] = [
          makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
        ]
        const depths = new Map<string, number>([[MAP_ROOT_ID, 0]])

        specs.forEach((s, idx) => {
          const parentId = ids[s.parentPick % ids.length]!
          const depth = (depths.get(parentId) ?? 0) + 1
          const id = `n_${idx}`
          ids.push(id)
          depths.set(id, depth)
          list.push(
            makeVisibleNode({
              id,
              parentId,
              title: 'X'.repeat(s.titleLen),
              depth,
              order: `k_${String(idx).padStart(4, '0')}`,
              hiddenCount: s.hiddenCount,
              totalDescendants: s.hiddenCount,
            }),
          )
        })

        const visible = computeVisibleFromNodes(list)
        const layout = computeRadialLayout({
          visible,
          measureText: fixedWidthMeasure(8),
          scale: 1,
          tier: 1,
        })
        assertRadialInvariants(layout)
      }),
      { numRuns: 35 },
    )
  })
})

function computeVisibleFromNodes(list: VisibleMapNode[]): ComputeVisibleResult {
  const entries: TreeBuildEntry[] = list
    .filter((n) => n.id !== MAP_ROOT_ID)
    .map((n) => ({
      node: {
        schema: 1,
        id: n.id,
        parentId: n.parentId === MAP_ROOT_ID ? null : n.parentId,
        slug: n.id,
        title: n.title,
        type: 'concept',
        status: 'none',
        tags: [],
        order: n.order,
        color: null,
        links: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      path: n.id,
    }))
  const { state: tree } = buildTree(entries)
  const computed = computeVisible({
    tree,
    rootTitle: 'Root',
    focusId: MAP_ROOT_ID,
    zoomTier: 1,
  })
  // Inject hidden counts directly for testing hiddenWeightCoeff invariance cleanly.
  const nodes: Record<string, VisibleMapNode> = {}
  const hiddenById = new Map(list.map((n) => [n.id, n.hiddenCount]))
  for (const [id, v] of Object.entries(computed.nodes)) {
    const h = hiddenById.get(id) ?? v.hiddenCount
    nodes[id] = { ...v, hiddenCount: h, isCollapsedWithChildren: h > 0 }
  }
  return { ...computed, nodes }
}

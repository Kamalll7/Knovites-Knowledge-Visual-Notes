import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import DevMapRoute from '@/app/DevMapRoute'
import { ThemeProvider } from '@/app/ThemeProvider'
import { createDemoDataset, createMandatoryDatasets } from '@/domain/datasets'
import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  MAP_ROOT_ID,
  computeHorizontalLayout,
  computeRadialLayout,
  computeVisible,
  formatLayoutFont,
  type ComputeVisibleResult,
} from '@/domain/layout'
import { buildTree, type TreeBuildEntry } from '@/domain/tree'
import { computeMapBoundingBox } from '@/features/map/map-bounds'
import { MAP_CAPSULE_BOX_CONFIG, createCanvasTextMeasurer } from '@/features/map/map-measure'
import { MapSvgView } from '@/features/map/MapSvgView'

const measure75 = (text: string) => text.length * 7.5

function buildSampleVisible(options?: {
  childCount?: number
  zoomTier?: 0 | 1 | 2
  focusId?: string
}): ComputeVisibleResult {
  const count = options?.childCount ?? 3
  const entries: TreeBuildEntry[] = []
  for (let i = 0; i < count; i += 1) {
    const id = `n_${i}`
    const status = i === 0 ? 'learning' : i === 1 ? 'practiced' : i === 2 ? 'mastered' : 'none'
    const title =
      i === 0
        ? 'Very Long Concept Title Exceeding Maximum Capsule Width Budget Easily'
        : `Topic ${i + 1}`
    entries.push({
      node: {
        schema: 1,
        id,
        title,
        type: 'concept',
        status,
        tags: [],
        order: `k${String(i).padStart(4, '0')}`,
        color: i === 2 ? '#047857' : null,
        links: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      path: id,
    })
  }
  const { state: tree } = buildTree(entries)
  return computeVisible({
    tree,
    rootTitle: 'Sample Knowledge',
    focusId: options?.focusId ?? MAP_ROOT_ID,
    zoomTier: options?.zoomTier ?? 1,
  })
}

describe('MapSvgView, MapNodePill, MapEdges [T3.4b, FR-MAP-09, FR-MAP-12]', () => {
  it('renders empty state with Create first node button when only root exists', () => {
    const { state: emptyTree } = buildTree([])
    const visible = computeVisible({
      tree: emptyTree,
      rootTitle: 'Empty',
      focusId: MAP_ROOT_ID,
      zoomTier: 1,
    })
    const layout = computeRadialLayout({ visible, measureText: measure75, scale: 1, tier: 1 })
    const onCreate = vi.fn()

    render(
      <MemoryRouter>
        <MapSvgView
          layout={layout}
          visible={visible}
          orientation="radial"
          theme="dark"
          onCreateFirstNode={onCreate}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('map-empty-state')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Knowledge Map' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('create-first-node'))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('renders radial capsules, end-only truncation, status dots+icons, focus halo without <filter>, +N overflow, and wide-fan gradients', () => {
    const visible = buildSampleVisible({ childCount: 28, zoomTier: 1, focusId: MAP_ROOT_ID })
    const layout = computeRadialLayout({ visible, measureText: measure75, scale: 1, tier: 1 })
    const onSelect = vi.fn()
    const onOpen = vi.fn()

    const { container } = render(
      <MemoryRouter>
        <MapSvgView
          layout={layout}
          visible={visible}
          orientation="radial"
          theme="light"
          measureText={measure75}
          onSelectNode={onSelect}
          onOpenNode={onOpen}
        />
      </MemoryRouter>,
    )

    // Strictly ZERO <filter> elements anywhere in the SVG (Syarat M3 / FR-MAP-09)
    expect(container.querySelectorAll('filter')).toHaveLength(0)

    // Wide-fan (>= 12 children) creates linearGradient defs and marks edges with data-fade-base="true"
    const gradients = container.querySelectorAll('defs linearGradient')
    expect(gradients.length).toBeGreaterThanOrEqual(24)
    expect(container.querySelectorAll('[data-fade-base="true"]').length).toBeGreaterThanOrEqual(24)

    // Status indicators include BOTH dot and distinct icon glyph per status (learning, practiced, mastered)
    const iconPaths = new Set<string>()
    for (const status of ['learning', 'practiced', 'mastered'] as const) {
      const badge = screen.getByTestId(`node-status-${status}`)
      expect(badge.querySelector('[data-testid="status-dot"]')).not.toBeNull()
      const iconEl = badge.querySelector('[data-testid="status-icon"]')
      expect(iconEl).not.toBeNull()
      const d = iconEl?.getAttribute('d') ?? ''
      expect(d.length).toBeGreaterThan(0)
      iconPaths.add(d)
    }
    expect(iconPaths.size).toBe(3)

    // Long title truncated strictly at end (never leading ellipsis)
    const longNode = container.querySelector('[data-node-id="n_0"] [data-testid="map-node-label"]')
    expect(longNode?.textContent?.startsWith('Very Long')).toBe(true)
    expect(longNode?.textContent?.endsWith('…')).toBe(true)

    // Overflow +N bubble rendered for 28 children (> 24 maxChildrenShown -> +4)
    const overflowNode = container.querySelector('[data-node-kind="overflow"]')
    expect(overflowNode).not.toBeNull()
    expect(overflowNode?.textContent).toContain('+4')

    // Focus halo uses stroke element (no filter)
    expect(
      container.querySelectorAll('[data-testid="map-node-focus-halo"]').length,
    ).toBeGreaterThanOrEqual(1)

    // Click and double-click callbacks fire with node ID
    const node1 = container.querySelector('[data-node-id="n_1"]')!
    fireEvent.click(node1)
    fireEvent.doubleClick(node1)
    expect(onSelect).toHaveBeenCalledWith('n_1')
    expect(onOpen).toHaveBeenCalledWith('n_1')
  })

  it('renders Tier 0 external-label circles and works seamlessly with horizontal MapLayoutResult', () => {
    const visible = buildSampleVisible({ childCount: 4, zoomTier: 0, focusId: 'n_0' })
    const radialTier0 = computeRadialLayout({
      visible,
      measureText: measure75,
      scale: 0.85,
      tier: 0,
    })
    const { container: radialContainer } = render(
      <MemoryRouter>
        <MapSvgView
          layout={radialTier0}
          visible={visible}
          orientation="radial"
          theme="dark"
          measureText={measure75}
        />
      </MemoryRouter>,
    )
    expect(radialContainer.querySelectorAll('[data-node-shape="circle"]').length).toBe(5)
    expect(radialContainer.querySelectorAll('[data-testid="map-edge-focus-halo"]').length).toBe(1)

    const horLayout = computeHorizontalLayout({
      visible,
      measureText: measure75,
      scale: 1,
      tier: 1,
    })
    const { container: horContainer } = render(
      <MemoryRouter>
        <MapSvgView
          layout={horLayout}
          visible={visible}
          orientation="horizontal"
          theme="light"
          measureText={measure75}
        />
      </MemoryRouter>,
    )
    expect(horContainer.querySelector('[data-orientation="horizontal"]')).not.toBeNull()
    expect(horContainer.querySelectorAll('[data-testid="map-node"]').length).toBe(5)
    expect(horContainer.querySelectorAll('filter')).toHaveLength(0)
  })

  it('renders DevMapRoute diagnostic chip with passesUsed, overlapCount, edgeCrossings, maxRadiusPx, and nodeCount', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/__dev/map?dataset=root20Children&tier=1&mode=radial']}>
          <DevMapRoute />
        </MemoryRouter>
      </ThemeProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('dev-map-route')).toHaveAttribute('data-ready', 'true')
    })

    const diag = screen.getByTestId('dev-map-diagnostics')
    expect(Number(diag.dataset.nodeCount)).toBe(21)
    expect(Number(diag.dataset.passesUsed)).toBeGreaterThan(0)
    expect(Number(diag.dataset.overlapCount)).toBe(0)
    expect(Number(diag.dataset.edgeCrossings)).toBe(0)
    expect(Number(diag.dataset.maxRadiusPx)).toBeGreaterThan(0)
    expect(diag.textContent).toContain('nodes:21')
    expect(diag.textContent).toContain('overlaps:0')
  })

  it('includes external labelBox in computeMapBoundingBox and renders collapsed · N badge suffix', () => {
    const entries: TreeBuildEntry[] = [
      {
        node: {
          schema: 1,
          id: 'branch_a',
          title: 'Branch A',
          type: 'concept',
          status: 'none',
          tags: [],
          order: 'a0',
          color: null,
          links: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        path: 'branch_a',
      },
      ...Array.from({ length: 3 }, (_, idx) => ({
        node: {
          schema: 1 as const,
          id: `leaf_${idx}`,
          title: `Leaf ${idx}`,
          type: 'concept' as const,
          status: 'none' as const,
          tags: [],
          order: `b${idx}`,
          color: null,
          links: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        path: `branch_a/leaf_${idx}`,
      })),
    ]
    const { state: tree } = buildTree(entries)
    // Focus root at Tier 1 so branch_a is collapsed with hiddenCount === 3
    const visible = computeVisible({
      tree,
      rootTitle: 'Very Wide External Root Title Extending Beyond Circle Diameter',
      focusId: MAP_ROOT_ID,
      zoomTier: 1,
    })
    const layout = computeRadialLayout({ visible, measureText: measure75, scale: 1, tier: 1 })
    const rootNode = layout.nodes[MAP_ROOT_ID]!
    expect(rootNode.labelBox).not.toBeNull()

    // computeMapBoundingBox must include rootNode.labelBox on all four sides
    const bbox = computeMapBoundingBox({
      ...layout,
      orderedIds: [MAP_ROOT_ID],
      nodes: { [MAP_ROOT_ID]: rootNode },
    })
    expect(bbox.minX).toBeLessThanOrEqual(rootNode.labelBox!.x)
    expect(bbox.maxX).toBeGreaterThanOrEqual(rootNode.labelBox!.x + rootNode.labelBox!.width)
    expect(bbox.minY).toBeLessThanOrEqual(rootNode.labelBox!.y)
    expect(bbox.maxY).toBeGreaterThanOrEqual(rootNode.labelBox!.y + rootNode.labelBox!.height)

    // Collapsed branch_a must display `· 3` suffix in its rendered label
    const { container } = render(
      <MemoryRouter>
        <MapSvgView
          layout={layout}
          visible={visible}
          orientation="radial"
          theme="dark"
          measureText={measure75}
        />
      </MemoryRouter>,
    )
    const branchLabel = container.querySelector(
      '[data-node-id="branch_a"] [data-testid="map-node-label"]',
    )
    expect(branchLabel?.textContent).toContain('· 3')
  })

  it('never falsely truncates capsules below max width and keeps rendered font/chrome within capsule bounds across 6 datasets × 3 tiers × 2 modes [T3.4c-a]', () => {
    expect(MAP_CAPSULE_BOX_CONFIG.capsuleMaxWidthPx).toBe(
      DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMaxWidthPx,
    )
    expect(MAP_CAPSULE_BOX_CONFIG.capsuleMaxWidthPx).toBe(268)
    const demo = createDemoDataset()
    const mandatory = createMandatoryDatasets()
    const datasets = [
      { id: 'demo', title: demo.manifest.title, entries: demo.entries },
      ...Object.entries(mandatory).map(([id, ds]) => ({
        id,
        title: ds.manifest.title,
        entries: ds.entries,
      })),
    ]
    const measurer = createCanvasTextMeasurer({ context: null })
    const badgeFont = formatLayoutFont(
      MAP_CAPSULE_BOX_CONFIG.fonts.badgePx,
      MAP_CAPSULE_BOX_CONFIG.fonts,
    )

    let checkedCapsules = 0
    for (const ds of datasets) {
      const { state: tree } = buildTree([...ds.entries])
      for (const tier of [0, 1, 2] as const) {
        const scale = tier === 0 ? 0.85 : 1
        const visible = computeVisible({
          tree,
          rootTitle: ds.title,
          focusId: MAP_ROOT_ID,
          zoomTier: tier,
        })
        for (const orientation of ['radial', 'horizontal'] as const) {
          const layout =
            orientation === 'radial'
              ? computeRadialLayout({
                  visible,
                  measureText: measurer.measure,
                  scale,
                  tier,
                  config: MAP_CAPSULE_BOX_CONFIG,
                })
              : computeHorizontalLayout({
                  visible,
                  measureText: measurer.measure,
                  scale,
                  tier,
                  config: MAP_CAPSULE_BOX_CONFIG,
                })

          const { container, unmount } = render(
            <MemoryRouter>
              <MapSvgView
                layout={layout}
                visible={visible}
                orientation={orientation}
                theme="light"
                measureText={measurer.measure}
              />
            </MemoryRouter>,
          )

          for (const id of layout.orderedIds) {
            const ln = layout.nodes[id]!
            const vn = visible.nodes[id]!
            if (ln.shape !== 'capsule' || ln.kind === 'overflow') continue
            checkedCapsules += 1

            const nodeEl = container.querySelector(`[data-node-id="${id}"]`)!
            const labelEl = nodeEl.querySelector('[data-testid="map-node-label"]')!
            const renderedFontPx = Number(labelEl.getAttribute('font-size'))
            const renderedFontWeight = Number(labelEl.getAttribute('font-weight'))
            expect(renderedFontPx).toBe(ln.modelFontPx)
            expect(renderedFontWeight).toBe(DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.weight)

            const renderFontCss = `${renderedFontWeight} ${renderedFontPx}px ${MAP_CAPSULE_BOX_CONFIG.fonts.family}`
            const badgeReserve = vn.hiddenCount > 0 ? MAP_CAPSULE_BOX_CONFIG.capsuleMetaWidthPx : 0
            const maxTextW =
              MAP_CAPSULE_BOX_CONFIG.capsuleMaxWidthPx -
              MAP_CAPSULE_BOX_CONFIG.capsulePaddingXPx -
              badgeReserve
            const rawTitleW = measurer.measure(vn.title.trim(), renderFontCss)

            const badgeSuffix = vn.hiddenCount > 0 ? ` · ${vn.hiddenCount}` : ''
            const expectedText = `${ln.displayTitle}${badgeSuffix}`
            expect(labelEl.textContent).toBe(expectedText)

            if (ln.isTruncated) {
              // Truncation is legal ONLY when raw title exceeds the 268 px capsule text budget
              expect(
                rawTitleW,
                `${ds.id}/${orientation}/t${tier}/${id} truncated despite fitting (${rawTitleW} <= ${maxTextW})`,
              ).toBeGreaterThan(maxTextW)
            } else {
              // Untruncated layout node MUST render full title without any secondary ellipsis
              expect(ln.displayTitle).toBe(vn.title.trim())
              expect(rawTitleW).toBeLessThanOrEqual(maxTextW)
            }

            // Rendered text + badge + chrome (status & padding) must fit strictly inside capsule width
            const titleW = measurer.measure(ln.displayTitle, renderFontCss)
            const badgeW = badgeSuffix ? measurer.measure(badgeSuffix, badgeFont) : 0
            const horizontalChrome = vn.status !== 'none' ? 36 : 20
            expect(
              titleW + badgeW + horizontalChrome,
              `${ds.id}/${orientation}/t${tier}/${id} text+chrome exceeds width ${ln.width}`,
            ).toBeLessThanOrEqual(ln.width + 0.5)
          }
          unmount()
        }
      }
    }
    expect(checkedCapsules).toBeGreaterThan(100)
  })
})

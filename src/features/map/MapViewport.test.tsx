import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { MAP_ROOT_ID, computeRadialLayout, computeVisible } from '@/domain/layout'
import { buildTree, type TreeBuildEntry } from '@/domain/tree'
import { MapHudControls } from '@/features/map/MapHudControls'
import { MapViewport } from '@/features/map/MapViewport'
import { MAP_CAPSULE_BOX_CONFIG, createCanvasTextMeasurer } from '@/features/map/map-measure'

function buildLongTitleSample() {
  const entries: TreeBuildEntry[] = [
    {
      node: {
        schema: 1,
        id: 'long_node',
        title:
          'Extremely Long Vulnerability Research Concept Title Exceeding Maximum Capsule Budget',
        type: 'concept',
        status: 'practiced',
        tags: [],
        order: 'a0',
        color: null,
        links: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      path: 'long_node',
    },
    {
      node: {
        schema: 1,
        id: 'short_node',
        title: 'Short Topic',
        type: 'concept',
        status: 'none',
        tags: [],
        order: 'a1',
        color: null,
        links: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      path: 'short_node',
    },
  ]
  const { state: tree } = buildTree(entries)
  const visible = computeVisible({
    tree,
    rootTitle: 'Test Root',
    focusId: MAP_ROOT_ID,
    zoomTier: 1,
  })
  const measurer = createCanvasTextMeasurer({ context: null })
  const layout = computeRadialLayout({
    visible,
    measureText: measurer.measure,
    scale: 1,
    tier: 1,
    config: MAP_CAPSULE_BOX_CONFIG,
  })
  return { visible, layout, measurer }
}

describe('MapViewport & MapHudControls [T3.5, FR-MAP-05, FR-MAP-06, FR-MAP-08, FR-MAP-09]', () => {
  it('renders HUD controls and fires orientation, zoom, fit, and recenter callbacks', () => {
    const onOrientationChange = vi.fn()
    const onZoomIn = vi.fn()
    const onZoomOut = vi.fn()
    const onFitAll = vi.fn()
    const onRecenterFocus = vi.fn()

    render(
      <MapHudControls
        orientation="radial"
        zoomScale={1.2}
        zoomTier={2}
        onOrientationChange={onOrientationChange}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFitAll={onFitAll}
        onRecenterFocus={onRecenterFocus}
      />,
    )

    expect(screen.getByTestId('map-zoom-chip').textContent).toBe('120% · T2')
    expect(screen.getByTestId('map-orientation-radial')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('map-orientation-horizontal'))
    expect(onOrientationChange).toHaveBeenCalledWith('horizontal')

    fireEvent.click(screen.getByTestId('map-zoom-in'))
    fireEvent.click(screen.getByTestId('map-zoom-out'))
    fireEvent.click(screen.getByTestId('map-fit'))
    fireEvent.click(screen.getByTestId('map-recenter'))
    expect(onZoomIn).toHaveBeenCalledTimes(1)
    expect(onZoomOut).toHaveBeenCalledTimes(1)
    expect(onFitAll).toHaveBeenCalledTimes(1)
    expect(onRecenterFocus).toHaveBeenCalledTimes(1)
  })

  it('shows full-title hover tooltip on truncated nodes without <filter> and fires click/double-click callbacks', () => {
    const { visible, layout, measurer } = buildLongTitleSample()
    const onSelect = vi.fn()
    const onOpen = vi.fn()

    const { container } = render(
      <MemoryRouter>
        <MapViewport
          layout={layout}
          visible={visible}
          focusId={MAP_ROOT_ID}
          orientation="radial"
          theme="dark"
          measureText={measurer.measure}
          onSelectNode={onSelect}
          onOpenNode={onOpen}
        />
      </MemoryRouter>,
    )

    expect(container.querySelectorAll('filter')).toHaveLength(0)
    expect(screen.queryByTestId('map-hover-tooltip')).toBeNull()

    const longNode = container.querySelector('[data-node-id="long_node"]')!
    fireEvent.mouseEnter(longNode)
    const tooltip = screen.getByTestId('map-hover-tooltip')
    expect(tooltip.textContent).toBe(
      'Extremely Long Vulnerability Research Concept Title Exceeding Maximum Capsule Budget',
    )
    expect(longNode).toHaveAttribute('data-hovered', 'true')

    fireEvent.mouseLeave(longNode)
    expect(screen.queryByTestId('map-hover-tooltip')).toBeNull()

    fireEvent.click(longNode)
    fireEvent.doubleClick(longNode)
    expect(onSelect).toHaveBeenCalledWith('long_node')
    expect(onOpen).toHaveBeenCalledWith('long_node')
  })
})

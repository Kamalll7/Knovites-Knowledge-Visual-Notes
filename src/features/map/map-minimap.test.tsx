import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { computeRadialLayout, computeVisible, MAP_ROOT_ID } from '@/domain/layout'
import type { NodeJson } from '@/domain/schema'
import { buildTree } from '@/domain/tree'
import { MapMinimap, type MapMinimapHandle } from '@/features/map/MapMinimap'
import { computeMapBoundingBox } from '@/features/map/map-bounds'
import { centerCameraOnWorldPoint } from '@/features/map/map-camera'
import {
  MINIMAP_HEIGHT_PX,
  MINIMAP_WIDTH_PX,
  computeCameraForMinimapPoint,
  computeMinimapProjection,
  computeMinimapViewportRect,
  minimapToWorldPoint,
  worldToMinimapPoint,
} from '@/features/map/map-minimap'

function makeMeta(id: string, title: string, order: string): NodeJson {
  return {
    schema: 1,
    id,
    title,
    type: 'concept',
    status: 'none',
    tags: [],
    order,
    color: null,
    links: [],
    createdAt: '2026-11-27T00:00:00Z',
    updatedAt: '2026-11-27T00:00:00Z',
  }
}

function buildSampleLayout() {
  const idA = '01JC8ZQ4M7X2K9T50000000001'
  const idB = '01JC8ZQ4M7X2K9T50000000002'
  const idC = '01JC8ZQ4M7X2K9T50000000003'
  const built = buildTree([
    { path: 'pwn', node: makeMeta(idA, 'PWN', 'a0'), hasCanvas: true },
    { path: 'pwn/stack', node: makeMeta(idB, 'Stack', 'a0'), hasCanvas: true },
    { path: 're', node: makeMeta(idC, 'RE', 'a1'), hasCanvas: true },
  ])
  const visible = computeVisible({
    tree: built.state,
    rootTitle: 'Home',
    focusId: MAP_ROOT_ID,
    zoomTier: 2,
  })
  const layout = computeRadialLayout({
    visible,
    measureText: (t) => t.length * 7.5,
    scale: 1,
    tier: 2,
  })
  const bbox = computeMapBoundingBox(layout)
  return { visible, layout, bbox }
}

describe('map-minimap geometry and MapMinimap component [T3.9a, FR-MAP-13]', () => {
  it('round-trips world <-> minimap coordinates accurately', () => {
    const { bbox } = buildSampleLayout()
    const proj = computeMinimapProjection(bbox, MINIMAP_WIDTH_PX, MINIMAP_HEIGHT_PX)

    const sampleWorld = [
      { x: bbox.minX, y: bbox.minY },
      { x: bbox.maxX, y: bbox.maxY },
      { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 },
      { x: 120, y: -85 },
    ]

    for (const pt of sampleWorld) {
      const mini = worldToMinimapPoint(pt.x, pt.y, proj)
      const back = minimapToWorldPoint(mini.x, mini.y, proj)
      expect(back.x).toBeCloseTo(pt.x, 5)
      expect(back.y).toBeCloseTo(pt.y, 5)
    }

    // Center of bbox maps directly to center of minimap
    const centerMini = worldToMinimapPoint(
      (bbox.minX + bbox.maxX) / 2,
      (bbox.minY + bbox.maxY) / 2,
      proj,
    )
    expect(centerMini.x).toBeCloseTo(MINIMAP_WIDTH_PX / 2, 5)
    expect(centerMini.y).toBeCloseTo(MINIMAP_HEIGHT_PX / 2, 5)
  })

  it('scales and shifts viewport rect accurately across zoom levels (k !== 1) and pan offsets', () => {
    const bbox = { minX: -500, minY: -400, maxX: 500, maxY: 400, width: 1000, height: 800 }
    const proj = computeMinimapProjection(bbox, 200, 140, 10)

    const rectK1 = computeMinimapViewportRect({ x: 640, y: 360, k: 1 }, 1280, 720, proj)
    const rectK2 = computeMinimapViewportRect({ x: 640, y: 360, k: 2 }, 1280, 720, proj)
    const rectPanned = computeMinimapViewportRect({ x: 440, y: 260, k: 2 }, 1280, 720, proj)

    // At k=2 the visible world window is half as wide & tall as at k=1
    expect(rectK2.rawWidth).toBeCloseTo(rectK1.rawWidth / 2, 5)
    expect(rectK2.rawHeight).toBeCloseTo(rectK1.rawHeight / 2, 5)
    expect(rectK2.width).toBeLessThan(rectK1.width)
    expect(rectK2.height).toBeLessThan(rectK1.height)

    // Panning camera left/up shifts the visible world window right/down
    expect(rectPanned.rawX).toBeGreaterThan(rectK2.rawX)
    expect(rectPanned.rawY).toBeGreaterThan(rectK2.rawY)
  })

  it('maps minimap click to world-centered camera preserving zoom k and clamping edge clicks', () => {
    const bbox = { minX: -600, minY: -400, maxX: 600, maxY: 400, width: 1200, height: 800 }
    const proj = computeMinimapProjection(bbox, 200, 140, 10)

    // Click at world (150, -90) projected onto minimap with k = 1.5
    const clickMini = worldToMinimapPoint(150, -90, proj)
    const cam = computeCameraForMinimapPoint(clickMini.x, clickMini.y, proj, 1.5, 1280, 720)
    expect(cam.k).toBeCloseTo(1.5, 5)
    // Screen center (640, 360) must correspond to world (150, -90)
    expect((640 - cam.x) / cam.k).toBeCloseTo(150, 3)
    expect((360 - cam.y) / cam.k).toBeCloseTo(-90, 3)

    // Extreme far-off click is clamped to reachable map bounds while preserving k
    const extreme = centerCameraOnWorldPoint(50_000, -50_000, 1.25, 1280, 720, bbox)
    expect(extreme.k).toBeCloseTo(1.25, 5)
    expect(Math.abs(extreme.x)).toBeLessThan(10_000)
    expect(Math.abs(extreme.y)).toBeLessThan(10_000)
  })

  it('renders MapMinimap with zero <filter>, updates viewport rect via ref, toggles visibility, and stops pointer/wheel propagation', () => {
    const { visible, layout, bbox } = buildSampleLayout()
    const onNavigate = vi.fn()
    const parentPointerDown = vi.fn()
    const parentWheel = vi.fn()
    const minimapRef = createRef<MapMinimapHandle>()

    const { container } = render(
      <div onPointerDown={parentPointerDown} onWheel={parentWheel}>
        <MapMinimap
          ref={minimapRef}
          layout={layout}
          visible={visible}
          bbox={bbox}
          theme="dark"
          onNavigateWorldPoint={onNavigate}
        />
      </div>,
    )

    const svg = screen.getByTestId('map-minimap-svg')
    expect(container.querySelectorAll('filter')).toHaveLength(0)

    // Imperative ref update moves viewport rect without React re-render
    minimapRef.current?.updateViewportRect({ x: 600, y: 300, k: 1.5 }, { width: 1200, height: 700 })
    const vpRect = screen.getByTestId('map-minimap-viewport-rect')
    const initialW = Number(vpRect.getAttribute('width'))
    expect(initialW).toBeGreaterThan(0)
    expect(Number(vpRect.getAttribute('height'))).toBeGreaterThan(0)

    // Mock SVG bounding rect, click & drag minimap -> invokes onNavigateWorldPoint and never leaks to parent
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: MINIMAP_WIDTH_PX,
      bottom: MINIMAP_HEIGHT_PX,
      width: MINIMAP_WIDTH_PX,
      height: MINIMAP_HEIGHT_PX,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(svg, { clientX: MINIMAP_WIDTH_PX / 2, clientY: MINIMAP_HEIGHT_PX / 2 })
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate.mock.calls[0]?.[2]).toEqual({ immediate: false })

    fireEvent.pointerMove(svg, {
      clientX: MINIMAP_WIDTH_PX * 0.75,
      clientY: MINIMAP_HEIGHT_PX * 0.25,
    })
    expect(onNavigate).toHaveBeenCalledTimes(2)
    expect(onNavigate.mock.calls[1]?.[2]).toEqual({ immediate: true })
    fireEvent.pointerUp(svg)

    fireEvent.wheel(screen.getByTestId('map-minimap'), { deltaY: -120 })
    expect(parentPointerDown).not.toHaveBeenCalled()
    expect(parentWheel).not.toHaveBeenCalled()

    // Collapse & expand minimap via toggle button -> restores last viewport rect
    fireEvent.click(screen.getByTestId('map-minimap-toggle'))
    expect(screen.queryByTestId('map-minimap-svg')).toBeNull()
    fireEvent.click(screen.getByTestId('map-minimap-toggle'))
    expect(screen.getByTestId('map-minimap-svg')).toBeInTheDocument()
    expect(
      Number(screen.getByTestId('map-minimap-viewport-rect').getAttribute('width')),
    ).toBeCloseTo(initialW, 1)
  })
})

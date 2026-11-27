import { ChevronDown, Map as MapIcon } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ComputeVisibleResult, MapLayoutResult } from '@/domain/layout'
import type { MapBoundingBox } from '@/features/map/map-bounds'
import type { CameraTransform } from '@/features/map/map-camera'
import {
  MAP_THEME_PALETTES,
  assignMapNodeColors,
  type MapThemeMode,
} from '@/features/map/map-colors'
import {
  MINIMAP_HEIGHT_PX,
  MINIMAP_WIDTH_PX,
  computeMinimapProjection,
  computeMinimapViewportRect,
  minimapToWorldPoint,
  worldToMinimapPoint,
} from '@/features/map/map-minimap'

export interface MapMinimapHandle {
  /** Updates the minimap viewport rectangle directly via SVG DOM ref (0 React re-renders). */
  updateViewportRect: (
    camera: CameraTransform,
    viewport: { width: number; height: number },
  ) => void
}

export interface MapMinimapProps {
  readonly layout: MapLayoutResult
  readonly visible: ComputeVisibleResult
  readonly bbox: MapBoundingBox
  readonly theme: MapThemeMode
  readonly onNavigateWorldPoint: (
    worldX: number,
    worldY: number,
    options?: { immediate?: boolean },
  ) => void
}

/**
 * Bottom-right interactive overview minimap (`FR-MAP-13`).
 * Updates its viewport rect via DOM ref (zero per-frame React re-renders), uses zero `<filter>`,
 * and stops pointer/wheel propagation so events never leak to `d3-zoom`.
 */
export const MapMinimap = forwardRef<MapMinimapHandle, MapMinimapProps>(function MapMinimap(
  { layout, visible, bbox, theme, onNavigateWorldPoint },
  ref,
) {
  const [collapsed, setCollapsed] = useState(false)
  const palette = MAP_THEME_PALETTES[theme]
  const viewportRectRef = useRef<SVGRectElement | null>(null)
  const draggingRef = useRef(false)
  const lastCameraRef = useRef<{
    camera: CameraTransform
    viewport: { width: number; height: number }
  } | null>(null)

  const projection = useMemo(
    () => computeMinimapProjection(bbox, MINIMAP_WIDTH_PX, MINIMAP_HEIGHT_PX),
    [bbox],
  )
  const projectionRef = useRef(projection)
  const nodeColors = useMemo(() => assignMapNodeColors(visible, theme), [visible, theme])

  const applyViewportRect = useCallback(
    (camera: CameraTransform, viewport: { width: number; height: number }) => {
      lastCameraRef.current = { camera, viewport }
      const rectEl = viewportRectRef.current
      if (!rectEl) return
      const rect = computeMinimapViewportRect(
        camera,
        viewport.width,
        viewport.height,
        projectionRef.current,
      )
      rectEl.setAttribute('x', rect.x.toFixed(2))
      rectEl.setAttribute('y', rect.y.toFixed(2))
      rectEl.setAttribute('width', rect.width.toFixed(2))
      rectEl.setAttribute('height', rect.height.toFixed(2))
    },
    [],
  )

  useLayoutEffect(() => {
    projectionRef.current = projection
    if (!collapsed && lastCameraRef.current) {
      applyViewportRect(lastCameraRef.current.camera, lastCameraRef.current.viewport)
    }
  }, [applyViewportRect, collapsed, projection])

  useImperativeHandle(ref, () => ({ updateViewportRect: applyViewportRect }), [applyViewportRect])

  const navigateFromPointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>, immediate: boolean) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const miniX = ((event.clientX - rect.left) / rect.width) * MINIMAP_WIDTH_PX
      const miniY = ((event.clientY - rect.top) / rect.height) * MINIMAP_HEIGHT_PX
      const world = minimapToWorldPoint(miniX, miniY, projectionRef.current)
      onNavigateWorldPoint(world.x, world.y, { immediate })
    },
    [onNavigateWorldPoint],
  )

  const handleSvgPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      event.stopPropagation()
      event.preventDefault()
      draggingRef.current = true
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId)
      } catch {
        // Synthetic jsdom pointer events may lack an active pointerId.
      }
      navigateFromPointer(event, false)
    },
    [navigateFromPointer],
  )

  const handleSvgPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!draggingRef.current) return
      event.stopPropagation()
      navigateFromPointer(event, true)
    },
    [navigateFromPointer],
  )

  const handleSvgPointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    event.stopPropagation()
    draggingRef.current = false
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }
    } catch {
      // Ignore synthetic event cleanup errors.
    }
  }, [])

  const { edgeLines, nodeDots } = useMemo(() => {
    const posMap = new Map<string, { x: number; y: number }>()
    for (const id of layout.orderedIds) {
      const n = layout.nodes[id]
      if (n) posMap.set(id, worldToMinimapPoint(n.x, n.y, projection))
    }
    const lines: { id: string; x1: number; y1: number; x2: number; y2: number }[] = []
    const dots: { id: string; x: number; y: number; r: number; fill: string; focus: boolean }[] = []
    for (const id of layout.orderedIds) {
      const pos = posMap.get(id)
      const vNode = visible.nodes[id]
      if (!pos || !vNode) continue
      const parentPos = vNode.parentId ? posMap.get(vNode.parentId) : undefined
      if (parentPos) {
        lines.push({ id: `${vNode.parentId}->${id}`, x1: parentPos.x, y1: parentPos.y, x2: pos.x, y2: pos.y })
      }
      const isOverflow = vNode.kind === 'overflow'
      dots.push({
        id,
        x: pos.x,
        y: pos.y,
        r: vNode.isFocus ? 3.5 : vNode.kind === 'root' ? 3.1 : isOverflow ? 1.8 : 2.3,
        fill: isOverflow ? palette.fgMuted : (nodeColors.get(id)?.accentHex ?? palette.accent),
        focus: vNode.isFocus,
      })
    }
    return { edgeLines: lines, nodeDots: dots }
  }, [layout, nodeColors, palette.accent, palette.fgMuted, projection, visible])

  return (
    <aside
      aria-label="Map minimap"
      data-testid="map-minimap"
      data-collapsed={collapsed ? 'true' : 'false'}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute right-3 bottom-3 z-20 overflow-hidden rounded-lg border border-border bg-card/95 shadow-md backdrop-blur-sm"
    >
      {collapsed ? (
        <button
          type="button"
          data-testid="map-minimap-toggle"
          aria-expanded={false}
          aria-label="Show minimap"
          onClick={() => setCollapsed(false)}
          className="inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <MapIcon className="size-3.5" aria-hidden="true" />
          <span>Minimap</span>
        </button>
      ) : (
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border/80 px-2 py-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <MapIcon className="size-3" aria-hidden="true" />
              <span>Minimap</span>
            </span>
            <button
              type="button"
              data-testid="map-minimap-toggle"
              aria-expanded={true}
              aria-label="Hide minimap"
              onClick={() => setCollapsed(true)}
              className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <svg
            role="application"
            aria-label="Minimap overview: click or drag to pan viewport"
            data-testid="map-minimap-svg"
            width={MINIMAP_WIDTH_PX}
            height={MINIMAP_HEIGHT_PX}
            viewBox={`0 0 ${MINIMAP_WIDTH_PX} ${MINIMAP_HEIGHT_PX}`}
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onPointerCancel={handleSvgPointerUp}
            className="block cursor-crosshair select-none"
            style={{ backgroundColor: palette.bg, touchAction: 'none' }}
          >
            <g data-testid="map-minimap-edges" pointerEvents="none">
              {edgeLines.map((line) => (
                <line
                  key={line.id}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={palette.border}
                  strokeWidth={1}
                  strokeOpacity={0.85}
                />
              ))}
            </g>
            <g data-testid="map-minimap-nodes" pointerEvents="none">
              {nodeDots.map((dot) => (
                <circle
                  key={dot.id}
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.r}
                  fill={dot.fill}
                  stroke={dot.focus ? palette.fg : undefined}
                  strokeWidth={dot.focus ? 1.2 : undefined}
                />
              ))}
            </g>
            <rect
              ref={viewportRectRef}
              data-testid="map-minimap-viewport-rect"
              x={1}
              y={1}
              width={MINIMAP_WIDTH_PX - 2}
              height={MINIMAP_HEIGHT_PX - 2}
              rx={2}
              fill={palette.accent}
              fillOpacity={theme === 'dark' ? 0.16 : 0.12}
              stroke={palette.accent}
              strokeWidth={1.5}
              pointerEvents="none"
            />
          </svg>
        </div>
      )}
    </aside>
  )
})

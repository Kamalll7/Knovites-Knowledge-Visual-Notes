import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  type ComputeVisibleResult,
  type MapLayoutResult,
  type TextMeasurerFn,
  type ZoomTier,
} from '@/domain/layout'
import { MapEdges, type EdgeDomRefs } from '@/features/map/MapEdges'
import { MapNodePill } from '@/features/map/MapNodePill'
import { MapSvgView } from '@/features/map/MapSvgView'
import { computeMapBoundingBox } from '@/features/map/map-bounds'
import type { CameraHudInsets, CameraTransform } from '@/features/map/map-camera'
import {
  MAP_THEME_PALETTES,
  assignMapNodeColors,
  type MapThemeMode,
} from '@/features/map/map-colors'
import { buildRenderedMapEdges, type MapEdgeOrientation } from '@/features/map/map-edge-path'
import { useMapViewportController } from '@/features/map/useMapViewportController'
import { en } from '@/i18n/en'

export interface MapViewportHandle {
  zoomIn: () => void
  zoomOut: () => void
  fitAll: () => void
  recenterFocus: () => void
  panToWorldPoint: (worldX: number, worldY: number, options?: { immediate?: boolean }) => void
  getTransform: () => CameraTransform
}

export interface MapViewportProps {
  readonly layout: MapLayoutResult
  readonly visible: ComputeVisibleResult
  readonly focusId: string
  readonly orientation: MapEdgeOrientation
  readonly theme: MapThemeMode
  readonly measureText?: TextMeasurerFn
  readonly hudInsets?: CameraHudInsets
  readonly keyboardFocusActive?: boolean
  readonly onSelectNode?: (nodeId: string) => void
  readonly onOpenNode?: (nodeId: string) => void
  readonly onCreateFirstNode?: () => void
  readonly onScaleTierChange?: (scale: number, tier: ZoomTier) => void
  readonly onFrameSample?: (dtMs: number) => void
  readonly onCameraChange?: (
    transform: CameraTransform,
    viewport: { width: number; height: number },
  ) => void
}

/**
 * Interactive pan/zoom/animated SVG map viewport (`T3.5`, `FR-MAP-05`, `FR-MAP-06`, `FR-MAP-08`, `FR-MAP-17`).
 * Delegates DOM-ref pan/zoom/RAF transitions to `useMapViewportController` and renders zero `<filter>`.
 */
export const MapViewport = forwardRef<MapViewportHandle, MapViewportProps>(function MapViewport(
  {
    layout,
    visible,
    focusId,
    orientation,
    theme,
    measureText,
    hudInsets,
    keyboardFocusActive = false,
    onSelectNode,
    onOpenNode,
    onCreateFirstNode,
    onScaleTierChange,
    onFrameSample,
    onCameraChange,
  },
  ref,
) {
  const palette = MAP_THEME_PALETTES[theme]
  const nonRootCount = visible.orderedIds.filter((id) => visible.nodes[id]?.kind !== 'root').length

  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const cameraGroupRef = useRef<SVGGElement | null>(null)
  const nodeGroupRefs = useRef<Map<string, SVGGElement>>(new Map())
  const edgeRefs = useRef<Map<string, EdgeDomRefs>>(new Map())

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const nodeColors = useMemo(() => assignMapNodeColors(visible, theme), [visible, theme])
  const renderedEdges = useMemo(
    () => buildRenderedMapEdges(layout, visible, orientation),
    [layout, visible, orientation],
  )
  const bbox = useMemo(() => computeMapBoundingBox(layout), [layout])

  const controls = useMapViewportController({
    containerRef,
    svgRef,
    cameraGroupRef,
    nodeGroupRefs,
    edgeRefs,
    layout,
    visible,
    renderedEdges,
    bbox,
    focusId,
    orientation,
    nonRootCount,
    hudInsets,
    onScaleTierChange,
    onFrameSample,
    onCameraChange,
  })

  useImperativeHandle(ref, () => controls, [controls])

  if (nonRootCount === 0) {
    return (
      <MapSvgView
        layout={layout}
        visible={visible}
        orientation={orientation}
        theme={theme}
        measureText={measureText}
        onCreateFirstNode={onCreateFirstNode}
      />
    )
  }

  const hoveredLayoutNode = hoveredNodeId ? layout.nodes[hoveredNodeId] : undefined
  const hoveredVisibleNode = hoveredNodeId ? visible.nodes[hoveredNodeId] : undefined
  const showHoverTooltip =
    Boolean(hoveredLayoutNode && hoveredVisibleNode) &&
    (hoveredLayoutNode!.isTruncated || !hoveredLayoutNode!.labelVisible)
  const tooltipText = hoveredVisibleNode?.title ?? ''
  const tooltipFontPx = DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.tier2Px
  const tooltipW = Math.max(
    84,
    Math.ceil(
      (measureText
        ? measureText(
            tooltipText,
            `${DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.weight} ${tooltipFontPx}px ${DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.family}`,
          )
        : tooltipText.length * 8) + 20,
    ),
  )

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      aria-label={en.map.title}
      data-testid="map-viewport"
      data-orientation={orientation}
      data-tier={layout.tier}
      data-keyboard-focus={keyboardFocusActive ? 'true' : 'false'}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <h1 className="sr-only">{en.map.title}</h1>
      <svg
        ref={svgRef}
        role="img"
        aria-label={en.map.title}
        data-testid="map-svg"
        className="absolute inset-0 block h-full w-full cursor-grab select-none active:cursor-grabbing"
        style={{ backgroundColor: palette.bg, touchAction: 'none' }}
      >
        <g ref={cameraGroupRef} data-testid="map-camera-group">
          <MapEdges
            edges={renderedEdges}
            nodeColors={nodeColors}
            fallbackStroke={palette.accent}
            edgeRefs={edgeRefs}
          />
          <g data-testid="map-nodes">
            {layout.orderedIds.map((id) => {
              const layoutNode = layout.nodes[id]
              const visibleNode = visible.nodes[id]
              const colors = nodeColors.get(id)
              if (!layoutNode || !visibleNode || !colors) return null
              return (
                <MapNodePill
                  key={id}
                  layoutNode={layoutNode}
                  visibleNode={visibleNode}
                  colors={colors}
                  theme={theme}
                  measureText={measureText}
                  isHovered={hoveredNodeId === id}
                  isKeyboardFocused={keyboardFocusActive && visibleNode.isFocus}
                  onSelect={onSelectNode}
                  onOpen={onOpenNode}
                  onHoverStart={setHoveredNodeId}
                  onHoverEnd={(nodeId) =>
                    setHoveredNodeId((prev) => (prev === nodeId ? null : prev))
                  }
                  groupRef={(el) => {
                    if (el) nodeGroupRefs.current.set(id, el)
                    else nodeGroupRefs.current.delete(id)
                  }}
                />
              )
            })}
          </g>
          {showHoverTooltip && hoveredLayoutNode ? (
            <g
              data-testid="map-hover-tooltip"
              pointerEvents="none"
              transform={`translate(${hoveredLayoutNode.x}, ${hoveredLayoutNode.y - hoveredLayoutNode.height / 2 - 22})`}
            >
              <rect
                x={-tooltipW / 2}
                y={-14}
                width={tooltipW}
                height={28}
                rx={8}
                fill={palette.surface2}
                stroke={palette.border}
                strokeWidth={1}
              />
              <text
                x={0}
                y={0}
                textAnchor="middle"
                dominantBaseline="central"
                fill={palette.fg}
                fontSize={tooltipFontPx}
                fontWeight={DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.weight}
                fontFamily={DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.family}
              >
                {tooltipText}
              </text>
            </g>
          ) : null}
        </g>
      </svg>
    </div>
  )
})

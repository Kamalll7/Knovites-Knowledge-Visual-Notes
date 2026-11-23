import { useMemo } from 'react'
import { Link } from 'react-router'
import type { ComputeVisibleResult, MapLayoutResult, TextMeasurerFn } from '@/domain/layout'
import { MapEdges } from '@/features/map/MapEdges'
import { MapNodePill } from '@/features/map/MapNodePill'
import { MAP_FIT_PADDING_PX, computeMapBoundingBox } from '@/features/map/map-bounds'
import {
  MAP_THEME_PALETTES,
  assignMapNodeColors,
  type MapThemeMode,
} from '@/features/map/map-colors'
import { buildRenderedMapEdges, type MapEdgeOrientation } from '@/features/map/map-edge-path'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

export interface MapSvgViewProps {
  readonly layout: MapLayoutResult
  readonly visible: ComputeVisibleResult
  readonly orientation: MapEdgeOrientation
  readonly theme: MapThemeMode
  /** Optional explicit viewport size & scale for deterministic Tier 0/1/2 rendering. */
  readonly fixedViewport?: {
    readonly width: number
    readonly height: number
    readonly scale: number
  }
  /** Extra top padding in screen/world px to guarantee HUD elements never overlap nodes. */
  readonly hudTopReservePx?: number
  readonly measureText?: TextMeasurerFn
  readonly onSelectNode?: (nodeId: string) => void
  readonly onOpenNode?: (nodeId: string) => void
  readonly onCreateFirstNode?: () => void
}

/**
 * Pure static SVG tree map renderer (`T3.4b`, `FR-MAP-09`, `FR-MAP-12`).
 * Accepts any `MapLayoutResult` (radial or horizontal) and renders empty state when
 * only the virtual root exists. Contains strictly zero SVG `<filter>` elements.
 */
export function MapSvgView({
  layout,
  visible,
  orientation,
  theme,
  fixedViewport,
  hudTopReservePx = 0,
  measureText,
  onSelectNode,
  onOpenNode,
  onCreateFirstNode,
}: MapSvgViewProps) {
  const palette = MAP_THEME_PALETTES[theme]
  const nonRootCount = visible.orderedIds.filter((id) => visible.nodes[id]?.kind !== 'root').length

  const nodeColors = useMemo(() => assignMapNodeColors(visible, theme), [visible, theme])
  const renderedEdges = useMemo(
    () => buildRenderedMapEdges(layout, visible, orientation),
    [layout, visible, orientation],
  )
  const bbox = useMemo(() => computeMapBoundingBox(layout), [layout])

  if (nonRootCount === 0) {
    return (
      <section
        data-testid="map-empty-state"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-5 px-6 py-12 text-center"
      >
        <svg
          width={160}
          height={104}
          viewBox="-80 -52 160 104"
          aria-hidden="true"
          className="opacity-90"
        >
          <path
            d="M 0 0 C 26 0, 32 -26, 56 -26"
            fill="none"
            stroke={palette.border}
            strokeWidth={2}
          />
          <path
            d="M 0 0 C 26 0, 32 26, 56 26"
            fill="none"
            stroke={palette.border}
            strokeWidth={2}
          />
          <circle
            cx={0}
            cy={0}
            r={18}
            fill={palette.surface2}
            stroke={palette.accent}
            strokeWidth={2}
          />
          <circle
            cx={56}
            cy={-26}
            r={10}
            fill={palette.surface}
            stroke={palette.border}
            strokeWidth={1.5}
          />
          <circle
            cx={56}
            cy={26}
            r={10}
            fill={palette.surface}
            stroke={palette.border}
            strokeWidth={1.5}
          />
        </svg>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{en.map.title}</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Your knowledge map starts at the root. Create your first node to begin branching out.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button type="button" onClick={onCreateFirstNode} data-testid="create-first-node">
            Create first node
          </Button>
          <Button asChild variant="outline">
            <Link to="/n/demo-ret2win">{en.map.openSampleNode}</Link>
          </Button>
        </div>
      </section>
    )
  }

  let viewBox: string
  if (fixedViewport) {
    const worldW = fixedViewport.width / fixedViewport.scale
    const worldH = fixedViewport.height / fixedViewport.scale
    const centerX = (bbox.minX + bbox.maxX) / 2
    const topReserveWorld = hudTopReservePx / fixedViewport.scale
    const centerY = (bbox.minY + bbox.maxY) / 2 - topReserveWorld / 2
    viewBox = `${(centerX - worldW / 2).toFixed(2)} ${(centerY - worldH / 2).toFixed(2)} ${worldW.toFixed(2)} ${worldH.toFixed(2)}`
  } else {
    const padX = MAP_FIT_PADDING_PX
    const padTop = MAP_FIT_PADDING_PX + hudTopReservePx
    const padBottom = MAP_FIT_PADDING_PX
    viewBox = `${(bbox.minX - padX).toFixed(2)} ${(bbox.minY - padTop).toFixed(2)} ${(bbox.width + padX * 2).toFixed(2)} ${(bbox.height + padTop + padBottom).toFixed(2)}`
  }

  return (
    <div
      data-testid="map-svg-container"
      data-orientation={orientation}
      data-tier={layout.tier}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    >
      <h1 className="sr-only">{en.map.title}</h1>
      <svg
        role="img"
        aria-label={en.map.title}
        data-testid="map-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 block h-full w-full select-none"
        style={{ backgroundColor: palette.bg }}
      >
        <MapEdges edges={renderedEdges} nodeColors={nodeColors} fallbackStroke={palette.accent} />
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
                onSelect={onSelectNode}
                onOpen={onOpenNode}
              />
            )
          })}
        </g>
      </svg>
    </div>
  )
}

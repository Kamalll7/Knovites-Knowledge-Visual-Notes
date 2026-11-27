import { useMemo } from 'react'
import type { MapLayoutResult } from '@/domain/layout'
import { MAP_THEME_PALETTES, type MapThemeMode } from '@/features/map/map-colors'
import {
  buildCrossLinkArcGeometry,
  selectActiveCrossLinks,
  type CrossLinkEdge,
} from '@/features/map/map-cross-links'

export interface MapCrossLinksProps {
  readonly crossLinks: readonly CrossLinkEdge[]
  readonly layout: MapLayoutResult
  readonly activeNodeIds: ReadonlySet<string>
  readonly theme: MapThemeMode
}

/**
 * Renders dashed Bezier cross-link arcs ONLY for currently focused or hovered nodes (`FR-MAP-16`).
 * Uses zero SVG `<filter>`, `pointerEvents="none"`, and high-contrast violet tokens in dark/light.
 */
export function MapCrossLinks({ crossLinks, layout, activeNodeIds, theme }: MapCrossLinksProps) {
  const activeLinks = useMemo(
    () => selectActiveCrossLinks(crossLinks, activeNodeIds, layout),
    [crossLinks, activeNodeIds, layout],
  )

  if (activeLinks.length === 0) return null

  const palette = MAP_THEME_PALETTES[theme]
  const arcColor = palette.branches[4]

  return (
    <g data-testid="map-cross-links" pointerEvents="none">
      {activeLinks.map((link) => {
        const sourceNode = layout.nodes[link.sourceId]
        const targetNode = layout.nodes[link.targetId]
        if (!sourceNode || !targetNode) return null
        const geom = buildCrossLinkArcGeometry(sourceNode, targetNode)
        if (!geom) return null

        return (
          <g
            key={link.id}
            data-testid="map-cross-link"
            data-source-id={link.sourceId}
            data-target-id={link.targetId}
          >
            <path
              d={geom.pathD}
              fill="none"
              stroke={palette.bg}
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.72}
            />
            <path
              data-testid="map-cross-link-path"
              d={geom.pathD}
              fill="none"
              stroke={arcColor}
              strokeWidth={1.85}
              strokeDasharray="6 4"
              strokeLinecap="round"
              opacity={0.92}
            />
            <path
              d={geom.arrowD}
              fill="none"
              stroke={arcColor}
              strokeWidth={1.85}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.92}
            />
          </g>
        )
      })}
    </g>
  )
}

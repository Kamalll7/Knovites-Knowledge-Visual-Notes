import {
  EDGE_OPACITY,
  EDGE_STROKE,
  WIDE_FAN_FADE_STOP_OFFSET,
  type RenderedMapEdge,
} from '@/features/map/map-edge-path'
import type { NodeColorStyles } from '@/features/map/map-colors'

export interface MapEdgesProps {
  readonly edges: readonly RenderedMapEdge[]
  readonly nodeColors: ReadonlyMap<string, NodeColorStyles>
  readonly fallbackStroke: string
}

/**
 * Renders map SVG Bezier edges anchored at capsule/circle perimeter points.
 * Uses layered stroke halos for focus paths (strictly NO `<filter>` blur) and
 * `userSpaceOnUse` linear gradients for wide-fan source-base fading (`FR-MAP-09`).
 */
export function MapEdges({ edges, nodeColors, fallbackStroke }: MapEdgesProps) {
  const fadedEdges = edges.filter((edge) => edge.fadeSourceBase && edge.gradientId !== null)
  const sortedEdges = [...edges].sort((a, b) => Number(a.isOnFocusPath) - Number(b.isOnFocusPath))

  return (
    <g data-testid="map-edges">
      {fadedEdges.length > 0 ? (
        <defs>
          {fadedEdges.map((edge) => {
            const color = nodeColors.get(edge.targetId)?.accentHex ?? fallbackStroke
            const { sx, sy, tx, ty } = edge.controlPoints
            return (
              <linearGradient
                key={edge.gradientId}
                id={edge.gradientId!}
                gradientUnits="userSpaceOnUse"
                x1={sx}
                y1={sy}
                x2={tx}
                y2={ty}
              >
                <stop offset="0%" stopColor={color} stopOpacity={EDGE_OPACITY.wideFanBaseStart} />
                <stop
                  offset={`${Math.round(WIDE_FAN_FADE_STOP_OFFSET * 100)}%`}
                  stopColor={color}
                  stopOpacity={edge.opacity}
                />
                <stop offset="100%" stopColor={color} stopOpacity={edge.opacity} />
              </linearGradient>
            )
          })}
        </defs>
      ) : null}

      {sortedEdges.map((edge) => {
        const strokeColor = nodeColors.get(edge.targetId)?.accentHex ?? fallbackStroke
        const useGradient = edge.fadeSourceBase && edge.gradientId !== null
        return (
          <g
            key={edge.id}
            data-edge-id={edge.id}
            data-fade-base={edge.fadeSourceBase ? 'true' : 'false'}
          >
            {edge.isOnFocusPath ? (
              <path
                d={edge.d}
                fill="none"
                stroke={strokeColor}
                strokeWidth={edge.strokeWidth + EDGE_STROKE.haloExtraWidthPx}
                strokeLinecap="round"
                opacity={EDGE_OPACITY.halo}
                data-testid="map-edge-focus-halo"
              />
            ) : null}
            <path
              d={edge.d}
              fill="none"
              stroke={useGradient ? `url(#${edge.gradientId})` : strokeColor}
              strokeWidth={edge.strokeWidth}
              strokeLinecap="round"
              opacity={useGradient ? 1 : edge.opacity}
              data-testid="map-edge-path"
            />
          </g>
        )
      })}
    </g>
  )
}

import type { RefObject } from 'react'
import {
  EDGE_OPACITY,
  EDGE_STROKE,
  WIDE_FAN_FADE_STOP_OFFSET,
  type RenderedMapEdge,
} from '@/features/map/map-edge-path'
import type { NodeColorStyles } from '@/features/map/map-colors'

export interface EdgeDomRefs {
  group: SVGGElement | null
  path: SVGPathElement | null
  halo: SVGPathElement | null
  gradient: SVGLinearGradientElement | null
}

export interface MapEdgesProps {
  readonly edges: readonly RenderedMapEdge[]
  readonly nodeColors: ReadonlyMap<string, NodeColorStyles>
  readonly fallbackStroke: string
  readonly edgeRefs?: RefObject<Map<string, EdgeDomRefs>>
}

function setEdgeRefField<K extends keyof EdgeDomRefs>(
  edgeRefs: RefObject<Map<string, EdgeDomRefs>> | undefined,
  edgeId: string,
  field: K,
  el: EdgeDomRefs[K],
): void {
  if (!edgeRefs) return
  const map = edgeRefs.current
  let entry = map.get(edgeId)
  if (!entry) {
    if (el === null) return
    entry = { group: null, path: null, halo: null, gradient: null }
    map.set(edgeId, entry)
  }
  entry[field] = el
  if (
    entry.group === null &&
    entry.path === null &&
    entry.halo === null &&
    entry.gradient === null
  ) {
    map.delete(edgeId)
  }
}

/**
 * Renders map SVG Bezier edges anchored at capsule/circle perimeter points.
 * Uses layered stroke halos for focus paths (strictly NO `<filter>` blur) and
 * `userSpaceOnUse` linear gradients for wide-fan source-base fading (`FR-MAP-09`).
 */
export function MapEdges({ edges, nodeColors, fallbackStroke, edgeRefs }: MapEdgesProps) {
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
                key={edge.id}
                ref={(el) => setEdgeRefField(edgeRefs, edge.id, 'gradient', el)}
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
            ref={(el) => setEdgeRefField(edgeRefs, edge.id, 'group', el)}
            data-edge-id={edge.id}
            data-fade-base={edge.fadeSourceBase ? 'true' : 'false'}
          >
            {edge.isOnFocusPath ? (
              <path
                ref={(el) => setEdgeRefField(edgeRefs, edge.id, 'halo', el)}
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
              ref={(el) => setEdgeRefField(edgeRefs, edge.id, 'path', el)}
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

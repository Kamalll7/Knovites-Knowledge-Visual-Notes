import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  type MapLayoutNode,
  type TextMeasurerFn,
  type VisibleMapNode,
} from '@/domain/layout'
import type { NodeStatus } from '@/domain/schema'
import {
  MAP_THEME_PALETTES,
  type MapThemeMode,
  type NodeColorStyles,
} from '@/features/map/map-colors'

/** Capsule visual geometry constants aligned with `MAP_CAPSULE_BOX_CONFIG` & Spike S3 (`FR-MAP-09`). */
const CAPSULE_CORNER_RADIUS_PX = 14
const FOCUS_HALO_STROKE_EXPAND_PX = 4
const FOCUS_HALO_STROKE_WIDTH_PX = 5
const FOCUS_HALO_OPACITY = 0.28
const STATUS_DOT_RADIUS_PX = 3.5
const STATUS_GLYPH_SIZE_PX = 10
const CAPSULE_LEFT_PAD_PX = 8
const STATUS_INDICATOR_OFFSET_X_PX = 18
const CAPSULE_STATUS_GLYPH_OFFSET_X_PX = 10.5
const STATUS_DOT_LOCAL_CX_PX = -4

export interface MapNodePillProps {
  readonly layoutNode: MapLayoutNode
  readonly visibleNode: VisibleMapNode
  readonly colors: NodeColorStyles
  readonly theme: MapThemeMode
  readonly measureText?: TextMeasurerFn
  readonly isHovered?: boolean
  readonly onSelect?: (nodeId: string) => void
  readonly onOpen?: (nodeId: string) => void
  readonly onHoverStart?: (nodeId: string) => void
  readonly onHoverEnd?: (nodeId: string) => void
  readonly groupRef?: (el: SVGGElement | null) => void
}

function StatusGlyph({
  status,
  color,
  cx,
  cy,
}: {
  readonly status: Exclude<NodeStatus, 'none'>
  readonly color: string
  readonly cx: number
  readonly cy: number
}) {
  const half = STATUS_GLYPH_SIZE_PX / 2
  const x0 = cx - half
  const y0 = cy - half

  return (
    <g
      data-testid={`node-status-${status}`}
      aria-label={status}
      transform={`translate(${x0}, ${y0})`}
    >
      <circle
        cx={STATUS_DOT_LOCAL_CX_PX}
        cy={half}
        r={STATUS_DOT_RADIUS_PX}
        fill={color}
        data-testid="status-dot"
      />
      {status === 'mastered' ? (
        <path
          d="M 1.5 5.3 L 4.1 7.8 L 8.6 2.4"
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="status-icon"
        />
      ) : status === 'practiced' ? (
        <path
          d="M 5 1 L 6.2 3.8 L 9 5 L 6.2 6.2 L 5 9 L 3.8 6.2 L 1 5 L 3.8 3.8 Z"
          fill={color}
          data-testid="status-icon"
        />
      ) : (
        <path
          d="M 2 2.5 C 3.6 2.5 4.6 3.1 5 3.9 C 5.4 3.1 6.4 2.5 8 2.5 L 8 7.6 C 6.4 7.6 5.4 8.1 5 8.8 C 4.6 8.1 3.6 7.6 2 7.6 Z"
          fill="none"
          stroke={color}
          strokeWidth={1.3}
          strokeLinejoin="round"
          data-testid="status-icon"
        />
      )}
    </g>
  )
}

/**
 * Renders a single radial or horizontal map node: adaptive capsule in Tier 1/2,
 * circle with external label in Tier 0, status dot + icon (`FR-MAP-09`), focus
 * stroke halo without `<filter>`, collapsed `· N` badge, and `+N` overflow bubble.
 */
export function MapNodePill({
  layoutNode,
  visibleNode,
  colors,
  theme,
  isHovered = false,
  onSelect,
  onOpen,
  onHoverStart,
  onHoverEnd,
  groupRef,
}: MapNodePillProps) {
  const palette = MAP_THEME_PALETTES[theme]
  const isOverflow = layoutNode.kind === 'overflow'
  const isRoot = layoutNode.kind === 'root'
  const isCircle = layoutNode.shape === 'circle'
  const status: NodeStatus = visibleNode.status
  const statusColor = status !== 'none' ? palette.status[status] : null
  const hasStatus = statusColor !== null
  const badgeSuffix =
    !isOverflow && !isRoot && visibleNode.hiddenCount > 0 ? ` · ${visibleNode.hiddenCount}` : ''
  const titleText = isOverflow ? visibleNode.title : layoutNode.displayTitle

  const handleClick = () => {
    onSelect?.(layoutNode.id)
  }

  const handleDoubleClick = () => {
    onOpen?.(layoutNode.id)
  }

  const strokeWidth = visibleNode.isFocus ? 2.2 : visibleNode.isOnFocusPath ? 1.6 : 1.15
  const fontWeight = DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.weight
  const badgeFontPx = DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.badgePx
  const fontFamily = DEFAULT_RADIAL_LAYOUT_CONFIG.fonts.family

  if (isCircle) {
    const r = layoutNode.radius ?? layoutNode.width / 2
    const lb = layoutNode.labelBox
    return (
      <g
        ref={groupRef}
        data-testid="map-node"
        data-node-id={layoutNode.id}
        data-node-kind={layoutNode.kind}
        data-node-shape="circle"
        data-truncated={layoutNode.isTruncated ? 'true' : 'false'}
        data-hovered={isHovered ? 'true' : 'false'}
        transform={`translate(${layoutNode.x}, ${layoutNode.y})`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => onHoverStart?.(layoutNode.id)}
        onMouseLeave={() => onHoverEnd?.(layoutNode.id)}
        style={{ cursor: onSelect || onOpen ? 'pointer' : 'default' }}
      >
        <g transform={isHovered ? 'scale(1.04)' : undefined}>
          {visibleNode.isFocus ? (
            <circle
              cx={0}
              cy={0}
              r={r + FOCUS_HALO_STROKE_EXPAND_PX}
              fill="none"
              stroke={colors.accentHex}
              strokeWidth={FOCUS_HALO_STROKE_WIDTH_PX}
              opacity={FOCUS_HALO_OPACITY}
              data-testid="map-node-focus-halo"
            />
          ) : null}
          <circle
            cx={0}
            cy={0}
            r={r}
            fill={colors.fillHex}
            stroke={colors.borderHex}
            strokeWidth={strokeWidth}
            data-testid="map-node-shape"
          />
          {statusColor ? (
            <StatusGlyph
              status={status as Exclude<NodeStatus, 'none'>}
              color={statusColor}
              cx={4}
              cy={0}
            />
          ) : null}
          {layoutNode.labelVisible ? (
            <>
              {lb ? (
                <rect
                  x={lb.x - layoutNode.x - 4}
                  y={lb.y - layoutNode.y - 1}
                  width={lb.width + 8}
                  height={lb.height + 2}
                  rx={6}
                  fill={palette.bg}
                  opacity={0.94}
                  data-testid="map-node-label-bg"
                />
              ) : null}
              <text
                x={lb ? lb.x - layoutNode.x + lb.width / 2 : 0}
                y={lb ? lb.y - layoutNode.y + lb.height * 0.72 : 0}
                textAnchor="middle"
                dominantBaseline={lb ? 'auto' : 'central'}
                fill={colors.textHex}
                fontSize={layoutNode.modelFontPx}
                fontWeight={fontWeight}
                fontFamily={fontFamily}
                paintOrder={lb ? 'stroke' : undefined}
                stroke={lb ? palette.bg : undefined}
                strokeWidth={lb ? 4 : undefined}
                strokeLinejoin={lb ? 'round' : undefined}
                data-testid="map-node-label"
              >
                {titleText}
                {badgeSuffix ? (
                  <tspan fontSize={badgeFontPx} fill={palette.fgMuted}>
                    {badgeSuffix}
                  </tspan>
                ) : null}
              </text>
            </>
          ) : null}
        </g>
      </g>
    )
  }

  const halfW = layoutNode.width / 2
  const halfH = layoutNode.height / 2
  const textX = hasStatus ? -halfW + CAPSULE_LEFT_PAD_PX + STATUS_INDICATOR_OFFSET_X_PX : 0

  return (
    <g
      ref={groupRef}
      data-testid="map-node"
      data-node-id={layoutNode.id}
      data-node-kind={layoutNode.kind}
      data-node-shape="capsule"
      data-truncated={layoutNode.isTruncated ? 'true' : 'false'}
      data-hovered={isHovered ? 'true' : 'false'}
      transform={`translate(${layoutNode.x}, ${layoutNode.y})`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => onHoverStart?.(layoutNode.id)}
      onMouseLeave={() => onHoverEnd?.(layoutNode.id)}
      style={{ cursor: onSelect || onOpen ? 'pointer' : 'default' }}
    >
      <g transform={isHovered ? 'scale(1.04)' : undefined}>
        {visibleNode.isFocus ? (
          <rect
            x={-halfW - FOCUS_HALO_STROKE_EXPAND_PX}
            y={-halfH - FOCUS_HALO_STROKE_EXPAND_PX}
            width={layoutNode.width + FOCUS_HALO_STROKE_EXPAND_PX * 2}
            height={layoutNode.height + FOCUS_HALO_STROKE_EXPAND_PX * 2}
            rx={CAPSULE_CORNER_RADIUS_PX + FOCUS_HALO_STROKE_EXPAND_PX}
            fill="none"
            stroke={colors.accentHex}
            strokeWidth={FOCUS_HALO_STROKE_WIDTH_PX}
            opacity={FOCUS_HALO_OPACITY}
            data-testid="map-node-focus-halo"
          />
        ) : null}
        <rect
          x={-halfW}
          y={-halfH}
          width={layoutNode.width}
          height={layoutNode.height}
          rx={isOverflow ? halfH : CAPSULE_CORNER_RADIUS_PX}
          fill={colors.fillHex}
          stroke={colors.borderHex}
          strokeWidth={strokeWidth}
          strokeDasharray={isOverflow ? '4 3' : undefined}
          data-testid="map-node-shape"
        />
        {hasStatus ? (
          <StatusGlyph
            status={status as Exclude<NodeStatus, 'none'>}
            color={statusColor}
            cx={-halfW + CAPSULE_LEFT_PAD_PX + CAPSULE_STATUS_GLYPH_OFFSET_X_PX}
            cy={0}
          />
        ) : null}
        {layoutNode.labelVisible ? (
          <text
            x={textX}
            y={0}
            textAnchor={hasStatus ? 'start' : 'middle'}
            dominantBaseline="central"
            fill={isOverflow ? palette.fgMuted : colors.textHex}
            fontSize={layoutNode.modelFontPx}
            fontWeight={fontWeight}
            fontFamily={fontFamily}
            data-testid="map-node-label"
          >
            {titleText}
            {badgeSuffix ? (
              <tspan fontSize={badgeFontPx} fill={palette.fgMuted}>
                {badgeSuffix}
              </tspan>
            ) : null}
          </text>
        ) : null}
      </g>
    </g>
  )
}

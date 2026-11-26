import type { ReactNode } from 'react'
import { Compass, Focus, GitBranch, Maximize2, Minus, Plus } from 'lucide-react'
import type { MapOrientationPreference } from '@/app/map-preferences'
import type { ZoomTier } from '@/domain/layout'
import { Button } from '@/ui/components/button'

export interface MapHudControlsProps {
  readonly leading?: ReactNode
  readonly orientation: MapOrientationPreference
  readonly zoomScale: number
  readonly zoomTier: ZoomTier
  readonly onOrientationChange: (next: MapOrientationPreference) => void
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
  readonly onFitAll: () => void
  readonly onRecenterFocus: () => void
}

/**
 * Non-overlapping map toolbar bar (`FR-MAP-04`, `FR-MAP-06`, `FR-MAP-08`, `FR-MAP-11`, Syarat M3).
 * Rendered in a dedicated flex header outside the `<svg>` viewport so controls never overlap map nodes.
 */
export function MapHudControls({
  leading,
  orientation,
  zoomScale,
  zoomTier,
  onOrientationChange,
  onZoomIn,
  onZoomOut,
  onFitAll,
  onRecenterFocus,
}: MapHudControlsProps) {
  const zoomPercent = Math.round(zoomScale * 100)

  return (
    <div
      data-testid="map-hud-controls"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-3 py-1.5 text-xs"
    >
      {leading ? <div className="flex min-w-0 flex-1 items-center gap-2">{leading}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Map layout orientation">
          <Button
            type="button"
            size="sm"
            variant={orientation === 'radial' ? 'secondary' : 'ghost'}
            aria-pressed={orientation === 'radial'}
            data-testid="map-orientation-radial"
            onClick={() => onOrientationChange('radial')}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Compass className="size-3.5" aria-hidden="true" />
            <span>Radial</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={orientation === 'horizontal' ? 'secondary' : 'ghost'}
            aria-pressed={orientation === 'horizontal'}
            data-testid="map-orientation-horizontal"
            onClick={() => onOrientationChange('horizontal')}
            className="h-7 gap-1 px-2 text-xs"
          >
            <GitBranch className="size-3.5" aria-hidden="true" />
            <span>Horizontal</span>
          </Button>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Map viewport controls">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Zoom out"
            data-testid="map-zoom-out"
            onClick={onZoomOut}
            className="h-7 w-7 p-0"
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </Button>
          <span
            data-testid="map-zoom-chip"
            data-scale={zoomScale.toFixed(3)}
            data-tier={String(zoomTier)}
            className="min-w-[4.75rem] rounded border border-border bg-secondary px-2 py-1 text-center font-mono text-[11px] text-foreground"
          >
            {zoomPercent}% · T{zoomTier}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Zoom in"
            data-testid="map-zoom-in"
            onClick={onZoomIn}
            className="h-7 w-7 p-0"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Fit map to screen"
            data-testid="map-fit"
            onClick={onFitAll}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Maximize2 className="size-3.5" aria-hidden="true" />
            <span>Fit</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Recenter on focused node"
            data-testid="map-recenter"
            onClick={onRecenterFocus}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Focus className="size-3.5" aria-hidden="true" />
            <span>Focus</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

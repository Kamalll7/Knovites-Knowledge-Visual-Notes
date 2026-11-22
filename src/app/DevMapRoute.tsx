import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTheme } from '@/app/theme-context'
import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  MAP_ROOT_ID,
  OVERFLOW_NODE_PREFIX,
  computeHorizontalGeometryDiagnostics,
  computeHorizontalLayout,
  computeRadialGeometryDiagnostics,
  computeRadialLayout,
  computeVisible,
  type CollisionStats,
  type HorizontalLayoutResult,
  type MapLayoutResult,
  type RadialLayoutResult,
  type ZoomTier,
} from '@/domain/layout'
import { buildTree, type TreeBuildEntry } from '@/domain/tree'
import { MapSvgView } from '@/features/map/MapSvgView'
import { MAP_HUD_TOP_RESERVE_PX, computeMapBoundingBox } from '@/features/map/map-bounds'
import { createCanvasTextMeasurer } from '@/features/map/map-measure'

const DEV_DATASET_IDS = [
  'demo',
  'unbalanced150',
  'wide60Children',
  'chainDepth12',
  'root20Children',
  'large2000',
] as const

type DevDatasetId = (typeof DEV_DATASET_IDS)[number]
type DevLayoutMode = 'radial' | 'horizontal'

interface LoadedDataset {
  readonly id: DevDatasetId
  readonly title: string
  readonly entries: readonly TreeBuildEntry[]
}

function parseDatasetId(raw: string | null): DevDatasetId {
  return DEV_DATASET_IDS.includes(raw as DevDatasetId) ? (raw as DevDatasetId) : 'demo'
}

function parseTier(raw: string | null): ZoomTier {
  if (raw === '0') return 0
  if (raw === '2') return 2
  return 1
}

function defaultScaleForTier(tier: ZoomTier): number {
  return tier === 0 ? 0.85 : 1
}

function parseScale(raw: string | null, tier: ZoomTier): number {
  if (!raw) return defaultScaleForTier(tier)
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : defaultScaleForTier(tier)
}

/**
 * Dev-only map verification route (`/__dev/map`, registered only when `import.meta.env.DEV`).
 * Loads demo + 5 mandatory datasets strictly via dynamic `import()` so production bundles
 * remain unaffected (`check:bundle`). Displays live geometry diagnostics chip (`TAMBAHAN #3`).
 */
export default function DevMapRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { resolvedTheme, setTheme } = useTheme()

  const datasetId = parseDatasetId(searchParams.get('dataset'))
  const tier = parseTier(searchParams.get('tier'))
  const scale = parseScale(searchParams.get('scale'), tier)
  const mode: DevLayoutMode = searchParams.get('mode') === 'horizontal' ? 'horizontal' : 'radial'
  const themeParam = searchParams.get('theme')
  const fixedW = Number.parseInt(searchParams.get('vw') ?? '', 10)
  const fixedH = Number.parseInt(searchParams.get('vh') ?? '', 10)

  const [datasetsById, setDatasetsById] = useState<Partial<Record<DevDatasetId, LoadedDataset>>>({})
  const [focusId, setFocusId] = useState<string>(MAP_ROOT_ID)
  const [expandedOverflowParentIds, setExpandedOverflowParentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [fontVersion, setFontVersion] = useState(0)

  const measurer = useMemo(() => createCanvasTextMeasurer(), [])

  useEffect(() => {
    return measurer.subscribeFontChange((version) => setFontVersion(version))
  }, [measurer])

  useEffect(() => {
    if (themeParam === 'light' || themeParam === 'dark') {
      setTheme(themeParam)
    }
  }, [themeParam, setTheme])

  useEffect(() => {
    let active = true
    void import('@/domain/datasets').then(({ createDemoDataset, createMandatoryDatasets }) => {
      if (!active) return
      const demo = createDemoDataset()
      const mandatory = createMandatoryDatasets()
      setDatasetsById({
        demo: { id: 'demo', title: demo.manifest.title, entries: demo.entries },
        unbalanced150: {
          id: 'unbalanced150',
          title: mandatory.unbalanced150.manifest.title,
          entries: mandatory.unbalanced150.entries,
        },
        wide60Children: {
          id: 'wide60Children',
          title: mandatory.wide60Children.manifest.title,
          entries: mandatory.wide60Children.entries,
        },
        chainDepth12: {
          id: 'chainDepth12',
          title: mandatory.chainDepth12.manifest.title,
          entries: mandatory.chainDepth12.entries,
        },
        root20Children: {
          id: 'root20Children',
          title: mandatory.root20Children.manifest.title,
          entries: mandatory.root20Children.entries,
        },
        large2000: {
          id: 'large2000',
          title: mandatory.large2000.manifest.title,
          entries: mandatory.large2000.entries,
        },
      })
    })
    return () => {
      active = false
    }
  }, [])

  const loaded = datasetsById[datasetId]
  const tree = useMemo(
    () => (loaded ? buildTree([...loaded.entries]).state : buildTree([]).state),
    [loaded],
  )

  const effectiveFocusId = focusId === MAP_ROOT_ID || tree.nodes[focusId] ? focusId : MAP_ROOT_ID

  const visible = useMemo(
    () =>
      computeVisible({
        tree,
        rootTitle: loaded?.title ?? 'Loading…',
        focusId: effectiveFocusId,
        expandedOverflowParentIds,
        zoomTier: tier,
      }),
    [tree, loaded?.title, effectiveFocusId, expandedOverflowParentIds, tier],
  )

  const computed = useMemo(() => {
    void fontVersion
    if (mode === 'horizontal') {
      const layout: HorizontalLayoutResult = computeHorizontalLayout({
        visible,
        measureText: measurer.measure,
        scale,
        tier,
      })
      const geom = computeHorizontalGeometryDiagnostics(layout)
      const bbox = computeMapBoundingBox(layout)
      return {
        layout: layout as MapLayoutResult,
        passesUsed: 0,
        hitMaxPasses: false,
        overlapCount: geom.overlapCount,
        edgeCrossings: 0,
        maxRadiusPx: 0,
        bbox,
      }
    }

    const stats: CollisionStats = {
      passesUsed: 0,
      overlapChecks: 0,
      edgeCrossChecks: 0,
      allocations: 0,
    }
    const layout: RadialLayoutResult = computeRadialLayout({
      visible,
      measureText: measurer.measure,
      scale,
      tier,
      stats,
    })
    const geom = computeRadialGeometryDiagnostics(layout)
    const bbox = computeMapBoundingBox(layout)
    let maxRadiusPx = 0
    for (const id of layout.orderedIds) {
      maxRadiusPx = Math.max(maxRadiusPx, layout.nodes[id]!.r)
    }
    const passesUsed = Math.max(stats.passesUsed, layout.diagnostics.collisionPassesUsed)
    const hitMaxPasses =
      passesUsed >= DEFAULT_RADIAL_LAYOUT_CONFIG.maxCollisionPasses &&
      (geom.overlapCount > 0 || geom.edgeCrossingsCount > 0)

    return {
      layout: layout as MapLayoutResult,
      passesUsed,
      hitMaxPasses,
      overlapCount: geom.overlapCount,
      edgeCrossings: geom.edgeCrossingsCount,
      maxRadiusPx: Math.round(maxRadiusPx),
      bbox,
    }
  }, [visible, measurer, scale, tier, mode, fontVersion])

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    if (key === 'dataset') {
      setFocusId(MAP_ROOT_ID)
      setExpandedOverflowParentIds(new Set())
    }
    setSearchParams(next, { replace: true })
  }

  const fixedViewport =
    Number.isFinite(fixedW) && fixedW > 0 && Number.isFinite(fixedH) && fixedH > 0
      ? { width: fixedW, height: fixedH, scale }
      : undefined

  return (
    <section
      data-testid="dev-map-route"
      data-ready={loaded ? 'true' : 'false'}
      className="relative flex h-[calc(100vh-3.5rem)] w-full flex-1 flex-col overflow-hidden"
    >
      <div
        data-testid="dev-map-hud"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-3 py-1.5 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-muted-foreground">
            <span>Dataset</span>
            <select
              aria-label="Dataset"
              value={datasetId}
              onChange={(e) => updateParam('dataset', e.target.value)}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-foreground"
            >
              {DEV_DATASET_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            <span>Mode</span>
            <select
              aria-label="Layout mode"
              value={mode}
              onChange={(e) => updateParam('mode', e.target.value)}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-foreground"
            >
              <option value="radial">radial</option>
              <option value="horizontal">horizontal</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            <span>Tier</span>
            <select
              aria-label="Zoom tier"
              value={String(tier)}
              onChange={(e) => updateParam('tier', e.target.value)}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-foreground"
            >
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
        </div>

        <aside
          data-testid="dev-map-diagnostics"
          data-passes-used={String(computed.passesUsed)}
          data-overlap-count={String(computed.overlapCount)}
          data-edge-crossings={String(computed.edgeCrossings)}
          data-max-radius-px={String(computed.maxRadiusPx)}
          data-bbox-w={String(Math.round(computed.bbox.width))}
          data-bbox-h={String(Math.round(computed.bbox.height))}
          data-node-count={String(computed.layout.diagnostics.nodeCount)}
          data-non-converged={computed.hitMaxPasses || computed.overlapCount > 0 ? 'true' : 'false'}
          className="flex flex-wrap items-center gap-2 rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-foreground"
        >
          <span>nodes:{computed.layout.diagnostics.nodeCount}</span>
          <span>passes:{computed.passesUsed}</span>
          <span>overlaps:{computed.overlapCount}</span>
          <span>crossings:{computed.edgeCrossings}</span>
          <span>maxR:{computed.maxRadiusPx}px</span>
          <span>
            bbox:{Math.round(computed.bbox.width)}×{Math.round(computed.bbox.height)}
          </span>
          {computed.hitMaxPasses || computed.overlapCount > 0 ? (
            <span className="rounded bg-destructive/20 px-1 font-semibold text-destructive">
              NON-CONVERGED
            </span>
          ) : null}
        </aside>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {loaded ? (
          <MapSvgView
            layout={computed.layout}
            visible={visible}
            orientation={mode}
            theme={resolvedTheme}
            fixedViewport={fixedViewport}
            hudTopReservePx={fixedViewport ? MAP_HUD_TOP_RESERVE_PX : 0}
            measureText={measurer.measure}
            onSelectNode={(nodeId) => {
              if (nodeId.startsWith(OVERFLOW_NODE_PREFIX)) {
                const parentId = nodeId.slice(OVERFLOW_NODE_PREFIX.length)
                setExpandedOverflowParentIds((prev) => new Set(prev).add(parentId))
                return
              }
              setFocusId(nodeId)
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading dataset…
          </div>
        )}
      </div>
    </section>
  )
}

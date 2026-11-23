import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMapOrientationPreference, type MapOrientationPreference } from '@/app/map-preferences'
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
import { MapHudControls } from '@/features/map/MapHudControls'
import { MapSvgView } from '@/features/map/MapSvgView'
import { MapViewport, type MapViewportHandle } from '@/features/map/MapViewport'
import { MAP_HUD_TOP_RESERVE_PX, computeMapBoundingBox } from '@/features/map/map-bounds'
import { MAP_CAPSULE_BOX_CONFIG, createCanvasTextMeasurer } from '@/features/map/map-measure'
import {
  EMPTY_PERF_SUMMARY,
  RollingPerfWindow,
  type PerfWindowSummary,
} from '@/features/map/perf-window'

const DEV_DATASET_IDS = [
  'demo',
  'unbalanced150',
  'wide60Children',
  'chainDepth12',
  'root20Children',
  'large2000',
] as const

type DevDatasetId = (typeof DEV_DATASET_IDS)[number]

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

function parseScale(raw: string | null, tier: ZoomTier): number {
  const fallback = tier === 0 ? 0.85 : 1
  if (!raw) return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Dev-only map verification & performance measurement route (`/__dev/map`, registered only when
 * `import.meta.env.DEV`). Datasets and Dexie benchmark helpers are loaded strictly via dynamic
 * `import()` so production bundles remain unaffected (`check:bundle`).
 */
export default function DevMapRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { resolvedTheme, setTheme } = useTheme()
  const { orientation: storedOrientation, setOrientation: setStoredOrientation } =
    useMapOrientationPreference()

  const datasetId = parseDatasetId(searchParams.get('dataset'))
  const hasExplicitTier = searchParams.has('tier')
  const isInteractive = searchParams.get('interactive') === '1' || !hasExplicitTier
  const explicitModeParam = searchParams.get('mode')
  const mode: MapOrientationPreference =
    explicitModeParam === 'horizontal' || explicitModeParam === 'radial'
      ? explicitModeParam
      : isInteractive
        ? storedOrientation
        : 'radial'

  const staticTier = parseTier(searchParams.get('tier'))
  const staticScale = parseScale(searchParams.get('scale'), staticTier)
  const themeParam = searchParams.get('theme')
  const fixedW = Number.parseInt(searchParams.get('vw') ?? '', 10)
  const fixedH = Number.parseInt(searchParams.get('vh') ?? '', 10)

  const viewportRef = useRef<MapViewportHandle | null>(null)
  const perfWindowRef = useRef<RollingPerfWindow>(new RollingPerfWindow())

  const [datasetsById, setDatasetsById] = useState<Partial<Record<DevDatasetId, LoadedDataset>>>({})
  const [focusId, setFocusId] = useState<string>(MAP_ROOT_ID)
  const [expandedOverflowParentIds, setExpandedOverflowParentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [interactiveScale, setInteractiveScale] = useState<number>(1)
  const [interactiveTier, setInteractiveTier] = useState<ZoomTier>(1)
  const [fontVersion, setFontVersion] = useState(0)
  const [perfSummary, setPerfSummary] = useState<PerfWindowSummary>(EMPTY_PERF_SUMMARY)
  const [layoutMs, setLayoutMs] = useState<number>(0)
  const [hydrateMs, setHydrateMs] = useState<number | null>(null)
  const [hydrating, setHydrating] = useState(false)

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

  // Passive RAF FPS monitor in interactive mode (updates HUD display at 4 Hz to avoid extra renders)
  useEffect(() => {
    if (!isInteractive) return
    let rafId = 0
    let lastTs = performance.now()
    let lastReportTs = lastTs
    const tick = (now: number) => {
      const dt = now - lastTs
      lastTs = now
      perfWindowRef.current.push(dt, now)
      if (now - lastReportTs >= 250) {
        lastReportTs = now
        setPerfSummary(perfWindowRef.current.summarize(now))
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isInteractive])

  const loaded = datasetsById[datasetId]
  const tree = useMemo(
    () => (loaded ? buildTree([...loaded.entries]).state : buildTree([]).state),
    [loaded],
  )
  const effectiveFocusId = focusId === MAP_ROOT_ID || tree.nodes[focusId] ? focusId : MAP_ROOT_ID
  const activeTier: ZoomTier = isInteractive ? interactiveTier : staticTier
  const activeScale = isInteractive ? interactiveScale : staticScale

  const computed = useMemo(() => {
    void fontVersion
    const visible = computeVisible({
      tree,
      rootTitle: loaded?.title ?? 'Loading…',
      focusId: effectiveFocusId,
      expandedOverflowParentIds,
      zoomTier: activeTier,
    })

    if (mode === 'horizontal') {
      const layout: HorizontalLayoutResult = computeHorizontalLayout({
        visible,
        measureText: measurer.measure,
        scale: activeScale,
        tier: activeTier,
        config: MAP_CAPSULE_BOX_CONFIG,
      })
      const geom = computeHorizontalGeometryDiagnostics(layout)
      const bbox = computeMapBoundingBox(layout)
      return {
        visible,
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
      scale: activeScale,
      tier: activeTier,
      config: MAP_CAPSULE_BOX_CONFIG,
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
      visible,
      layout: layout as MapLayoutResult,
      passesUsed,
      hitMaxPasses,
      overlapCount: geom.overlapCount,
      edgeCrossings: geom.edgeCrossingsCount,
      maxRadiusPx: Math.round(maxRadiusPx),
      bbox,
    }
  }, [
    tree,
    loaded?.title,
    effectiveFocusId,
    expandedOverflowParentIds,
    activeTier,
    activeScale,
    mode,
    measurer,
    fontVersion,
  ])

  // Measure pure computeVisible + layout duration inside RAF callback (React 19 purity compliant)
  useEffect(() => {
    if (!loaded) return
    const rafId = requestAnimationFrame(() => {
      const t0 = performance.now()
      const vis = computeVisible({
        tree,
        rootTitle: loaded.title,
        focusId: effectiveFocusId,
        expandedOverflowParentIds,
        zoomTier: activeTier,
      })
      if (mode === 'horizontal') {
        computeHorizontalLayout({
          visible: vis,
          measureText: measurer.measure,
          scale: activeScale,
          tier: activeTier,
          config: MAP_CAPSULE_BOX_CONFIG,
        })
      } else {
        computeRadialLayout({
          visible: vis,
          measureText: measurer.measure,
          scale: activeScale,
          tier: activeTier,
          config: MAP_CAPSULE_BOX_CONFIG,
        })
      }
      setLayoutMs(Number((performance.now() - t0).toFixed(2)))
    })
    return () => cancelAnimationFrame(rafId)
  }, [
    loaded,
    tree,
    effectiveFocusId,
    expandedOverflowParentIds,
    activeTier,
    activeScale,
    mode,
    measurer,
    fontVersion,
  ])

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    if (key === 'dataset') {
      setFocusId(MAP_ROOT_ID)
      setExpandedOverflowParentIds(new Set())
    }
    setSearchParams(next, { replace: true })
  }

  const handleOrientationChange = useCallback(
    (next: MapOrientationPreference) => {
      setStoredOrientation(next)
      if (searchParams.has('mode')) {
        const updated = new URLSearchParams(searchParams)
        updated.set('mode', next)
        setSearchParams(updated, { replace: true })
      }
    },
    [searchParams, setSearchParams, setStoredOrientation],
  )

  const handleResetPerf = useCallback(() => {
    perfWindowRef.current.reset()
    setPerfSummary(perfWindowRef.current.summarize())
    setHydrateMs(null)
  }, [])

  const handleBenchmarkHydrate = useCallback(async () => {
    if (!loaded || hydrating) return
    setHydrating(true)
    try {
      const [{ createKnovitesDatabase, loadTreeBuildEntries }, { serializeNodeJson }] =
        await Promise.all([import('@/storage'), import('@/domain/serialize')])
      const benchDb = createKnovitesDatabase('knovites-dev-bench')
      await benchDb.open()
      try {
        await benchDb.nodes.clear()
        const rows = loaded.entries
          .filter((e) => e.node !== undefined)
          .map((e) => {
            const node = e.node!
            const parentPath = e.path.includes('/')
              ? e.path.slice(0, e.path.lastIndexOf('/'))
              : null
            const parentEntry = parentPath
              ? loaded.entries.find((p) => p.path === parentPath)
              : undefined
            return {
              id: node.id,
              path: e.path,
              basePath: e.path,
              parentId: parentEntry?.node?.id ?? null,
              meta: node,
              rawNodeJson: serializeNodeJson(node),
              baseBlobSha: null,
              dirty: 0 as const,
              corrupt: false,
              extraFiles: [],
              hasCanvas: false,
              deletedAt: 0,
            }
          })
        await benchDb.nodes.bulkPut(rows)
        const t0 = performance.now()
        const entries = await loadTreeBuildEntries(benchDb)
        buildTree(entries)
        setHydrateMs(Number((performance.now() - t0).toFixed(2)))
      } finally {
        await benchDb.delete()
      }
    } finally {
      setHydrating(false)
    }
  }, [hydrating, loaded])

  const handleSelectNode = useCallback((nodeId: string) => {
    if (nodeId.startsWith(OVERFLOW_NODE_PREFIX)) {
      const parentId = nodeId.slice(OVERFLOW_NODE_PREFIX.length)
      setExpandedOverflowParentIds((prev) => new Set(prev).add(parentId))
      return
    }
    setFocusId(nodeId)
  }, [])

  const fixedViewport =
    Number.isFinite(fixedW) && fixedW > 0 && Number.isFinite(fixedH) && fixedH > 0
      ? { width: fixedW, height: fixedH, scale: staticScale }
      : undefined

  return (
    <section
      data-testid="dev-map-route"
      data-ready={loaded ? 'true' : 'false'}
      data-interactive={isInteractive ? 'true' : 'false'}
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
          {!isInteractive ? (
            <>
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
                  value={String(staticTier)}
                  onChange={(e) => updateParam('tier', e.target.value)}
                  className="rounded border border-border bg-background px-1.5 py-0.5 text-foreground"
                >
                  <option value="0">0</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="dev-bench-hydrate"
                onClick={() => void handleBenchmarkHydrate()}
                disabled={!loaded || hydrating}
                className="rounded border border-border bg-secondary px-2 py-0.5 text-xs text-foreground hover:bg-secondary/80 disabled:opacity-50"
              >
                {hydrating ? 'Hydrating…' : 'Measure hydrate'}
              </button>
              <button
                type="button"
                data-testid="dev-perf-reset"
                onClick={handleResetPerf}
                className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-secondary/50"
              >
                Reset pengukuran
              </button>
            </>
          )}
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
          data-layout-ms={String(layoutMs)}
          data-hydrate-ms={hydrateMs !== null ? String(hydrateMs) : ''}
          data-fps-p50={String(perfSummary.p50Fps)}
          data-fps-p95={String(perfSummary.p95Fps)}
          data-fps-max={String(perfSummary.maxFps)}
          data-fps-samples={String(perfSummary.sampleCount)}
          data-non-converged={computed.hitMaxPasses || computed.overlapCount > 0 ? 'true' : 'false'}
          className="flex flex-wrap items-center gap-2 rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-foreground"
        >
          <span>nodes:{computed.layout.diagnostics.nodeCount}</span>
          <span>layout:{layoutMs}ms</span>
          {isInteractive ? (
            <>
              <span>
                fps(5s):{perfSummary.p50Fps}/{perfSummary.p95Fps}/{perfSummary.maxFps}
              </span>
              <span>hydrate:{hydrateMs !== null ? `${hydrateMs}ms` : '—'}</span>
            </>
          ) : (
            <>
              <span>passes:{computed.passesUsed}</span>
              <span>overlaps:{computed.overlapCount}</span>
              <span>crossings:{computed.edgeCrossings}</span>
              <span>maxR:{computed.maxRadiusPx}px</span>
              <span>
                bbox:{Math.round(computed.bbox.width)}×{Math.round(computed.bbox.height)}
              </span>
            </>
          )}
          {computed.hitMaxPasses || computed.overlapCount > 0 ? (
            <span className="rounded bg-destructive/20 px-1 font-semibold text-destructive">
              NON-CONVERGED
            </span>
          ) : null}
        </aside>
      </div>

      {isInteractive && loaded ? (
        <MapHudControls
          orientation={mode}
          zoomScale={interactiveScale}
          zoomTier={interactiveTier}
          onOrientationChange={handleOrientationChange}
          onZoomIn={() => viewportRef.current?.zoomIn()}
          onZoomOut={() => viewportRef.current?.zoomOut()}
          onFitAll={() => viewportRef.current?.fitAll()}
          onRecenterFocus={() => viewportRef.current?.recenterFocus()}
        />
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {loaded ? (
          isInteractive ? (
            <MapViewport
              ref={viewportRef}
              layout={computed.layout}
              visible={computed.visible}
              focusId={effectiveFocusId}
              orientation={mode}
              theme={resolvedTheme}
              measureText={measurer.measure}
              onSelectNode={handleSelectNode}
              onScaleTierChange={(nextScale, nextTier) => {
                setInteractiveScale(nextScale)
                setInteractiveTier(nextTier)
              }}
              onFrameSample={(dtMs) => perfWindowRef.current.push(dtMs, performance.now())}
            />
          ) : (
            <MapSvgView
              layout={computed.layout}
              visible={computed.visible}
              orientation={mode}
              theme={resolvedTheme}
              fixedViewport={fixedViewport}
              hudTopReservePx={fixedViewport ? MAP_HUD_TOP_RESERVE_PX : 0}
              measureText={measurer.measure}
              onSelectNode={handleSelectNode}
            />
          )
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading dataset…
          </div>
        )}
      </div>
    </section>
  )
}

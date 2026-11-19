import { Moon, RotateCcw, Sun, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MANDATORY_MAP_DATASETS, type NamedMapDataset } from '@/domain/datasets'
import { buildTree, type TreeNode } from '@/domain/tree'
import { Button } from '@/ui/components/button'
import { VIRTUAL_ROOT_ID, type ZoomTier } from './compute-visible'
import {
  RadialMapSpike,
  type RadialMapMetrics,
  type TransitionBenchmarkResult,
} from './RadialMapSpike'

type DatasetId = NamedMapDataset['id']

const DATASET_OPTIONS: readonly { id: DatasetId; label: string }[] = [
  { id: 'unbalanced150', label: '150 Nodes (Unbalanced)' },
  { id: 'wide60Children', label: '60 Children (Wide Hub)' },
  { id: 'chainDepth12', label: 'Chain Depth 12' },
  { id: 'root20Children', label: 'Root 20 Children' },
  { id: 'large2000', label: '2,000 Nodes (Scale)' },
]

function pickDeepFocusId(
  datasetId: DatasetId,
  tree: ReturnType<typeof buildTree>['state'],
): string {
  if (datasetId === 'wide60Children') {
    return tree.rootIds[0] ?? VIRTUAL_ROOT_ID
  }
  if (datasetId === 'root20Children') {
    return tree.rootIds[3] ?? tree.rootIds[0] ?? VIRTUAL_ROOT_ID
  }
  if (datasetId === 'chainDepth12') {
    // Focus depth ~8 along the 12-level chain so ancestors AND descendants remain visible
    let cursor: string | undefined = tree.rootIds[0]
    for (let i = 0; i < 8 && cursor; i += 1) {
      const children: string[] | undefined = tree.nodes[cursor]?.childrenIds
      if (!children || children.length === 0) break
      cursor = children[0]
    }
    return cursor ?? VIRTUAL_ROOT_ID
  }

  // unbalanced150 / large2000: pick a depth-3 node that also has children
  let bestId: string | null = null
  let bestScore = -1
  for (const node of Object.values(tree.nodes)) {
    let depth = 0
    let p = node.parentId
    while (p) {
      depth += 1
      p = tree.nodes[p]?.parentId ?? null
    }
    if (depth >= 2 && depth <= 4 && node.childrenIds.length >= 2) {
      const score = node.childrenIds.length + depth * 2
      if (score > bestScore) {
        bestScore = score
        bestId = node.id
      }
    }
  }
  return bestId ?? tree.rootIds[0] ?? VIRTUAL_ROOT_ID
}

declare global {
  interface Window {
    __S3_API__?: {
      setDataset: (id: DatasetId) => void
      setTheme: (theme: 'dark' | 'light') => void
      setFocusRoot: () => void
      setFocusDeep: () => string
      expandAllOverflow: () => void
      getMetrics: () => RadialMapMetrics | null
      measureTransitionToDeep: () => Promise<TransitionBenchmarkResult | null>
    }
  }
}

export function SpikeApp() {
  const [datasetId, setDatasetId] = useState<DatasetId>('unbalanced150')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [focusId, setFocusId] = useState<string>(VIRTUAL_ROOT_ID)
  const [zoomTier, setZoomTier] = useState<ZoomTier>(1)
  const [expandedOverflow, setExpandedOverflow] = useState<Set<string>>(() => new Set())
  const [metrics, setMetrics] = useState<RadialMapMetrics | null>(null)
  const [lastBench, setLastBench] = useState<TransitionBenchmarkResult | null>(null)

  const controlsRef = useRef<{
    zoomIn: () => void
    zoomOut: () => void
    fitAll: () => void
    recenterFocus: () => void
    measureTransition: (targetFocusId: string) => Promise<TransitionBenchmarkResult>
  } | null>(null)

  // Apply theme class to <html> without partial transition flashes
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-switching')
    root.classList.remove('dark', 'light')
    root.classList.add(theme)
    const raf = requestAnimationFrame(() => {
      root.classList.remove('theme-switching')
    })
    return () => cancelAnimationFrame(raf)
  }, [theme])

  const dataset = MANDATORY_MAP_DATASETS[datasetId]
  const tree = useMemo(() => buildTree(dataset.entries).state, [dataset])

  const handleSelectDataset = useCallback((nextId: DatasetId) => {
    setDatasetId(nextId)
    setFocusId(VIRTUAL_ROOT_ID)
    setZoomTier(1)
    setExpandedOverflow(new Set())
    setLastBench(null)
  }, [])

  const handleExpandOverflow = useCallback((parentId: string) => {
    setExpandedOverflow((prev) => {
      const next = new Set(prev)
      next.add(parentId)
      return next
    })
  }, [])

  // Build breadcrumb segments Root -> ... -> Focus
  const breadcrumbs = useMemo(() => {
    const segs: Array<{ id: string; label: string }> = []
    if (focusId !== VIRTUAL_ROOT_ID && tree.nodes[focusId]) {
      let cur: string | null = focusId
      while (cur) {
        const n: TreeNode | undefined = tree.nodes[cur]
        if (!n) break
        segs.push({ id: n.id, label: n.meta.title })
        cur = n.parentId
      }
      segs.reverse()
    }
    return [{ id: VIRTUAL_ROOT_ID, label: 'Root' }, ...segs]
  }, [focusId, tree])

  const metricsRef = useRef(metrics)
  useEffect(() => {
    metricsRef.current = metrics
  }, [metrics])

  // Expose Playwright telemetry & automation hooks
  useEffect(() => {
    window.__S3_API__ = {
      setDataset: handleSelectDataset,
      setTheme,
      setFocusRoot: () => setFocusId(VIRTUAL_ROOT_ID),
      setFocusDeep: () => {
        const deepId = pickDeepFocusId(datasetId, tree)
        setFocusId(deepId)
        return deepId
      },
      expandAllOverflow: () => {
        setExpandedOverflow(new Set([focusId, VIRTUAL_ROOT_ID, ...(tree.rootIds ?? [])]))
      },
      getMetrics: () => metricsRef.current,
      measureTransitionToDeep: async () => {
        if (!controlsRef.current) return null
        const target = pickDeepFocusId(datasetId, tree)
        const result = await controlsRef.current.measureTransition(target)
        setLastBench(result)
        return result
      },
    }
    return () => {
      delete window.__S3_API__
    }
  }, [datasetId, focusId, handleSelectDataset, tree])

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* Compact Top Spike Header */}
      <header className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-4 py-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold tracking-wider uppercase text-primary">
            Spike S3 · Radial
          </span>

          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs">
            {breadcrumbs.map((seg, idx) => (
              <span key={seg.id} className="flex items-center gap-1">
                {idx > 0 && <span className="text-muted-foreground">/</span>}
                <button
                  type="button"
                  onClick={() => setFocusId(seg.id)}
                  className={
                    seg.id === focusId
                      ? 'rounded px-1.5 py-0.5 font-semibold text-foreground bg-secondary'
                      : 'rounded px-1.5 py-0.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  }
                >
                  {seg.label}
                </button>
              </span>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="dataset-select">
            Dataset
          </label>
          <select
            id="dataset-select"
            data-testid="dataset-select"
            value={datasetId}
            onChange={(e) => handleSelectDataset(e.target.value as DatasetId)}
            className="h-8 rounded-md border border-border bg-secondary px-2 text-xs font-medium text-foreground"
          >
            {DATASET_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="flex items-center rounded-md border border-border bg-secondary p-0.5 text-xs">
            {([0, 1, 2] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setZoomTier(t)}
                className={
                  zoomTier === t
                    ? 'rounded px-2 py-0.5 font-semibold bg-primary text-primary-foreground'
                    : 'rounded px-2 py-0.5 text-muted-foreground hover:text-foreground'
                }
              >
                T{t}
              </button>
            ))}
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const deep = pickDeepFocusId(datasetId, tree)
              setFocusId(deep)
            }}
          >
            Deep Focus
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="theme-toggle"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
        </div>
      </header>

      {/* Main SVG Viewport */}
      <main className="relative flex-1 overflow-hidden">
        <RadialMapSpike
          tree={tree}
          rootTitle={dataset.manifest.title}
          focusId={focusId}
          onFocusChange={setFocusId}
          zoomTier={zoomTier}
          onZoomTierChange={setZoomTier}
          expandedOverflowParentIds={expandedOverflow}
          onExpandOverflow={handleExpandOverflow}
          onMetricsChange={setMetrics}
          onRegisterControls={(c) => {
            controlsRef.current = c
          }}
        />

        {/* Telemetry HUD (top-right) */}
        <aside
          data-testid="spike-telemetry"
          className="pointer-events-none absolute top-3 right-3 rounded-lg border border-border bg-card/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
        >
          <div className="font-semibold text-foreground">Metrics</div>
          {metrics ? (
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              <dt>Visible / Total</dt>
              <dd className="text-right font-mono text-foreground">
                {metrics.visibleCount} / {metrics.totalNodes}
              </dd>
              <dt>Overlaps</dt>
              <dd
                data-testid="overlap-count"
                className={
                  metrics.overlapCount === 0
                    ? 'text-right font-mono text-emerald-400'
                    : 'text-right font-mono text-destructive'
                }
              >
                {metrics.overlapCount}
              </dd>
              <dt>Layout ms</dt>
              <dd className="text-right font-mono text-foreground">
                {metrics.layoutMs.toFixed(2)} ms
              </dd>
            </dl>
          ) : null}
          {lastBench ? (
            <dl className="mt-1.5 border-t border-border pt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              <dt>Anim p50 / p95</dt>
              <dd className="text-right font-mono text-foreground">
                {lastBench.p50Ms.toFixed(1)} / {lastBench.p95Ms.toFixed(1)} ms
              </dd>
            </dl>
          ) : null}
        </aside>

        {/* Zoom Controls (bottom-right) */}
        <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur-sm">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => controlsRef.current?.zoomOut()}
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => controlsRef.current?.zoomIn()}
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => controlsRef.current?.recenterFocus()}
          >
            Center
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Fit all"
            onClick={() => controlsRef.current?.fitAll()}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </main>
    </div>
  )
}

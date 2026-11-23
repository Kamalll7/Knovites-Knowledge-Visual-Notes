/** Rolling window duration (ms) for dev FPS/frame-time HUD (`T3.5`, `FR-MAP-17`). */
export const PERF_WINDOW_MS = 5_000

export interface FrameSample {
  readonly ts: number
  readonly dtMs: number
}

export interface PerfWindowSummary {
  readonly sampleCount: number
  readonly p50Fps: number
  readonly p95Fps: number
  readonly maxFps: number
  readonly p50Ms: number
  readonly p95Ms: number
  readonly maxMs: number
}

export const EMPTY_PERF_SUMMARY: PerfWindowSummary = Object.freeze({
  sampleCount: 0,
  p50Fps: 0,
  p95Fps: 0,
  maxFps: 0,
  p50Ms: 0,
  p95Ms: 0,
  maxMs: 0,
})

function percentile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(sortedAsc.length * q) - 1))
  return sortedAsc[idx]!
}

function dtToFps(dtMs: number): number {
  if (!(dtMs > 0)) return 0
  return Math.min(240, Number((1000 / dtMs).toFixed(1)))
}

/**
 * Pure 5-second rolling-window frame-time tracker used exclusively by the dev-only
 * measurement HUD (`DevMapRoute.tsx`, tree-shaken out of production bundles).
 */
export class RollingPerfWindow {
  private readonly windowMs: number
  private samples: FrameSample[] = []

  constructor(windowMs: number = PERF_WINDOW_MS) {
    this.windowMs = windowMs
  }

  push(dtMs: number, nowMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > 2_000) return
    this.samples.push({ ts: nowMs, dtMs })
    this.prune(nowMs)
  }

  prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs
    let firstValid = 0
    while (firstValid < this.samples.length && this.samples[firstValid]!.ts < cutoff) {
      firstValid += 1
    }
    if (firstValid > 0) {
      this.samples = this.samples.slice(firstValid)
    }
  }

  reset(): void {
    this.samples = []
  }

  summarize(nowMs?: number): PerfWindowSummary {
    if (nowMs !== undefined) this.prune(nowMs)
    if (this.samples.length === 0) {
      return { sampleCount: 0, p50Fps: 0, p95Fps: 0, maxFps: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 }
    }
    const dts = this.samples.map((s) => s.dtMs).sort((a, b) => a - b)
    const minMs = dts[0]!
    const p50Ms = percentile(dts, 0.5)
    const p95Ms = percentile(dts, 0.95)
    const maxMs = dts[dts.length - 1]!
    return {
      sampleCount: dts.length,
      p50Fps: dtToFps(p50Ms),
      p95Fps: dtToFps(p95Ms),
      maxFps: dtToFps(minMs),
      p50Ms: Number(p50Ms.toFixed(1)),
      p95Ms: Number(p95Ms.toFixed(1)),
      maxMs: Number(maxMs.toFixed(1)),
    }
  }
}

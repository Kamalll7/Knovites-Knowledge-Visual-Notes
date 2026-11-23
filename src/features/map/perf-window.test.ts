import { describe, expect, it } from 'vitest'

import { PERF_WINDOW_MS, RollingPerfWindow } from '@/features/map/perf-window'

describe('RollingPerfWindow [T3.5-fix dev HUD]', () => {
  it('computes p50/p95/min FPS (worst-case from maxMs) over a 5-second rolling window and prunes stale samples', () => {
    const win = new RollingPerfWindow(PERF_WINDOW_MS)
    expect(win.summarize().sampleCount).toBe(0)

    // Add stale slow samples at t = 1000..1100
    win.push(50, 1_000)
    win.push(40, 1_100)

    // Add fast 120fps (8.33ms), steady 60fps (~16.67ms), and one 50ms worst-case jank frame inside [2000..7000]
    win.push(8.33, 2_300)
    for (let i = 0; i < 18; i += 1) {
      win.push(16.67, 2_500 + i * 200)
    }
    win.push(50, 6_500)

    // Summarize at t = 7000: stale t <= 1999 samples must be pruned
    const summary = win.summarize(7_000)
    expect(summary.sampleCount).toBe(20)
    expect(summary.p50Fps).toBeCloseTo(60, 0)
    expect(summary.p95Fps).toBeCloseTo(60, 0)
    expect(summary.maxMs).toBeCloseTo(50, 1)
    // Worst-case minFps MUST be derived from maxMs (1000 / 50 = 20 fps), NOT minMs (120 fps)
    expect(summary.minFps).toBeCloseTo(20, 0)
    expect(summary.minFps).toBeLessThanOrEqual(summary.p95Fps)
    expect(summary.p95Fps).toBeLessThanOrEqual(summary.p50Fps)

    // Reset clears all samples immediately
    win.reset()
    expect(win.summarize(7_100)).toEqual({
      sampleCount: 0,
      p50Fps: 0,
      p95Fps: 0,
      minFps: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    })
  })
})

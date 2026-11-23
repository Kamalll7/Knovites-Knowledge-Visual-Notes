import { describe, expect, it } from 'vitest'

import { PERF_WINDOW_MS, RollingPerfWindow } from '@/features/map/perf-window'

describe('RollingPerfWindow [T3.5 dev HUD]', () => {
  it('computes p50/p95/max FPS over a 5-second rolling window and prunes stale samples', () => {
    const win = new RollingPerfWindow(PERF_WINDOW_MS)
    expect(win.summarize().sampleCount).toBe(0)

    // Add stale slow samples at t = 1000..1100
    win.push(50, 1_000)
    win.push(40, 1_100)

    // Add steady 60fps (~16.67ms) + one 33.33ms jank frame inside [2000..7000]
    for (let i = 0; i < 19; i += 1) {
      win.push(16.67, 2_500 + i * 200)
    }
    win.push(33.33, 6_500)

    // Summarize at t = 7000: stale t <= 1999 samples must be pruned
    const summary = win.summarize(7_000)
    expect(summary.sampleCount).toBe(20)
    expect(summary.p50Fps).toBeCloseTo(60, 0)
    expect(summary.p95Fps).toBeCloseTo(60, 0)
    expect(summary.maxMs).toBeCloseTo(33.3, 1)
    expect(summary.maxFps).toBeCloseTo(60, 0)

    // Reset clears all samples immediately
    win.reset()
    expect(win.summarize(7_100)).toEqual({
      sampleCount: 0,
      p50Fps: 0,
      p95Fps: 0,
      maxFps: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    })
  })
})

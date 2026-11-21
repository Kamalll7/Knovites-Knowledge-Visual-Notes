import { useEffect, useState } from 'react'
import { subscribeTelemetry } from './browser-bridge'
import type { RateGuardStats } from './rate-guard'

const INITIAL_STATS: RateGuardStats = {
  readCount: 0,
  writeCount: 0,
  minRemainingSeen: null,
  lastRemaining: null,
  lastResetEpoch: null,
  writeThrottleWaitMs: 0,
}

export function SpikeApp() {
  const [stats, setStats] = useState<RateGuardStats>(INITIAL_STATS)

  useEffect(() => {
    return subscribeTelemetry(setStats)
  }, [])

  return (
    <main className="s1-shell" data-testid="s1-harness">
      <h1>Spike S1 — GitHub Git Data API Browser Harness</h1>
      <p>
        Mode otomatis dikendalikan oleh Playwright (token hanya berada di memori sesi uji dan tidak
        pernah disimpan ke DOM atau penyimpanan persisten).
      </p>
      <div className="s1-stats">
        <div className="s1-card">
          <div className="s1-label">Reads</div>
          <div className="s1-value" data-testid="s1-reads">
            {stats.readCount}
          </div>
        </div>
        <div className="s1-card">
          <div className="s1-label">Writes</div>
          <div className="s1-value" data-testid="s1-writes">
            {stats.writeCount}
          </div>
        </div>
        <div className="s1-card">
          <div className="s1-label">Quota Remaining</div>
          <div className="s1-value" data-testid="s1-remaining">
            {stats.lastRemaining ?? '—'}
          </div>
        </div>
        <div className="s1-card">
          <div className="s1-label">Throttle Sleep (ms)</div>
          <div className="s1-value" data-testid="s1-throttle">
            {Math.round(stats.writeThrottleWaitMs)}
          </div>
        </div>
      </div>
    </main>
  )
}

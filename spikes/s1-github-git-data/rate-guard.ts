import { redactHeaders, redactSecrets } from './redact'

export const MAX_WRITES_PER_RUN = 350
export const MIN_WRITE_DELAY_MS = 1050
export const MAX_READ_CONCURRENCY = 4
export const MIN_RATE_LIMIT_REMAINING = 500

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export interface RateGuardStats {
  readCount: number
  writeCount: number
  minRemainingSeen: number | null
  lastRemaining: number | null
  lastResetEpoch: number | null
  writeThrottleWaitMs: number
}

export class RateGuardAbortError extends Error {
  readonly status: number | null
  readonly retryAfter: string | null
  readonly remaining: number | null

  constructor(
    message: string,
    options?: {
      status?: number | null
      retryAfter?: string | null
      remaining?: number | null
    },
  ) {
    super(redactSecrets(message))
    this.name = 'RateGuardAbortError'
    this.status = options?.status ?? null
    this.retryAfter = options?.retryAfter ?? null
    this.remaining = options?.remaining ?? null
  }
}

export class RateGuard {
  private writeQueue: Promise<void> = Promise.resolve()
  private lastWriteFinishedAt = 0
  private activeReads = 0
  private readWaiters: Array<() => void> = []

  private readonly maxWrites: number
  private readonly minWriteDelayMs: number
  private readonly maxReadConcurrency: number
  private readonly minRemainingQuota: number

  private readCount = 0
  private writeCount = 0
  private minRemainingSeen: number | null = null
  private lastRemaining: number | null = null
  private lastResetEpoch: number | null = null
  private writeThrottleWaitMs = 0

  constructor(options?: {
    maxWrites?: number
    minWriteDelayMs?: number
    maxReadConcurrency?: number
    minRemainingQuota?: number
  }) {
    this.maxWrites = options?.maxWrites ?? MAX_WRITES_PER_RUN
    this.minWriteDelayMs = options?.minWriteDelayMs ?? MIN_WRITE_DELAY_MS
    this.maxReadConcurrency = options?.maxReadConcurrency ?? MAX_READ_CONCURRENCY
    this.minRemainingQuota = options?.minRemainingQuota ?? MIN_RATE_LIMIT_REMAINING
  }

  getStats(): RateGuardStats {
    return {
      readCount: this.readCount,
      writeCount: this.writeCount,
      minRemainingSeen: this.minRemainingSeen,
      lastRemaining: this.lastRemaining,
      lastResetEpoch: this.lastResetEpoch,
      writeThrottleWaitMs: this.writeThrottleWaitMs,
    }
  }

  async scheduleRequest(method: string, executor: () => Promise<Response>): Promise<Response> {
    const normalized = method.toUpperCase()
    if (WRITE_METHODS.has(normalized)) {
      return this.runWrite(executor)
    }
    return this.runRead(executor)
  }

  private async runWrite(executor: () => Promise<Response>): Promise<Response> {
    let releaseQueue!: () => void
    const previous = this.writeQueue
    this.writeQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    await previous

    try {
      if (this.writeCount >= this.maxWrites) {
        throw new RateGuardAbortError(
          `Write budget exceeded (${this.writeCount} >= ${this.maxWrites})`,
        )
      }
      if (this.lastWriteFinishedAt > 0) {
        const elapsed = Date.now() - this.lastWriteFinishedAt
        const waitMs = this.minWriteDelayMs - elapsed
        if (waitMs > 0) {
          this.writeThrottleWaitMs += waitMs
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
        }
      }
      this.writeCount += 1
      const response = await executor()
      this.lastWriteFinishedAt = Date.now()
      this.inspectResponseHeaders(response)
      return response
    } finally {
      releaseQueue()
    }
  }

  private async runRead(executor: () => Promise<Response>): Promise<Response> {
    if (this.activeReads >= this.maxReadConcurrency) {
      await new Promise<void>((resolve) => {
        this.readWaiters.push(resolve)
      })
    }
    this.activeReads += 1
    this.readCount += 1
    try {
      const response = await executor()
      this.inspectResponseHeaders(response)
      return response
    } finally {
      this.activeReads -= 1
      const next = this.readWaiters.shift()
      if (next) next()
    }
  }

  inspectResponseHeaders(response: Response): void {
    const headers = redactHeaders(response.headers)
    const retryAfter = headers['retry-after'] ?? null
    const remainingRaw = headers['x-ratelimit-remaining']
    const resetRaw = headers['x-ratelimit-reset']

    const remaining = remainingRaw !== undefined ? Number(remainingRaw) : null
    if (remaining !== null && Number.isFinite(remaining)) {
      this.lastRemaining = remaining
      this.minRemainingSeen =
        this.minRemainingSeen === null ? remaining : Math.min(this.minRemainingSeen, remaining)
    }
    if (resetRaw !== undefined && Number.isFinite(Number(resetRaw))) {
      this.lastResetEpoch = Number(resetRaw)
    }

    if (response.status === 403 || response.status === 429) {
      throw new RateGuardAbortError(
        `GitHub rate/permission abort HTTP ${response.status}` +
          (retryAfter ? ` (retry-after: ${retryAfter}s)` : '') +
          (remaining !== null ? ` (remaining: ${remaining})` : ''),
        { status: response.status, retryAfter, remaining },
      )
    }

    if (remaining !== null && Number.isFinite(remaining) && remaining < this.minRemainingQuota) {
      throw new RateGuardAbortError(
        `GitHub rate-limit safety stop: remaining ${remaining} < ${this.minRemainingQuota}`,
        { status: response.status, retryAfter, remaining },
      )
    }
  }
}

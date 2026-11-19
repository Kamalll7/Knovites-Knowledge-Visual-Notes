export type TabLockRole = 'writer' | 'readonly'

export interface TabLockCoordinator {
  acquire: (onRoleChange: (role: TabLockRole) => void) => Promise<TabLockRole>
  takeOver: () => Promise<TabLockRole>
  release: () => Promise<void>
  getRole: () => TabLockRole
}

export interface BrowserTabLockOptions {
  lockName?: string
  channelName?: string
  locks?: Pick<LockManager, 'request'> | undefined
  createChannel?: (name: string) => BroadcastChannel | null
}

type LockChannelMessage =
  { type: 'writer_claiming'; ownerId: string } | { type: 'writer_acquired'; ownerId: string }

const DEFAULT_LOCK_NAME = 'knovites-writer-lock'
const DEFAULT_CHANNEL_NAME = 'knovites-writer-lock'

let fallbackInstanceCounter = 0

function makeInstanceId(): string {
  fallbackInstanceCounter += 1
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tab-${fallbackInstanceCounter}`
}

function createDefaultChannel(name: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null
  }
  try {
    return new BroadcastChannel(name)
  } catch {
    return null
  }
}

/**
 * Coordinates single-writer tab locking across browser tabs using the Web Locks API
 * (`ifAvailable: true` for passive check, `{ steal: true }` for manual Take over)
 * paired with `BroadcastChannel` for instant demotion notification (`FR-LOC-05`).
 */
export function createBrowserTabLockCoordinator(
  options: BrowserTabLockOptions = {},
): TabLockCoordinator {
  const lockName = options.lockName ?? DEFAULT_LOCK_NAME
  const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME
  const locks =
    'locks' in options
      ? options.locks
      : typeof navigator !== 'undefined'
        ? navigator.locks
        : undefined
  const createChannel = options.createChannel ?? createDefaultChannel
  const instanceId = makeInstanceId()

  let active = false
  let currentRole: TabLockRole = 'readonly'
  let roleListener: ((role: TabLockRole) => void) | null = null
  let holdResolver: (() => void) | null = null
  let activeLockPromise: Promise<void> | null = null
  let pendingRelease: Promise<void> | null = null
  let channel: BroadcastChannel | null = null

  const setRole = (role: TabLockRole) => {
    currentRole = role
    roleListener?.(role)
  }

  const releaseHold = () => {
    const resolve = holdResolver
    holdResolver = null
    resolve?.()
  }

  const postChannel = (msg: LockChannelMessage) => {
    try {
      channel?.postMessage(msg)
    } catch {
      // Ignore closed channel or restricted environments
    }
  }

  const ensureChannel = () => {
    if (channel) return
    const nextChannel = createChannel(channelName)
    if (!nextChannel) return
    channel = nextChannel
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!active) return
      const data = event.data as Partial<LockChannelMessage> | null
      if (!data || typeof data.ownerId !== 'string' || data.ownerId === instanceId) {
        return
      }
      if (data.type === 'writer_claiming' || data.type === 'writer_acquired') {
        if (currentRole === 'writer' || holdResolver !== null) {
          releaseHold()
          setRole('readonly')
        }
      }
    }
  }

  const closeChannel = () => {
    if (!channel) return
    try {
      channel.onmessage = null
      channel.close()
    } catch {
      // Ignore close failures
    }
    channel = null
  }

  const holdGrantedLock = (): Promise<void> => {
    releaseHold()
    return new Promise<void>((resolve) => {
      holdResolver = resolve
    })
  }

  return {
    acquire: async (onRoleChange) => {
      if (pendingRelease) {
        await pendingRelease
      }

      active = true
      roleListener = onRoleChange
      ensureChannel()

      if (!locks || typeof locks.request !== 'function') {
        setRole('writer')
        return 'writer'
      }

      return new Promise<TabLockRole>((resolveInitial) => {
        let settled = false
        const settle = (role: TabLockRole) => {
          if (settled) return
          settled = true
          resolveInitial(role)
        }

        const requestPromise = locks
          .request(lockName, { ifAvailable: true }, async (lock) => {
            if (!active || lock === null) {
              if (active) {
                setRole('readonly')
              }
              settle('readonly')
              return
            }

            const hold = holdGrantedLock()
            setRole('writer')
            postChannel({ type: 'writer_acquired', ownerId: instanceId })
            settle('writer')
            await hold
          })
          .catch(() => {
            if (active) {
              setRole('readonly')
            }
            settle('readonly')
          })

        activeLockPromise = requestPromise
      })
    },

    takeOver: async () => {
      if (!active) {
        return currentRole
      }
      if (!locks || typeof locks.request !== 'function') {
        setRole('writer')
        return 'writer'
      }

      postChannel({ type: 'writer_claiming', ownerId: instanceId })
      releaseHold()
      if (activeLockPromise) {
        // Give previous in-instance lock callback a microtask if any, without blocking if stale
        await Promise.race([activeLockPromise, Promise.resolve()])
      }

      return new Promise<TabLockRole>((resolveTakeOver) => {
        let settled = false
        const settle = (role: TabLockRole) => {
          if (settled) return
          settled = true
          resolveTakeOver(role)
        }

        const requestPromise = locks
          .request(lockName, { steal: true }, async (lock) => {
            if (!active || lock === null) {
              settle(currentRole)
              return
            }

            const hold = holdGrantedLock()
            setRole('writer')
            postChannel({ type: 'writer_acquired', ownerId: instanceId })
            settle('writer')
            await hold
          })
          .catch(() => {
            settle(currentRole)
          })

        activeLockPromise = requestPromise
      })
    },

    release: async () => {
      active = false
      closeChannel()
      releaseHold()
      const inflight = activeLockPromise
      activeLockPromise = null
      if (inflight) {
        pendingRelease = inflight.finally(() => {
          pendingRelease = null
        })
        await pendingRelease
      }
    },

    getRole: () => currentRole,
  }
}

export interface FakeTabLockRegistry {
  createClient: (clientId: string) => TabLockCoordinator
  getActiveWriterId: () => string | null
}

/**
 * Deterministic in-memory multi-tab lock coordinator for unit tests.
 */
export function createFakeTabLockRegistry(): FakeTabLockRegistry {
  let writerId: string | null = null
  const clients = new Map<
    string,
    {
      role: TabLockRole
      onRoleChange: ((role: TabLockRole) => void) | null
    }
  >()

  return {
    createClient: (clientId: string): TabLockCoordinator => {
      clients.set(clientId, { role: 'readonly', onRoleChange: null })

      return {
        acquire: async (onRoleChange) => {
          const entry = clients.get(clientId)!
          entry.onRoleChange = onRoleChange
          const nextRole: TabLockRole =
            writerId === null || writerId === clientId ? 'writer' : 'readonly'
          if (nextRole === 'writer') {
            writerId = clientId
          }
          entry.role = nextRole
          onRoleChange(nextRole)
          return nextRole
        },

        takeOver: async () => {
          if (writerId !== null && writerId !== clientId) {
            const prev = clients.get(writerId)
            if (prev) {
              prev.role = 'readonly'
              prev.onRoleChange?.('readonly')
            }
          }
          writerId = clientId
          const entry = clients.get(clientId)!
          entry.role = 'writer'
          entry.onRoleChange?.('writer')
          return 'writer'
        },

        release: async () => {
          const entry = clients.get(clientId)
          if (entry) {
            entry.role = 'readonly'
            entry.onRoleChange = null
          }
          if (writerId === clientId) {
            writerId = null
          }
        },

        getRole: () => clients.get(clientId)?.role ?? 'readonly',
      }
    },

    getActiveWriterId: () => writerId,
  }
}

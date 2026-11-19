import { describe, expect, it, vi } from 'vitest'
import {
  createBrowserTabLockCoordinator,
  createFakeTabLockRegistry,
  requestPersistentStorage,
  type StoragePersistNavigator,
  type TabLockRole,
} from '@/storage'

class MockBroadcastChannel {
  private static readonly peers = new Map<string, Set<MockBroadcastChannel>>()
  readonly name: string
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null

  constructor(name: string) {
    this.name = name
    const set = MockBroadcastChannel.peers.get(name) ?? new Set()
    set.add(this)
    MockBroadcastChannel.peers.set(name, set)
  }

  postMessage(data: unknown): void {
    const set = MockBroadcastChannel.peers.get(this.name)
    if (!set) return
    for (const peer of set) {
      if (peer !== this && peer.onmessage) {
        peer.onmessage({ data } as MessageEvent<unknown>)
      }
    }
  }

  close(): void {
    MockBroadcastChannel.peers.get(this.name)?.delete(this)
  }
}

describe('storage protection: persist() & Web Locks coordinator [T2.3]', () => {
  it('requestPersistentStorage handles missing API, false/true results, and errors without throwing', async () => {
    expect(await requestPersistentStorage(undefined)).toBe(false)
    expect(await requestPersistentStorage({})).toBe(false)
    expect(await requestPersistentStorage({ storage: {} })).toBe(false)

    const grantedNav: StoragePersistNavigator = {
      storage: { persist: vi.fn().mockResolvedValue(true) },
    }
    expect(await requestPersistentStorage(grantedNav)).toBe(true)

    const deniedNav: StoragePersistNavigator = {
      storage: { persist: vi.fn().mockResolvedValue(false) },
    }
    expect(await requestPersistentStorage(deniedNav)).toBe(false)

    const throwingNav: StoragePersistNavigator = {
      storage: {
        persist: () => {
          throw new Error('SecurityError: storage denied')
        },
      },
    }
    expect(await requestPersistentStorage(throwingNav)).toBe(false)

    const rejectingNav: StoragePersistNavigator = {
      storage: { persist: vi.fn().mockRejectedValue(new Error('Permission dismissed')) },
    }
    expect(await requestPersistentStorage(rejectingNav)).toBe(false)
  })

  it('fake registry grants writer to first tab, readonly to second, and transfers on takeOver', async () => {
    const registry = createFakeTabLockRegistry()
    const client1 = registry.createClient('tab-1')
    const client2 = registry.createClient('tab-2')

    const roles1: TabLockRole[] = []
    const roles2: TabLockRole[] = []

    expect(await client1.acquire((r) => roles1.push(r))).toBe('writer')
    expect(registry.getActiveWriterId()).toBe('tab-1')

    expect(await client2.acquire((r) => roles2.push(r))).toBe('readonly')
    expect(registry.getActiveWriterId()).toBe('tab-1')

    expect(await client2.takeOver()).toBe('writer')
    expect(registry.getActiveWriterId()).toBe('tab-2')
    expect(client1.getRole()).toBe('readonly')
    expect(client2.getRole()).toBe('writer')
    expect(roles1).toEqual(['writer', 'readonly'])
    expect(roles2).toEqual(['readonly', 'writer'])

    await client1.release()
    await client2.release()
    expect(registry.getActiveWriterId()).toBeNull()
  })

  it('browser coordinator falls back safely when navigator.locks is absent and uses ifAvailable/steal + BroadcastChannel', async () => {
    const fallbackRoles: TabLockRole[] = []
    const fallbackCoordinator = createBrowserTabLockCoordinator({ locks: undefined })
    expect(fallbackCoordinator.isSupported()).toBe(false)
    expect(await fallbackCoordinator.acquire((r) => fallbackRoles.push(r))).toBe('writer')
    expect(fallbackRoles).toEqual(['writer'])
    await fallbackCoordinator.release()

    let holderExists = false
    const mockLocks: Pick<LockManager, 'request'> = {
      request: async <T>(
        name: string,
        optionsOrCb: LockOptions | ((lock: Lock | null) => T),
        maybeCb?: (lock: Lock | null) => T,
      ) => {
        const options = typeof optionsOrCb === 'function' ? {} : optionsOrCb
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb!
        if (options.steal) {
          holderExists = true
          return await cb({ name, mode: 'exclusive' } as Lock)
        }
        if (options.ifAvailable && holderExists) {
          return await cb(null)
        }
        holderExists = true
        return await cb({ name, mode: 'exclusive' } as Lock)
      },
    }

    const createChannel = (name: string) =>
      new MockBroadcastChannel(name) as unknown as BroadcastChannel

    const rolesA: TabLockRole[] = []
    const rolesB: TabLockRole[] = []
    const coordA = createBrowserTabLockCoordinator({
      channelName: 'test-channel-unique',
      locks: mockLocks,
      createChannel,
    })
    const coordB = createBrowserTabLockCoordinator({
      channelName: 'test-channel-unique',
      locks: mockLocks,
      createChannel,
    })

    expect(await coordA.acquire((r) => rolesA.push(r))).toBe('writer')
    expect(await coordB.acquire((r) => rolesB.push(r))).toBe('readonly')

    expect(await coordB.takeOver()).toBe('writer')
    expect(rolesA).toEqual(['writer', 'readonly'])
    expect(rolesB).toEqual(['readonly', 'writer'])

    await coordA.release()
    await coordB.release()
  })

  it('handles Web Locks { steal: true } breaking previous holder promise with AbortError without unhandled rejections', async () => {
    const unhandledErrors: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandledErrors.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      let currentHolderReject: ((err: unknown) => void) | null = null

      // Spec-compliant fake LockManager: { steal: true } breaks previous holder by rejecting its request() promise with AbortError
      const specLocks: Pick<LockManager, 'request'> = {
        request: <T>(
          name: string,
          optionsOrCb: LockOptions | ((lock: Lock | null) => T),
          maybeCb?: (lock: Lock | null) => T,
        ): Promise<T> => {
          const options = typeof optionsOrCb === 'function' ? {} : optionsOrCb
          const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb!

          if (options.steal && currentHolderReject) {
            const rejectPrev = currentHolderReject
            currentHolderReject = null
            rejectPrev(
              new DOMException('Lock broken by another request with "steal"', 'AbortError'),
            )
          } else if (options.ifAvailable && currentHolderReject) {
            return Promise.resolve(cb(null))
          }

          return new Promise<T>((resolve, reject) => {
            currentHolderReject = reject
            Promise.resolve(cb({ name, mode: 'exclusive' } as Lock)).then(
              (val) => {
                if (currentHolderReject === reject) {
                  currentHolderReject = null
                }
                resolve(val)
              },
              (err) => {
                if (currentHolderReject === reject) {
                  currentHolderReject = null
                }
                reject(err)
              },
            )
          })
        },
      }

      const rolesA: TabLockRole[] = []
      const rolesB: TabLockRole[] = []
      // Explicitly omit BroadcastChannel to verify AbortError alone cleanly demotes old holder
      const coordA = createBrowserTabLockCoordinator({
        locks: specLocks,
        createChannel: () => null,
      })
      const coordB = createBrowserTabLockCoordinator({
        locks: specLocks,
        createChannel: () => null,
      })

      expect(coordA.isSupported()).toBe(true)
      expect(await coordA.acquire((r) => rolesA.push(r))).toBe('writer')
      expect(await coordB.acquire((r) => rolesB.push(r))).toBe('readonly')

      // Tab B steals lock -> Tab A's locks.request promise rejects with AbortError
      expect(await coordB.takeOver()).toBe('writer')
      await vi.waitFor(() => {
        expect(coordA.getRole()).toBe('readonly')
      })

      // Now Tab A steals lock back after having held via takeOver -> Tab B's takeOver lock promise rejects with AbortError
      expect(await coordA.takeOver()).toBe('writer')
      await vi.waitFor(() => {
        expect(coordB.getRole()).toBe('readonly')
      })

      // Flush microtasks to verify zero unhandledRejection events fired
      await new Promise((r) => setTimeout(r, 10))
      expect(unhandledErrors).toEqual([])

      await coordA.release()
      await coordB.release()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

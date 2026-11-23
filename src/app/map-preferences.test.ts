import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_MAP_ORIENTATION,
  MAP_ORIENTATION_STORAGE_KEY,
  isMapOrientationPreference,
  readStoredMapOrientation,
  useMapOrientationPreference,
  writeStoredMapOrientation,
} from '@/app/map-preferences'

describe('map orientation per-device preference [T3.3b, FR-MAP-04]', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to radial when unset or when storage throws', () => {
    expect(isMapOrientationPreference('radial')).toBe(true)
    expect(isMapOrientationPreference('horizontal')).toBe(true)
    expect(isMapOrientationPreference('invalid')).toBe(false)
    expect(DEFAULT_MAP_ORIENTATION).toBe('radial')
    expect(readStoredMapOrientation()).toBe('radial')

    const brokenStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(readStoredMapOrientation(brokenStorage)).toBe('radial')
    expect(writeStoredMapOrientation('horizontal', brokenStorage)).toBe('horizontal')
  })

  it('persists orientation changes and recovers them across reload (fresh remount)', () => {
    const firstMount = renderHook(() => useMapOrientationPreference())
    expect(firstMount.result.current.orientation).toBe('radial')

    act(() => {
      firstMount.result.current.setOrientation('horizontal')
    })
    expect(firstMount.result.current.orientation).toBe('horizontal')
    expect(window.localStorage.getItem(MAP_ORIENTATION_STORAGE_KEY)).toBe('horizontal')
    firstMount.unmount()

    // Simulate reload: fresh hook mount reads persisted preference
    const reloadedMount = renderHook(() => useMapOrientationPreference())
    expect(reloadedMount.result.current.orientation).toBe('horizontal')

    act(() => {
      reloadedMount.result.current.toggleOrientation()
    })
    expect(reloadedMount.result.current.orientation).toBe('radial')
    expect(window.localStorage.getItem(MAP_ORIENTATION_STORAGE_KEY)).toBe('radial')
    reloadedMount.unmount()

    const thirdMount = renderHook(() => useMapOrientationPreference())
    expect(thirdMount.result.current.orientation).toBe('radial')
  })

  it('falls back to radial for invalid stored values and never stores tokens or note content', () => {
    const invalidValues = [
      '',
      'RADIAL',
      'force-directed',
      'ghp_secretToken1234567890',
      '{"note":"sensitive body","token":"github_pat_xyz"}',
    ]
    for (const bad of invalidValues) {
      window.localStorage.setItem(MAP_ORIENTATION_STORAGE_KEY, bad)
      expect(readStoredMapOrientation()).toBe('radial')
    }

    // Attempted writes of tokens or note text must be sanitized strictly to 'radial'
    const secretToken = 'ghp_1234567890secretToken'
    const noteBody = 'Private CTF writeup notes'
    expect(writeStoredMapOrientation(secretToken)).toBe('radial')
    expect(window.localStorage.getItem(MAP_ORIENTATION_STORAGE_KEY)).toBe('radial')
    expect(window.localStorage.getItem(MAP_ORIENTATION_STORAGE_KEY)).not.toContain('ghp_')

    expect(writeStoredMapOrientation(noteBody)).toBe('radial')
    expect(window.localStorage.getItem(MAP_ORIENTATION_STORAGE_KEY)).toBe('radial')
    expect(window.localStorage.getItem(MAP_ORIENTATION_STORAGE_KEY)).not.toContain('writeup')

    // Only the single preference key exists in localStorage (no extra note/token keys)
    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.key(0)).toBe(MAP_ORIENTATION_STORAGE_KEY)
  })
})

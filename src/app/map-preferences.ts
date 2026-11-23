import { useCallback, useState } from 'react'

export type MapOrientationPreference = 'radial' | 'horizontal'

/** Default map orientation when unset or when stored data is invalid (`FR-MAP-04`, `T3.3b`). */
export const DEFAULT_MAP_ORIENTATION: MapOrientationPreference = 'radial'

/** Per-device preference key alongside `knovites.theme` in `ThemeProvider.tsx`. */
export const MAP_ORIENTATION_STORAGE_KEY = 'knovites.map.orientation'

export interface PreferenceStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function isMapOrientationPreference(value: unknown): value is MapOrientationPreference {
  return value === 'radial' || value === 'horizontal'
}

function getDefaultStorage(): PreferenceStorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Reads the persisted per-device map orientation preference.
 * Any missing, unreadable, or invalid value falls back safely to `'radial'`.
 */
export function readStoredMapOrientation(
  storage?: PreferenceStorageLike | null,
): MapOrientationPreference {
  const target = storage === undefined ? getDefaultStorage() : storage
  if (!target) return DEFAULT_MAP_ORIENTATION
  try {
    const raw = target.getItem(MAP_ORIENTATION_STORAGE_KEY)
    if (isMapOrientationPreference(raw)) {
      return raw
    }
  } catch {
    // Ignore storage access errors (e.g. restricted browsing mode)
  }
  return DEFAULT_MAP_ORIENTATION
}

/**
 * Persists a validated map orientation preference (`'radial' | 'horizontal'`) per device.
 * Strictly allowlists values so note content, tokens, or arbitrary strings are never stored.
 */
export function writeStoredMapOrientation(
  value: unknown,
  storage?: PreferenceStorageLike | null,
): MapOrientationPreference {
  const sanitized: MapOrientationPreference = isMapOrientationPreference(value)
    ? value
    : DEFAULT_MAP_ORIENTATION
  const target = storage === undefined ? getDefaultStorage() : storage
  if (!target) return sanitized
  try {
    target.setItem(MAP_ORIENTATION_STORAGE_KEY, sanitized)
  } catch {
    // Ignore storage errors (e.g. quota exceeded or private browsing)
  }
  return sanitized
}

export interface UseMapOrientationPreferenceResult {
  readonly orientation: MapOrientationPreference
  readonly setOrientation: (next: MapOrientationPreference) => void
  readonly toggleOrientation: () => void
}

/**
 * React hook for per-device map orientation preference (`T3.3b`, `FR-MAP-04`).
 * Mirrors `ThemeProvider.tsx` synchronous `localStorage` persistence with zero Dexie schema changes.
 */
export function useMapOrientationPreference(): UseMapOrientationPreferenceResult {
  const [orientation, setOrientationState] = useState<MapOrientationPreference>(() =>
    readStoredMapOrientation(),
  )

  const setOrientation = useCallback((next: MapOrientationPreference) => {
    const sanitized = writeStoredMapOrientation(next)
    setOrientationState(sanitized)
  }, [])

  const toggleOrientation = useCallback(() => {
    setOrientationState((prev) => {
      const next: MapOrientationPreference = prev === 'radial' ? 'horizontal' : 'radial'
      return writeStoredMapOrientation(next)
    })
  }, [])

  return { orientation, setOrientation, toggleOrientation }
}


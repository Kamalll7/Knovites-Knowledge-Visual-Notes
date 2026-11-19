export interface StoragePersistNavigator {
  storage?: {
    persist?: () => Promise<boolean>
    persisted?: () => Promise<boolean>
  }
}

/**
 * Safely calls `navigator.storage.persist()` when supported (`FR-LOC-04`).
 * Never throws if the StorageManager API is absent, denied, or rejects.
 */
export async function requestPersistentStorage(
  nav: StoragePersistNavigator | undefined = typeof navigator !== 'undefined'
    ? navigator
    : undefined,
): Promise<boolean> {
  try {
    const storage = nav?.storage
    if (!storage || typeof storage.persist !== 'function') {
      return false
    }
    return await storage.persist()
  } catch {
    return false
  }
}

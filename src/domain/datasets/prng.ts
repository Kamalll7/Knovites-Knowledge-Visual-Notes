import { ULID_REGEX } from '@/domain/schema'

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
// Fixed epoch: 2026-11-18T09:00:00Z in milliseconds (never calls Date.now())
const FIXED_EPOCH_MS = 1_795_000_000_000

/**
 * Deterministic 32-bit PRNG (Mulberry32) returning floats in `[0, 1)`.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Returns an integer in `[min, max]` inclusive using the provided PRNG.
 */
export function nextInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/**
 * Picks one item from a non-empty readonly array using the provided PRNG.
 */
export function pickOne<T>(rng: () => number, items: readonly T[]): T {
  const index = Math.floor(rng() * items.length)
  return items[index]!
}

function encodeCrockford(value: number | bigint, length: number): string {
  let v = typeof value === 'bigint' ? value : BigInt(value)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    const digit = Number(v & 31n)
    out = CROCKFORD_ALPHABET[digit]! + out
    v >>= 5n
  }
  return out
}

/**
 * Deterministic ULID generator backed by `mulberry32` and a monotonic fixed epoch.
 * Never reads wall-clock time (`Date.now()`) or `Math.random()`.
 */
export function createSeededUlidGenerator(seed: number): () => string {
  const rng = mulberry32(seed ^ 0x9e3779b9)
  let timestampMs = FIXED_EPOCH_MS
  const issued = new Set<string>()

  return () => {
    while (true) {
      timestampMs += 1 + Math.floor(rng() * 7)
      const timePart = encodeCrockford(timestampMs, 10)
      let randPart = ''
      for (let i = 0; i < 16; i += 1) {
        randPart += CROCKFORD_ALPHABET[Math.floor(rng() * 32)]!
      }
      const ulid = `${timePart}${randPart}`
      if (ULID_REGEX.test(ulid) && !issued.has(ulid)) {
        issued.add(ulid)
        return ulid
      }
    }
  }
}

/**
 * Deterministic ISO 8601 UTC timestamp generator relative to a fixed epoch.
 */
export function createSeededTimestamp(stepIndex: number, offsetMinutes = 0): string {
  const ms = FIXED_EPOCH_MS + (stepIndex + offsetMinutes) * 60_000
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

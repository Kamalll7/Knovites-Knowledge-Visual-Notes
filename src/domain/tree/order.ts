import { generateKeyBetween } from 'fractional-indexing'

const MIN_ASCII = 33 // '!' (printable non-whitespace)

export function compareLexicographical(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function compareSiblings(
  a: { order: string; id: string },
  b: { order: string; id: string },
): number {
  const orderCmp = compareLexicographical(a.order, b.order)
  if (orderCmp !== 0) {
    return orderCmp
  }
  return compareLexicographical(a.id, b.id)
}

export function isValidFractionalKey(key: string): boolean {
  if (key.length === 0) return false
  try {
    generateKeyBetween(key, null)
    return true
  } catch {
    return false
  }
}

function tryFractionalBetween(a: string | null, b: string | null): string | null {
  try {
    const key = generateKeyBetween(a, b)
    if ((a === null || key > a) && (b === null || key < b)) {
      return key
    }
    return null
  } catch {
    return null
  }
}

function lexicographicalBefore(b: string): string {
  for (let i = 0; i < b.length; i += 1) {
    const code = b.charCodeAt(i)
    if (code > MIN_ASCII) {
      const prevCode = code > 48 ? Math.floor((MIN_ASCII + code) / 2) : code - 1
      return b.slice(0, i) + String.fromCharCode(prevCode)
    }
  }
  return '!'
}

function lexicographicalBetween(prevOrder: string | null, nextOrder: string | null): string {
  if (prevOrder === null && nextOrder === null) {
    return 'a0'
  }
  if (prevOrder !== null && nextOrder === null) {
    return `${prevOrder}V`
  }
  if (prevOrder === null && nextOrder !== null) {
    return lexicographicalBefore(nextOrder)
  }

  const a = prevOrder!
  const b = nextOrder!
  if (a === b) {
    return a
  }
  if (a > b) {
    return `${a}V`
  }

  let prefix = ''
  const maxLen = Math.max(a.length, b.length)
  for (let i = 0; i < maxLen; i += 1) {
    const ca = i < a.length ? a.charCodeAt(i) : 0
    const cb = i < b.length ? b.charCodeAt(i) : 0

    if (ca === cb) {
      prefix += a[i]!
      continue
    }

    if (ca === 0) {
      if (cb > MIN_ASCII + 1) {
        return prefix + String.fromCharCode(Math.floor((MIN_ASCII + cb) / 2))
      }
      if (cb === MIN_ASCII + 1) {
        return `${prefix}!`
      }
      // cb === MIN_ASCII: descend past '!'
      prefix += b[i]!
      continue
    }

    if (cb - ca > 1) {
      const mid = Math.max(MIN_ASCII, Math.floor((ca + cb) / 2))
      if (mid > ca && mid < cb) {
        return prefix + String.fromCharCode(mid)
      }
    }

    // Adjacent characters (cb - ca === 1): extending `a` guarantees a < result < b
    return `${a}V`
  }

  return `${a}V`
}

export function generateOrderBetween(prevOrder: string | null, nextOrder: string | null): string {
  if (prevOrder !== null && nextOrder !== null && prevOrder === nextOrder) {
    return prevOrder
  }

  const direct = tryFractionalBetween(prevOrder, nextOrder)
  if (direct !== null) {
    return direct
  }

  // If one bound is invalid for fractional-indexing, try generating from the valid bound alone
  if (prevOrder !== null && nextOrder !== null && prevOrder < nextOrder) {
    const fromPrev = tryFractionalBetween(prevOrder, null)
    if (fromPrev !== null && fromPrev < nextOrder) {
      return fromPrev
    }
    const beforeNext = tryFractionalBetween(null, nextOrder)
    if (beforeNext !== null && beforeNext > prevOrder) {
      return beforeNext
    }
  }

  return lexicographicalBetween(prevOrder, nextOrder)
}

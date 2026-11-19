import { monotonicFactory } from 'ulid'

export function createIdGenerator(): () => string {
  const nextUlid = monotonicFactory()
  return () => nextUlid()
}

export function nowUtcIso(): string {
  return new Date().toISOString()
}

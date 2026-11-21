const registeredSecrets = new Set<string>()

const TOKEN_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/g,
  /gh[pousr]_[A-Za-z0-9_]+/g,
  /(Bearer|token)\s+[A-Za-z0-9._-]+/gi,
]

export function registerSecret(secret: string | undefined | null): void {
  const trimmed = secret?.trim()
  if (trimmed && trimmed.length >= 6) {
    registeredSecrets.add(trimmed)
  }
}

export function redactSecrets(input: string): string {
  let out = input
  for (const secret of registeredSecrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join('[REDACTED]')
    }
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, (_match, scheme?: string) =>
      scheme ? `${scheme} [REDACTED]` : '[REDACTED]',
    )
  }
  return out
}

export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  const entries =
    headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers)
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.toLowerCase()
    if (key === 'authorization' || key === 'cookie' || key === 'set-cookie') {
      result[key] = '[REDACTED]'
    } else {
      result[key] = redactSecrets(rawValue)
    }
  }
  return result
}

export function formatRedactedError(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(`${error.name}: ${error.message}`)
  }
  return redactSecrets(String(error))
}

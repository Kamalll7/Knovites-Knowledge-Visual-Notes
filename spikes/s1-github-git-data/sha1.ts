const encoder = new TextEncoder()

export async function computeGitBlobSha1(content: string | Uint8Array): Promise<string> {
  const payload = typeof content === 'string' ? encoder.encode(content) : content
  const header = encoder.encode(`blob ${payload.byteLength}\0`)
  const combined = new Uint8Array(header.byteLength + payload.byteLength)
  combined.set(header, 0)
  combined.set(payload, header.byteLength)
  const digest = await crypto.subtle.digest('SHA-1', combined)
  const view = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    parts.push(String.fromCharCode(...chunk))
  }
  return btoa(parts.join(''))
}

export function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, '')
  const binary = atob(normalized)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(encoder.encode(text))
}

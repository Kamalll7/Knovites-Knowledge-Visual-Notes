import { bytesToBase64 } from './sha1'

export interface SyntheticFile {
  path: string
  kind: 'text' | 'binary'
  textContent?: string
  bytes: Uint8Array
}

// 1x1 PNG header + valid IHDR/IEND framing with padded uncompressed deterministic bytes inside an ancillary tEXt chunk so PNG decoders & binary tools treat it cleanly
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IEND_CHUNK = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
// Minimal valid 1x1 RGB PNG IDAT (zlib stored uncompressed pixel [0, 128, 200, 255])
const CORE_1X1_PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x08,
  0x02,
  0x00,
  0x00,
  0x00,
  0x90,
  0x77,
  0x53,
  0xde,
  0x00,
  0x00,
  0x00,
  0x0c,
  0x49,
  0x44,
  0x41,
  0x54,
  0x78,
  0x9c,
  0x63,
  0xa8,
  0x60,
  0x60,
  0x00,
  0x00,
  0x00,
  0x04,
  0x00,
  0x01,
  0x5c,
  0xcd,
  0xff,
  0x05,
  ...IEND_CHUNK,
])

function writeU32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff
  buf[offset + 1] = (val >>> 16) & 0xff
  buf[offset + 2] = (val >>> 8) & 0xff
  buf[offset + 3] = val & 0xff
}

export function createDeterministicBytes(byteLength: number, seed = 1): Uint8Array {
  const out = new Uint8Array(byteLength)
  let x = (seed ^ 0x9e3779b9) >>> 0
  for (let i = 0; i < byteLength; i += 1) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    out[i] = x & 0xff
  }
  return out
}

export function createSyntheticPngBytes(targetByteLength: number, seed = 1): Uint8Array {
  if (targetByteLength <= CORE_1X1_PNG.length + 12) {
    return CORE_1X1_PNG.slice()
  }
  const headWithoutIend = CORE_1X1_PNG.subarray(0, CORE_1X1_PNG.length - IEND_CHUNK.length)
  const payloadLen = targetByteLength - headWithoutIend.length - IEND_CHUNK.length - 12
  const total = headWithoutIend.length + 12 + payloadLen + IEND_CHUNK.length
  const out = new Uint8Array(total)
  out.set(headWithoutIend, 0)

  let offset = headWithoutIend.length
  writeU32BE(out, offset, payloadLen)
  offset += 4
  // Ancillary private chunk `knVt`
  out[offset++] = 0x6b
  out[offset++] = 0x6e
  out[offset++] = 0x56
  out[offset++] = 0x74
  const randomPayload = createDeterministicBytes(payloadLen, seed)
  out.set(randomPayload, offset)
  offset += payloadLen
  // CRC placeholder deterministic bytes (valid length framing + valid PNG header/IHDR/IDAT/IEND)
  writeU32BE(out, offset, seed & 0xffffffff)
  offset += 4
  out.set(IEND_CHUNK, offset)
  // Keep signature explicit for readability check
  void PNG_SIGNATURE
  return out
}

const encoder = new TextEncoder()

export function buildKnowledgeTreeFixture(prefix = 'vault'): SyntheticFile[] {
  const files: SyntheticFile[] = []

  // Meta root + unknown file untuk memastikan `extraFiles` bertahan
  const manifest = JSON.stringify({ schema: 1, title: 'S1 Spike Knowledge Vault' }, null, 2)
  files.push({
    path: `${prefix}/vault.json`,
    kind: 'text',
    textContent: manifest,
    bytes: encoder.encode(manifest),
  })
  files.push({
    path: `${prefix}/README-extra.txt`,
    kind: 'text',
    textContent: 'File tambahan pengguna (extraFiles) yang harus bertahan.',
    bytes: encoder.encode('File tambahan pengguna (extraFiles) yang harus bertahan.'),
  })

  // 30 node (masing-masing node.json + sebagian canvas.json) + 15 gambar PNG = ~62 file
  for (let i = 1; i <= 30; i += 1) {
    const slug =
      i === 3
        ? `catatan/ide baru — café ${i}` // ruang + unicode diuji eksplisit
        : `catatan/node-${String(i).padStart(2, '0')}`
    const nodeJson = JSON.stringify(
      {
        schema: 1,
        id: `01S1NODE000000000000000${String(i).padStart(3, '0')}`,
        title: i === 3 ? 'Ide Baru — Café #3' : `Node Pengetahuan #${i}`,
        type: i % 5 === 0 ? 'branch' : 'note',
        order: `a${i}`,
      },
      null,
      2,
    )
    files.push({
      path: `${prefix}/${slug}/node.json`,
      kind: 'text',
      textContent: nodeJson,
      bytes: encoder.encode(nodeJson),
    })

    if (i <= 20) {
      const canvasJson = JSON.stringify(
        {
          schema: 1,
          elements: [
            {
              id: `el-${i}`,
              type: 'text',
              x: 40,
              y: 40,
              width: 320,
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: `Konten kanvas node ${i} — Δαβ.` }],
                  },
                ],
              },
            },
          ],
        },
        null,
        2,
      )
      files.push({
        path: `${prefix}/${slug}/canvas.json`,
        kind: 'text',
        textContent: canvasJson,
        bytes: encoder.encode(canvasJson),
      })
    }

    if (i <= 10) {
      const extraText = `extra-notes-for-node-${i}\n`
      files.push({
        path: `${prefix}/${slug}/lampiran-tambahan.md`,
        kind: 'text',
        textContent: extraText,
        bytes: encoder.encode(extraText),
      })
    }
  }

  // 15 PNG lokal (bervariasi antara ~8 KB dan ~64 KB agar ringan saat multi-run)
  for (let img = 1; img <= 15; img += 1) {
    const targetSize = img <= 5 ? 8 * 1024 : img <= 10 ? 24 * 1024 : 64 * 1024
    const pngBytes = createSyntheticPngBytes(targetSize, img + 100)
    files.push({
      path: `${prefix}/catatan/node-${String(img).padStart(2, '0')}/assets/gambar-${img}.png`,
      kind: 'binary',
      bytes: pngBytes,
    })
  }

  return files
}

export function generateBatchTextFiles(
  count: number,
  prefix: string,
): Array<{
  path: string
  content: string
  base64: string
}> {
  const result: Array<{ path: string; content: string; base64: string }> = []
  for (let i = 1; i <= count; i += 1) {
    const content = JSON.stringify({
      schema: 1,
      id: `01BATCH${String(count).padStart(3, '0')}${String(i).padStart(4, '0')}`,
      index: i,
      title: `Batch item ${i} / ${count}`,
      body: `Payload deterministik untuk benchmark ${count} file (#${i}).`.repeat(4),
    })
    const bytes = encoder.encode(content)
    result.push({
      path: `${prefix}/item-${String(i).padStart(3, '0')}.json`,
      content,
      base64: bytesToBase64(bytes),
    })
  }
  return result
}

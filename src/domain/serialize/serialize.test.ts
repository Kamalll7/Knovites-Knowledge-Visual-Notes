import fs from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  isPlainObject,
  parseCanvasJson,
  parseKnovitesJson,
  parseNodeJson,
  type CanvasElement,
  type CanvasImageElement,
  type CanvasJson,
  type CanvasTextElement,
  type KnovitesJson,
  type NodeJson,
  type TipTapDoc,
  type TipTapMark,
  type TipTapNode,
} from '@/domain/schema'
import { serializeCanvasJson, serializeKnovitesJson, serializeNodeJson } from '@/domain/serialize'

const fixturesDir = path.resolve(import.meta.dirname, '../../testing/fixtures/v1')

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8')
}

const CROCKFORD_FIRST = '01234567'.split('')
const CROCKFORD_REST = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.split('')
const HEX_CHARS = '0123456789abcdef'.split('')
const LOWER_ALNUM = '0123456789abcdefghijklmnopqrstuvwxyz'.split('')
const TAG_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz_-'.split('')

const ulidArb = fc
  .tuple(
    fc.constantFrom(...CROCKFORD_FIRST),
    fc.string({ unit: fc.constantFrom(...CROCKFORD_REST), minLength: 25, maxLength: 25 }),
  )
  .map(([first, rest]) => `${first}${rest}`)

const elementIdArb = fc
  .string({ unit: fc.constantFrom(...LOWER_ALNUM), minLength: 8, maxLength: 8 })
  .map((suffix) => `e_${suffix}`)

const hexColorArb = fc
  .string({ unit: fc.constantFrom(...HEX_CHARS), minLength: 6, maxLength: 6 })
  .map((hex) => `#${hex}`)

const nullableHexColorArb = fc.oneof(fc.constant(null), hexColorArb)

const tagArb = fc.string({ unit: fc.constantFrom(...TAG_CHARS), minLength: 1, maxLength: 32 })

const orderArb = fc.string({
  unit: fc.constantFrom(...LOWER_ALNUM),
  minLength: 1,
  maxLength: 12,
})

const utcIsoArb = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 11, 31) })
  .map((ms) => new Date(ms).toISOString())

const titleArb = fc.string({ minLength: 1, maxLength: 200 })

const assetPathArb = fc
  .tuple(
    fc.string({ unit: fc.constantFrom(...HEX_CHARS), minLength: 16, maxLength: 16 }),
    fc.constantFrom('png', 'jpg', 'jpeg', 'webp', 'gif'),
  )
  .map(([hash, ext]) => `assets/${hash}.${ext}`)

const hrefArb = fc.oneof(
  fc.constant('https://example.com/path?x=1'),
  fc.constant('http://localhost:8080/note'),
  fc.constant('mailto:ctf@example.com'),
  ulidArb.map((id) => `knovites:${id}`),
)

const tipTapMarkArb: fc.Arbitrary<TipTapMark> = fc.oneof(
  fc
    .constantFrom<'bold' | 'italic' | 'underline' | 'strike' | 'code'>(
      'bold',
      'italic',
      'underline',
      'strike',
      'code',
    )
    .map((type) => ({ type })),
  hrefArb.map((href) => ({ type: 'link' as const, attrs: { href } })),
  fc
    .record({
      color: nullableHexColorArb,
      fontFamily: fc.constantFrom('Inter', 'Lora', 'JetBrains Mono'),
      fontSize: fc.constantFrom('14px', '16px', '20px'),
    })
    .map((attrs) => ({ type: 'textStyle' as const, attrs })),
  nullableHexColorArb.map((color) => ({ type: 'highlight' as const, attrs: { color } })),
)

const tipTapTextNodeArb: fc.Arbitrary<TipTapNode> = fc
  .record(
    {
      text: fc.string({ minLength: 0, maxLength: 40 }),
      marks: fc.array(tipTapMarkArb, { minLength: 1, maxLength: 3 }),
    },
    { requiredKeys: ['text'] },
  )
  .map((n) =>
    n.marks ? { type: 'text', text: n.text, marks: n.marks } : { type: 'text', text: n.text },
  )

const tipTapInlineArb: fc.Arbitrary<TipTapNode> = fc.oneof(
  tipTapTextNodeArb,
  fc.constant({ type: 'hardBreak' as const }),
)

const tipTapBlockArb: fc.Arbitrary<TipTapNode> = fc.oneof(
  fc.array(tipTapInlineArb, { maxLength: 4 }).map((content) => ({
    type: 'paragraph' as const,
    content,
  })),
  fc
    .tuple(fc.constantFrom(1, 2, 3), fc.array(tipTapTextNodeArb, { maxLength: 3 }))
    .map(([level, content]) => ({
      type: 'heading' as const,
      attrs: { level },
      content,
    })),
  fc
    .tuple(fc.constantFrom<string | null>(null, 'c', 'python', 'ts'), fc.string({ maxLength: 30 }))
    .map(([language, code]) => ({
      type: 'codeBlock' as const,
      attrs: { language },
      content: [{ type: 'text' as const, text: code }],
    })),
  fc.constant({ type: 'horizontalRule' as const }),
)

const tipTapDocArb: fc.Arbitrary<TipTapDoc> = fc
  .array(tipTapBlockArb, { maxLength: 4 })
  .map((content) => ({ type: 'doc', content }))

const knovitesArb: fc.Arbitrary<KnovitesJson> = fc.record({
  schema: fc.constant(1 as const),
  title: titleArb,
  createdAt: utcIsoArb,
})

const nodeLinkArb = fc.record(
  {
    to: ulidArb,
    label: fc.string({ maxLength: 80 }),
  },
  { requiredKeys: ['to'] },
)

const nodeArb: fc.Arbitrary<NodeJson> = fc.record({
  schema: fc.constant(1 as const),
  id: ulidArb,
  title: titleArb,
  type: fc.constantFrom('category', 'concept', 'technique', 'challenge', 'lab'),
  status: fc.constantFrom('none', 'learning', 'practiced', 'mastered'),
  tags: fc.array(tagArb, { maxLength: 20 }),
  order: orderArb,
  color: nullableHexColorArb,
  links: fc.array(nodeLinkArb, { maxLength: 10 }),
  createdAt: utcIsoArb,
  updatedAt: utcIsoArb,
})

const finiteFloatOrIntArb = fc.double({
  min: -5000,
  max: 5000,
  noNaN: true,
  noDefaultInfinity: true,
})
const positiveWidthOrHeightArb = fc.double({
  min: 1,
  max: 5000,
  noNaN: true,
  noDefaultInfinity: true,
})

const canvasTextElementArb: fc.Arbitrary<CanvasTextElement> = fc.record(
  {
    type: fc.constant('text' as const),
    x: finiteFloatOrIntArb,
    y: finiteFloatOrIntArb,
    w: positiveWidthOrHeightArb,
    z: orderArb,
    rotation: finiteFloatOrIntArb,
    style: fc.record({
      bg: nullableHexColorArb,
      border: nullableHexColorArb,
    }),
    content: tipTapDocArb,
    updatedAt: utcIsoArb,
  },
  { requiredKeys: ['type', 'x', 'y', 'w', 'z', 'style', 'content', 'updatedAt'] },
)

const canvasImageElementArb: fc.Arbitrary<CanvasImageElement> = fc.record(
  {
    type: fc.constant('image' as const),
    x: finiteFloatOrIntArb,
    y: finiteFloatOrIntArb,
    w: positiveWidthOrHeightArb,
    h: positiveWidthOrHeightArb,
    z: orderArb,
    rotation: finiteFloatOrIntArb,
    asset: assetPathArb,
    nw: fc.integer({ min: 1, max: 10000 }),
    nh: fc.integer({ min: 1, max: 10000 }),
    alt: fc.string({ maxLength: 100 }),
    updatedAt: utcIsoArb,
  },
  { requiredKeys: ['type', 'x', 'y', 'w', 'h', 'z', 'asset', 'nw', 'nh', 'updatedAt'] },
)

const canvasElementArb: fc.Arbitrary<CanvasElement> = fc.oneof(
  canvasTextElementArb,
  canvasImageElementArb,
)

const canvasArb: fc.Arbitrary<CanvasJson> = fc
  .array(fc.tuple(elementIdArb, canvasElementArb), { maxLength: 6 })
  .map((entries) => ({
    schema: 1 as const,
    elements: Object.fromEntries(entries),
  }))

function reverseKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeysDeep)
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).reverse()) {
      const prop = value[key]
      if (prop !== undefined) {
        out[key] = reverseKeysDeep(prop)
      }
    }
    return out
  }
  return value
}

describe('canonical serializers [T1.2]', () => {
  it('matches v1 fixture files byte-for-byte after parse -> serialize', () => {
    const knovitesRaw = readFixture('knovites.json')
    const knovitesParsed = parseKnovitesJson(knovitesRaw)
    expect(knovitesParsed.status).toBe('ok')
    if (knovitesParsed.status === 'ok') {
      expect(serializeKnovitesJson(knovitesParsed.data)).toBe(knovitesRaw)
    }

    const nodeRaw = readFixture('node.json')
    const nodeParsed = parseNodeJson(nodeRaw)
    expect(nodeParsed.status).toBe('ok')
    if (nodeParsed.status === 'ok') {
      expect(serializeNodeJson(nodeParsed.data)).toBe(nodeRaw)
    }

    const canvasRaw = readFixture('canvas.json')
    const canvasParsed = parseCanvasJson(canvasRaw)
    expect(canvasParsed.status).toBe('ok')
    if (canvasParsed.status === 'ok') {
      expect(serializeCanvasJson(canvasParsed.data)).toBe(canvasRaw)
    }

    const rootCanvasRaw = readFixture('root-canvas.json')
    const rootCanvasParsed = parseCanvasJson(rootCanvasRaw)
    expect(rootCanvasParsed.status).toBe('ok')
    if (rootCanvasParsed.status === 'ok') {
      expect(serializeCanvasJson(rootCanvasParsed.data)).toBe(rootCanvasRaw)
    }
  })

  it('enforces LF, 2-space indent, single trailing newline, and integer canvas coordinates', () => {
    const canvas = {
      schema: 1 as const,
      elements: {
        e_8f2a1c0d: {
          type: 'text' as const,
          x: 120.6,
          y: -0.2,
          w: 320.4,
          z: 'a0',
          rotation: -14.7,
          style: { bg: null, border: null },
          content: { type: 'doc' as const, content: [] },
          updatedAt: '2026-11-16T10:05:00Z',
        },
      },
    }

    const output = serializeCanvasJson(canvas)
    expect(output.includes('\r\n')).toBe(false)
    expect(output.endsWith('\n')).toBe(true)
    expect(output.endsWith('\n\n')).toBe(false)

    const reparsed = parseCanvasJson(output)
    expect(reparsed.status).toBe('ok')
    if (reparsed.status === 'ok') {
      expect(reparsed.issues).toEqual([])
      const el = reparsed.data.elements['e_8f2a1c0d']
      expect(el?.x).toBe(121)
      expect(Object.is(el?.y, 0)).toBe(true)
      expect(el?.w).toBe(320)
      expect(el?.rotation).toBe(-15)
    }
  })

  it('satisfies round-trip property serialize(parse(serialize(x))) === serialize(x) for knovites, node, and canvas', () => {
    fc.assert(
      fc.property(knovitesArb, (doc) => {
        const s1 = serializeKnovitesJson(doc)
        const parsed = parseKnovitesJson(s1)
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
          expect(serializeKnovitesJson(parsed.data)).toBe(s1)
        }
      }),
    )

    fc.assert(
      fc.property(nodeArb, (doc) => {
        const s1 = serializeNodeJson(doc)
        const parsed = parseNodeJson(s1)
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
          expect(serializeNodeJson(parsed.data)).toBe(s1)
        }
      }),
    )

    fc.assert(
      fc.property(canvasArb, (doc) => {
        const s1 = serializeCanvasJson(doc)
        const parsed = parseCanvasJson(s1)
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
          expect(serializeCanvasJson(parsed.data)).toBe(s1)
        }
      }),
    )
  })

  it('produces identical output regardless of input object key order at any depth', () => {
    fc.assert(
      fc.property(knovitesArb, (doc) => {
        const reversed = reverseKeysDeep(doc) as KnovitesJson
        expect(serializeKnovitesJson(reversed)).toBe(serializeKnovitesJson(doc))
      }),
    )

    fc.assert(
      fc.property(nodeArb, (doc) => {
        const reversed = reverseKeysDeep(doc) as NodeJson
        expect(serializeNodeJson(reversed)).toBe(serializeNodeJson(doc))
      }),
    )

    fc.assert(
      fc.property(canvasArb, (doc) => {
        const reversed = reverseKeysDeep(doc) as CanvasJson
        expect(serializeCanvasJson(reversed)).toBe(serializeCanvasJson(doc))
      }),
    )
  })
})

import fs from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_SCHEMA_VERSION,
  CANVAS_STYLE_TOKENS,
  HIGHLIGHT_COLOR_TOKENS,
  TEXT_COLOR_TOKENS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  isPlainObject,
  parseCanvasJson,
  parseKnovitesJson,
  parseNodeJson,
  type CanvasElement,
  type CanvasImageElement,
  type CanvasJson,
  type CanvasStyleToken,
  type CanvasTextElement,
  type HighlightColorToken,
  type KnovitesJson,
  type NodeJson,
  type TextColorToken,
  type TipTapDoc,
  type TipTapMark,
  type TipTapNode,
} from '@/domain/schema'
import { serializeCanvasJson, serializeKnovitesJson, serializeNodeJson } from '@/domain/serialize'

const fixturesV1Dir = path.resolve(import.meta.dirname, '../../testing/fixtures/v1')
const fixturesV2Dir = path.resolve(import.meta.dirname, '../../testing/fixtures/v2')

function readV1Fixture(name: string): string {
  return fs.readFileSync(path.join(fixturesV1Dir, name), 'utf8')
}

function readV2Fixture(name: string): string {
  return fs.readFileSync(path.join(fixturesV2Dir, name), 'utf8')
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

const textColorTokenArb: fc.Arbitrary<TextColorToken> = fc.constantFrom(...TEXT_COLOR_TOKENS)
const highlightColorTokenArb: fc.Arbitrary<HighlightColorToken> = fc.constantFrom(
  ...HIGHLIGHT_COLOR_TOKENS,
)
const canvasStyleTokenArb: fc.Arbitrary<CanvasStyleToken> = fc.constantFrom(...CANVAS_STYLE_TOKENS)

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
    .record(
      {
        color: textColorTokenArb,
        fontFamily: fc.constantFrom('Inter', 'Lora', 'JetBrains Mono'),
        fontSize: fc.constantFrom('14px', '16px', '20px'),
      },
      { requiredKeys: ['fontSize'] },
    )
    .map((attrs) => ({ type: 'textStyle' as const, attrs })),
  highlightColorTokenArb.map((color) => ({ type: 'highlight' as const, attrs: { color } })),
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

const optionalAlignArb = fc.constantFrom<undefined | 'left' | 'center' | 'right'>(
  undefined,
  'left',
  'center',
  'right',
)

const tipTapBlockArb: fc.Arbitrary<TipTapNode> = fc.oneof(
  fc
    .tuple(optionalAlignArb, fc.array(tipTapInlineArb, { maxLength: 4 }))
    .map(([align, content]): TipTapNode =>
      align !== undefined
        ? { type: 'paragraph', attrs: { textAlign: align }, content }
        : { type: 'paragraph', content },
    ),
  fc
    .tuple(
      fc.constantFrom(1, 2, 3),
      optionalAlignArb,
      fc.array(tipTapTextNodeArb, { maxLength: 3 }),
    )
    .map(([level, align, content]): TipTapNode => {
      const attrs: Record<string, string | number | null> =
        align !== undefined ? { level, textAlign: align } : { level }
      return {
        type: 'heading',
        attrs,
        content,
      }
    }),
  fc
    .tuple(fc.constantFrom<string | null>(null, 'c', 'python', 'ts'), fc.string({ maxLength: 30 }))
    .map(([language, code]): TipTapNode => ({
      type: 'codeBlock',
      attrs: { language },
      content: [{ type: 'text', text: code }],
    })),
  fc.constant<TipTapNode>({ type: 'horizontalRule' }),
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

const textScaleArb = fc.oneof(
  fc.constant(1),
  fc.double({
    min: TEXT_SCALE_MIN,
    max: TEXT_SCALE_MAX,
    noNaN: true,
    noDefaultInfinity: true,
  }),
)

const canvasTextElementArb: fc.Arbitrary<CanvasTextElement> = fc.record(
  {
    type: fc.constant('text' as const),
    x: finiteFloatOrIntArb,
    y: finiteFloatOrIntArb,
    w: positiveWidthOrHeightArb,
    z: orderArb,
    rotation: finiteFloatOrIntArb,
    textScale: textScaleArb,
    style: fc.record({
      bg: canvasStyleTokenArb,
      border: canvasStyleTokenArb,
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
    schema: CANVAS_SCHEMA_VERSION,
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

describe('canonical serializers [T1.2, M4-Schema]', () => {
  it('matches v1 manifest/node and v2 canvas fixture files byte-for-byte after parse -> serialize', () => {
    const knovitesRaw = readV1Fixture('knovites.json')
    const knovitesParsed = parseKnovitesJson(knovitesRaw)
    expect(knovitesParsed.status).toBe('ok')
    if (knovitesParsed.status === 'ok') {
      expect(serializeKnovitesJson(knovitesParsed.data)).toBe(knovitesRaw)
    }

    const nodeRaw = readV1Fixture('node.json')
    const nodeParsed = parseNodeJson(nodeRaw)
    expect(nodeParsed.status).toBe('ok')
    if (nodeParsed.status === 'ok') {
      expect(serializeNodeJson(nodeParsed.data)).toBe(nodeRaw)
    }

    const canvasV2Raw = readV2Fixture('canvas.json')
    const canvasV2Parsed = parseCanvasJson(canvasV2Raw)
    expect(canvasV2Parsed.status).toBe('ok')
    if (canvasV2Parsed.status === 'ok') {
      expect(serializeCanvasJson(canvasV2Parsed.data)).toBe(canvasV2Raw)
    }

    const rootCanvasV2Raw = readV2Fixture('root-canvas.json')
    const rootCanvasV2Parsed = parseCanvasJson(rootCanvasV2Raw)
    expect(rootCanvasV2Parsed.status).toBe('ok')
    if (rootCanvasV2Parsed.status === 'ok') {
      expect(serializeCanvasJson(rootCanvasV2Parsed.data)).toBe(rootCanvasV2Raw)
    }
  })

  it('migrates v1 canvas fixtures to canonical v2 output that round-trips cleanly', () => {
    for (const file of ['canvas.json', 'root-canvas.json']) {
      const parsed = parseCanvasJson(readV1Fixture(file))
      expect(parsed.status).toBe('ok')
      if (parsed.status === 'ok') {
        expect(parsed.data.schema).toBe(2)
        const serialized = serializeCanvasJson(parsed.data)
        const reparsed = parseCanvasJson(serialized)
        expect(reparsed.status).toBe('ok')
        if (reparsed.status === 'ok') {
          expect(reparsed.issues).toEqual([])
          expect(serializeCanvasJson(reparsed.data)).toBe(serialized)
        }
      }
    }
  })

  it('enforces LF, 2-space indent, single trailing newline, integer coords, and omits textScale: 1 and textAlign: null/left', () => {
    const canvas: CanvasJson = {
      schema: 2,
      elements: {
        e_8f2a1c0d: {
          type: 'text',
          x: 120.6,
          y: -0.2,
          w: 320.4,
          z: 'a0',
          rotation: -14.7,
          textScale: 1,
          style: { bg: 'auto', border: 'auto' },
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                attrs: { textAlign: null },
                content: [{ type: 'text', text: 'null align' }],
              },
              {
                type: 'paragraph',
                attrs: { textAlign: 'left' },
                content: [{ type: 'text', text: 'left align' }],
              },
              {
                type: 'heading',
                attrs: { level: 2, textAlign: 'left' },
                content: [{ type: 'text', text: 'heading left' }],
              },
              {
                type: 'paragraph',
                attrs: { textAlign: 'center' },
                content: [{ type: 'text', text: 'center align' }],
              },
            ],
          },
          updatedAt: '2026-11-16T10:05:00Z',
        },
        e_scaled01: {
          type: 'text',
          x: 10,
          y: 20,
          w: 240,
          z: 'a1',
          textScale: 1.5,
          style: { bg: 'none', border: 'none' },
          content: { type: 'doc', content: [] },
          updatedAt: '2026-11-27T10:05:00Z',
        },
      },
    }

    const output = serializeCanvasJson(canvas)
    expect(output.includes('\r\n')).toBe(false)
    expect(output.endsWith('\n')).toBe(true)
    expect(output.endsWith('\n\n')).toBe(false)
    expect(output.includes('"textAlign": null')).toBe(false)
    expect(output.includes('"textAlign": "left"')).toBe(false)
    expect(output.includes('"textScale": 1,')).toBe(false)
    expect(output.includes('"textScale": 1.5')).toBe(true)
    expect(output.includes('"textAlign": "center"')).toBe(true)

    const reparsed = parseCanvasJson(output)
    expect(reparsed.status).toBe('ok')
    if (reparsed.status === 'ok') {
      expect(reparsed.issues).toEqual([])
      const el = reparsed.data.elements['e_8f2a1c0d']
      expect(el?.x).toBe(121)
      expect(Object.is(el?.y, 0)).toBe(true)
      expect(el?.w).toBe(320)
      expect(el?.rotation).toBe(-15)
      if (el?.type === 'text') {
        expect(el.textScale).toBeUndefined()
        expect(el.content.content?.[0]?.attrs).toBeUndefined()
        expect(el.content.content?.[1]?.attrs).toBeUndefined()
        expect(el.content.content?.[2]?.attrs).toEqual({ level: 2 })
        expect(el.content.content?.[3]?.attrs).toEqual({ textAlign: 'center' })
      }
      const scaled = reparsed.data.elements['e_scaled01']
      if (scaled?.type === 'text') {
        expect(scaled.textScale).toBe(1.5)
      }
    }
  })

  it('satisfies round-trip property serialize(parse(serialize(x))) === serialize(x) for knovites, node, and v2 canvas', () => {
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
        expect(s1.includes('"textAlign": null')).toBe(false)
        expect(s1.includes('"textAlign": "left"')).toBe(false)
        expect(s1.includes('"textScale": 1,')).toBe(false)
        const parsed = parseCanvasJson(s1)
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
          expect(parsed.data.schema).toBe(2)
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

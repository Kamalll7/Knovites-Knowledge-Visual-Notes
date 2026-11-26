import fs from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  VIRTUAL_ROOT_ID,
  isVirtualRootId,
  parseCanvasJson,
  parseKnovitesJson,
  parseNodeJson,
} from '@/domain/schema'

const fixturesDir = path.resolve(import.meta.dirname, '../../testing/fixtures/v1')
const VALID_ULID = '01JC8ZQ4M7X2K9T5VB3N6D8RHW'
const VALID_ULID_2 = '01JC8ZR1B2C3D4E5F6G7H8J9KM'
const VALID_UTC = '2026-11-16T10:00:00Z'

function readFixture(relPath: string): string {
  return fs.readFileSync(path.join(fixturesDir, relPath), 'utf8')
}

function makeValidNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    id: VALID_ULID,
    title: 'ret2win',
    type: 'technique',
    status: 'practiced',
    tags: ['pwn'],
    order: 'a1',
    color: null,
    links: [],
    createdAt: VALID_UTC,
    updatedAt: VALID_UTC,
    ...overrides,
  }
}

function makeValidCanvas(elements: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: 1,
    elements,
  }
}

function makeTextElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'text',
    x: 10,
    y: 20,
    w: 200,
    z: 'a0',
    style: { bg: null, border: null },
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    },
    updatedAt: VALID_UTC,
    ...overrides,
  }
}

function makeImageElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'image',
    x: 10,
    y: 20,
    w: 400,
    h: 260,
    z: 'a1',
    asset: 'assets/3fa9c1d2e4b5a671.webp',
    nw: 1600,
    nh: 1040,
    updatedAt: VALID_UTC,
    ...overrides,
  }
}

describe('schema parsers and fixtures [T1.1]', () => {
  it('parses valid v1 fixtures cleanly with no issues', () => {
    const knovites = parseKnovitesJson(readFixture('knovites.json'))
    expect(knovites.status).toBe('ok')
    if (knovites.status === 'ok') {
      expect(knovites.issues).toEqual([])
      expect(knovites.data.schema).toBe(CURRENT_SCHEMA_VERSION)
    }

    const node = parseNodeJson(readFixture('node.json'))
    expect(node.status).toBe('ok')
    if (node.status === 'ok') {
      expect(node.issues).toEqual([])
      expect(node.data.id).toBe(VALID_ULID)
    }

    const canvas = parseCanvasJson(readFixture('canvas.json'))
    expect(canvas.status).toBe('ok')
    if (canvas.status === 'ok') {
      expect(canvas.issues).toEqual([])
      expect(Object.keys(canvas.data.elements)).toEqual(['e_8f2a1c0d', 'e_91bc40aa'])
    }

    const rootCanvas = parseCanvasJson(readFixture('root-canvas.json'))
    expect(rootCanvas.status).toBe('ok')
    if (rootCanvas.status === 'ok') {
      expect(rootCanvas.issues).toEqual([])
      expect(rootCanvas.data.schema).toBe(CURRENT_SCHEMA_VERSION)
      expect(Object.keys(rootCanvas.data.elements)).toEqual(['e_home0001', 'e_home0002'])
    }
  })

  it('defines canonical VIRTUAL_ROOT_ID ("__root__") and rejects it as a node.json ID [M3-HomeRoot]', () => {
    expect(VIRTUAL_ROOT_ID).toBe('__root__')
    expect(isVirtualRootId('__root__')).toBe(true)
    expect(isVirtualRootId(VALID_ULID)).toBe(false)
    expect(isVirtualRootId('root')).toBe(false)
    expect(isVirtualRootId(null)).toBe(false)
    expect(isVirtualRootId(undefined)).toBe(false)

    expect(parseNodeJson(makeValidNode({ id: VIRTUAL_ROOT_ID })).status).toBe('corrupt')
  })

  it('parses invalid fixtures into the expected discriminated outcomes without throwing', () => {
    const invalidId = parseNodeJson(readFixture('invalid/node-invalid-id.json'))
    expect(invalidId.status).toBe('corrupt')

    const newer = parseNodeJson(readFixture('invalid/node-newer-schema.json'))
    expect(newer).toEqual({ status: 'newer-schema', schemaVersion: 2 })

    const invalidAsset = parseCanvasJson(readFixture('invalid/canvas-invalid-asset.json'))
    expect(invalidAsset.status).toBe('corrupt')

    const unsanitized = parseCanvasJson(readFixture('invalid/canvas-unsanitized-tiptap.json'))
    expect(unsanitized.status).toBe('ok')
    if (unsanitized.status === 'ok') {
      expect(unsanitized.issues.length).toBeGreaterThanOrEqual(5)
      const textEl = unsanitized.data.elements['e_8f2a1c0d']
      expect(textEl?.type).toBe('text')
      if (textEl?.type === 'text') {
        expect(textEl.x).toBe(121)
        expect(textEl.content.content).toHaveLength(1)
        const paragraph = textEl.content.content?.[0]
        const textNode = paragraph?.content?.[0]
        expect(textNode?.marks).toEqual([{ type: 'bold' }])
      }
    }
  })

  it('returns corrupt for malformed JSON, non-objects, and invalid schema versions', () => {
    for (const badInput of ['{not json', null, [], 42, 'hello']) {
      expect(parseKnovitesJson(badInput).status).toBe('corrupt')
      expect(parseNodeJson(badInput).status).toBe('corrupt')
      expect(parseCanvasJson(badInput).status).toBe('corrupt')
    }

    for (const badSchema of [0, -1, 1.5, '1', null]) {
      expect(
        parseKnovitesJson({ schema: badSchema, title: 'x', createdAt: VALID_UTC }).status,
      ).toBe('corrupt')
      expect(parseNodeJson(makeValidNode({ schema: badSchema })).status).toBe('corrupt')
      expect(parseCanvasJson({ schema: badSchema, elements: {} }).status).toBe('corrupt')
    }

    expect(parseKnovitesJson({ schema: 2, title: 'x', createdAt: VALID_UTC })).toEqual({
      status: 'newer-schema',
      schemaVersion: 2,
    })
    expect(parseCanvasJson({ schema: 99, elements: {} })).toEqual({
      status: 'newer-schema',
      schemaVersion: 99,
    })
  })

  describe('knovites.json boundaries', () => {
    it('enforces title length 1..200 and UTC createdAt', () => {
      expect(parseKnovitesJson({ schema: 1, title: '', createdAt: VALID_UTC }).status).toBe(
        'corrupt',
      )
      expect(
        parseKnovitesJson({ schema: 1, title: 'a'.repeat(201), createdAt: VALID_UTC }).status,
      ).toBe('corrupt')
      expect(parseKnovitesJson({ schema: 1, title: 'a', createdAt: VALID_UTC }).status).toBe('ok')
      expect(
        parseKnovitesJson({ schema: 1, title: 'a'.repeat(200), createdAt: VALID_UTC }).status,
      ).toBe('ok')
      expect(
        parseKnovitesJson({ schema: 1, title: 'ok', createdAt: '2026-11-16T10:00:00+07:00' })
          .status,
      ).toBe('corrupt')
    })
  })

  describe('node.json boundaries', () => {
    it('enforces title length 1..200', () => {
      expect(parseNodeJson(makeValidNode({ title: '' })).status).toBe('corrupt')
      expect(parseNodeJson(makeValidNode({ title: 'x'.repeat(201) })).status).toBe('corrupt')
      expect(parseNodeJson(makeValidNode({ title: 'x' })).status).toBe('ok')
      expect(parseNodeJson(makeValidNode({ title: 'x'.repeat(200) })).status).toBe('ok')
    })

    it('enforces ULID format for id and links.to', () => {
      const invalidUlids = [
        '',
        '01JC8ZQ4M7X2K9T5VB3N6D8RH', // 25 chars
        '01JC8ZQ4M7X2K9T5VB3N6D8RHW0', // 27 chars
        '01jc8zq4m7x2k9t5vb3n6d8rhw', // lowercase
        '01IC8ZQ4M7X2K9T5VB3N6D8RHW', // I excluded from Crockford base32
        '01LC8ZQ4M7X2K9T5VB3N6D8RHW', // L excluded
        '01OC8ZQ4M7X2K9T5VB3N6D8RHW', // O excluded
        '01UC8ZQ4M7X2K9T5VB3N6D8RHW', // U excluded
        '81JC8ZQ4M7X2K9T5VB3N6D8RHW', // leading char >= 8 overflows 128-bit ULID
      ]
      for (const badId of invalidUlids) {
        expect(parseNodeJson(makeValidNode({ id: badId })).status).toBe('corrupt')
        expect(parseNodeJson(makeValidNode({ links: [{ to: badId }] })).status).toBe('corrupt')
      }
    })

    it('defaults type to concept and status to none when omitted', () => {
      const base = makeValidNode()
      delete base['type']
      delete base['status']
      const parsed = parseNodeJson(base)
      expect(parsed.status).toBe('ok')
      if (parsed.status === 'ok') {
        expect(parsed.data.type).toBe('concept')
        expect(parsed.data.status).toBe('none')
      }

      expect(parseNodeJson(makeValidNode({ type: 'unknown' })).status).toBe('corrupt')
      expect(parseNodeJson(makeValidNode({ status: 'archived' })).status).toBe('corrupt')
    })

    it('enforces tags max 20 and tag format [a-z0-9_-]{1,32}', () => {
      const twentyTags = Array.from({ length: 20 }, (_, i) => `tag_${i}`)
      expect(parseNodeJson(makeValidNode({ tags: twentyTags })).status).toBe('ok')

      const twentyOneTags = Array.from({ length: 21 }, (_, i) => `tag_${i}`)
      expect(parseNodeJson(makeValidNode({ tags: twentyOneTags })).status).toBe('corrupt')

      expect(parseNodeJson(makeValidNode({ tags: ['a'.repeat(32)] })).status).toBe('ok')
      for (const badTag of ['', 'Uppercase', 'has space', 'bad.dot', 'a'.repeat(33)]) {
        expect(parseNodeJson(makeValidNode({ tags: [badTag] })).status).toBe('corrupt')
      }
    })

    it('enforces links max 100 and label max 80', () => {
      const hundredLinks = Array.from({ length: 100 }, () => ({ to: VALID_ULID_2 }))
      expect(parseNodeJson(makeValidNode({ links: hundredLinks })).status).toBe('ok')

      const hundredOneLinks = Array.from({ length: 101 }, () => ({ to: VALID_ULID_2 }))
      expect(parseNodeJson(makeValidNode({ links: hundredOneLinks })).status).toBe('corrupt')

      expect(
        parseNodeJson(makeValidNode({ links: [{ to: VALID_ULID_2, label: 'a'.repeat(80) }] }))
          .status,
      ).toBe('ok')
      expect(
        parseNodeJson(makeValidNode({ links: [{ to: VALID_ULID_2, label: 'a'.repeat(81) }] }))
          .status,
      ).toBe('corrupt')
    })

    it('enforces color null or #rrggbb', () => {
      expect(parseNodeJson(makeValidNode({ color: null })).status).toBe('ok')
      expect(parseNodeJson(makeValidNode({ color: '#7c9cff' })).status).toBe('ok')
      expect(parseNodeJson(makeValidNode({ color: '#7C9CFF' })).status).toBe('ok')
      for (const badColor of ['#fff', 'red', '#1234567', '#gggggg', '7c9cff', '']) {
        expect(parseNodeJson(makeValidNode({ color: badColor })).status).toBe('corrupt')
      }
    })
  })

  describe('canvas.json boundaries', () => {
    it('enforces element ID format e_<8 lowercase alphanumeric>', () => {
      expect(parseCanvasJson(makeValidCanvas({ e_8f2a1c0d: makeTextElement() })).status).toBe('ok')
      for (const badKey of ['e_1234567', 'e_123456789', 'e_ABCDEF12', 'x_8f2a1c0d', 'e_8f2a1c0!']) {
        expect(parseCanvasJson(makeValidCanvas({ [badKey]: makeTextElement() })).status).toBe(
          'corrupt',
        )
      }
    })

    it('rounds finite x, y, w, h, rotation and records non-fatal issues; rejects non-finite or non-positive sizes', () => {
      const parsed = parseCanvasJson(
        makeValidCanvas({
          e_8f2a1c0d: makeTextElement({ x: 12.6, y: -4.4, w: 320.2, rotation: 14.7 }),
          e_91bc40aa: makeImageElement({ x: 0.4, y: -0.2, w: 399.6, h: 259.5 }),
        }),
      )
      expect(parsed.status).toBe('ok')
      if (parsed.status === 'ok') {
        const textEl = parsed.data.elements['e_8f2a1c0d']
        expect(textEl?.x).toBe(13)
        expect(textEl?.y).toBe(-4)
        expect(textEl?.w).toBe(320)
        expect(textEl?.rotation).toBe(15)

        const imgEl = parsed.data.elements['e_91bc40aa']
        expect(imgEl?.type).toBe('image')
        if (imgEl?.type === 'image') {
          expect(imgEl.x).toBe(0)
          expect(imgEl.y).toBe(0)
          expect(imgEl.w).toBe(400)
          expect(imgEl.h).toBe(260)
        }
        expect(parsed.issues.filter((i) => i.code === 'rounded_coordinate')).toHaveLength(8)
      }

      for (const badNum of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(
          parseCanvasJson(makeValidCanvas({ e_8f2a1c0d: makeTextElement({ x: badNum }) })).status,
        ).toBe('corrupt')
      }

      for (const badSize of [0, 0.4, -0.4, -0.6, -10]) {
        expect(
          parseCanvasJson(makeValidCanvas({ e_8f2a1c0d: makeTextElement({ w: badSize }) })).status,
        ).toBe('corrupt')
        expect(
          parseCanvasJson(makeValidCanvas({ e_91bc40aa: makeImageElement({ w: badSize }) })).status,
        ).toBe('corrupt')
        expect(
          parseCanvasJson(makeValidCanvas({ e_91bc40aa: makeImageElement({ h: badSize }) })).status,
        ).toBe('corrupt')
      }

      const textWithHeight = parseCanvasJson(
        makeValidCanvas({ e_8f2a1c0d: makeTextElement({ h: 100 }) }),
      )
      expect(textWithHeight.status).toBe('ok')
      if (textWithHeight.status === 'ok') {
        expect(textWithHeight.issues).toEqual([
          expect.objectContaining({
            path: 'elements.e_8f2a1c0d.h',
            code: 'ignored_text_height',
          }),
        ])
        const el = textWithHeight.data.elements['e_8f2a1c0d']
        expect(el).toBeDefined()
        if (el) {
          expect('h' in el).toBe(false)
        }
      }

      expect(
        parseCanvasJson(makeValidCanvas({ e_8f2a1c0d: makeTextElement({ extraKey: 1 }) })).status,
      ).toBe('corrupt')
    })

    it('enforces text style colors and image asset/nw/nh requirements', () => {
      for (const badColor of ['#fff', 'blue', '#12345z']) {
        expect(
          parseCanvasJson(
            makeValidCanvas({
              e_8f2a1c0d: makeTextElement({ style: { bg: badColor, border: null } }),
            }),
          ).status,
        ).toBe('corrupt')
        expect(
          parseCanvasJson(
            makeValidCanvas({
              e_8f2a1c0d: makeTextElement({ style: { bg: null, border: badColor } }),
            }),
          ).status,
        ).toBe('corrupt')
      }

      for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
        expect(
          parseCanvasJson(
            makeValidCanvas({
              e_91bc40aa: makeImageElement({ asset: `assets/3fa9c1d2e4b5a671.${ext}` }),
            }),
          ).status,
        ).toBe('ok')
      }

      for (const badAsset of [
        '3fa9c1d2e4b5a671.webp',
        '../assets/3fa9c1d2e4b5a671.webp',
        'other/3fa9c1d2e4b5a671.webp',
        'assets/3fa9c1d2e4b5a67.webp',
        'assets/3fa9c1d2e4b5a6712.webp',
        'assets/3FA9C1D2E4B5A671.webp',
        'assets/3fa9c1d2e4b5a671.svg',
      ]) {
        expect(
          parseCanvasJson(makeValidCanvas({ e_91bc40aa: makeImageElement({ asset: badAsset }) }))
            .status,
        ).toBe('corrupt')
      }

      const withoutNw = makeImageElement()
      delete withoutNw['nw']
      expect(parseCanvasJson(makeValidCanvas({ e_91bc40aa: withoutNw })).status).toBe('corrupt')

      const withoutNh = makeImageElement()
      delete withoutNh['nh']
      expect(parseCanvasJson(makeValidCanvas({ e_91bc40aa: withoutNh })).status).toBe('corrupt')

      const withoutH = makeImageElement()
      delete withoutH['h']
      expect(parseCanvasJson(makeValidCanvas({ e_91bc40aa: withoutH })).status).toBe('corrupt')
    })
  })

  describe('TipTap content whitelist sanitizer', () => {
    it('preserves all allowed nodes, marks, attributes, and valid href schemes', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'H1' }],
          },
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'H3' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'all marks',
                        marks: [
                          { type: 'bold' },
                          { type: 'italic' },
                          { type: 'underline' },
                          { type: 'strike' },
                          { type: 'code' },
                          {
                            type: 'textStyle',
                            attrs: {
                              color: '#7c9cff',
                              fontFamily: 'Inter',
                              fontSize: '16px',
                            },
                          },
                          { type: 'highlight', attrs: { color: '#fbbf24' } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'http',
                        marks: [{ type: 'link', attrs: { href: 'http://example.com' } }],
                      },
                      {
                        type: 'text',
                        text: 'https',
                        marks: [{ type: 'link', attrs: { href: 'https://example.com/a?b=1' } }],
                      },
                      {
                        type: 'text',
                        text: 'mail',
                        marks: [{ type: 'link', attrs: { href: 'mailto:user@example.com' } }],
                      },
                      {
                        type: 'text',
                        text: 'internal',
                        marks: [{ type: 'link', attrs: { href: `knovites:${VALID_ULID}` } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'blockquote',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'line1' }, { type: 'hardBreak' }],
              },
            ],
          },
          { type: 'horizontalRule' },
          {
            type: 'codeBlock',
            attrs: { language: 'c' },
            content: [{ type: 'text', text: 'int main(void) { return 0; }' }],
          },
        ],
      }

      const parsed = parseCanvasJson(makeValidCanvas({ e_8f2a1c0d: makeTextElement({ content }) }))
      expect(parsed.status).toBe('ok')
      if (parsed.status === 'ok') {
        expect(parsed.issues).toEqual([])
        const el = parsed.data.elements['e_8f2a1c0d']
        expect(el?.type).toBe('text')
        if (el?.type === 'text') {
          expect(el.content).toEqual(content)
        }
      }
    })

    it('strips disallowed href schemes, heading level 4, unknown nodes/marks, and unknown attrs as non-fatal issues', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 4 },
            content: [{ type: 'text', text: 'Too deep' }],
          },
          {
            type: 'customWidget',
            content: [{ type: 'text', text: 'drop' }],
          },
          {
            type: 'paragraph',
            attrs: { align: 'center' },
            content: [
              {
                type: 'text',
                text: 'bad links',
                marks: [
                  { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                  { type: 'link', attrs: { href: 'data:text/html,<script>1</script>' } },
                  { type: 'link', attrs: { href: 'knovites:bad-id' } },
                  { type: 'superscript' },
                  { type: 'textStyle', attrs: { color: 'red', evil: '1', fontSize: '14px' } },
                  { type: 'highlight', attrs: { color: 'yellow', extra: 'x' } },
                ],
              },
            ],
          },
        ],
      }

      const parsed = parseCanvasJson(makeValidCanvas({ e_8f2a1c0d: makeTextElement({ content }) }))
      expect(parsed.status).toBe('ok')
      if (parsed.status === 'ok') {
        expect(parsed.issues.map((i) => i.code)).toEqual(
          expect.arrayContaining([
            'invalid_heading_level',
            'disallowed_tiptap_node',
            'disallowed_tiptap_attr',
            'disallowed_link_href',
            'disallowed_tiptap_mark',
          ]),
        )

        const el = parsed.data.elements['e_8f2a1c0d']
        expect(el?.type).toBe('text')
        if (el?.type === 'text') {
          expect(el.content).toEqual({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'bad links',
                    marks: [
                      { type: 'textStyle', attrs: { fontSize: '14px' } },
                      { type: 'highlight' },
                    ],
                  },
                ],
              },
            ],
          })
        }
      }
    })
  })

  describe('fuzz safety across all three parsers', () => {
    it('never throws and always returns ok, corrupt, or newer-schema for arbitrary jsonValue and non-object inputs', () => {
      const fuzzInputArb = fc.oneof(
        fc.jsonValue(),
        fc.json(),
        fc.string(),
        fc.integer(),
        fc.double(),
        fc.boolean(),
        fc.constant(null),
        fc.constant(undefined),
        fc.anything(),
      )

      const validStatuses = new Set(['ok', 'corrupt', 'newer-schema'])

      fc.assert(
        fc.property(fuzzInputArb, (value) => {
          const r1 = parseKnovitesJson(value)
          const r2 = parseNodeJson(value)
          const r3 = parseCanvasJson(value)

          expect(validStatuses.has(r1.status)).toBe(true)
          expect(validStatuses.has(r2.status)).toBe(true)
          expect(validStatuses.has(r3.status)).toBe(true)
        }),
        { numRuns: 300 },
      )
    })
  })
})

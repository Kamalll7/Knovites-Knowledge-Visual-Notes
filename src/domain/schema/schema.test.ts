import fs from 'node:fs'
import path from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_SCHEMA_VERSION,
  CANVAS_STYLE_TOKENS,
  CURRENT_SCHEMA_VERSION,
  HIGHLIGHT_COLOR_TOKENS,
  TEXT_COLOR_TOKENS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  VIRTUAL_ROOT_ID,
  createEmptyCanvas,
  isAllowedHref,
  isVirtualRootId,
  migrateCanvasV1ToV2,
  parseCanvasJson,
  parseKnovitesJson,
  parseNodeJson,
  sanitizeEditorContent,
} from '@/domain/schema'

const fixturesV1Dir = path.resolve(import.meta.dirname, '../../testing/fixtures/v1')
const fixturesV2Dir = path.resolve(import.meta.dirname, '../../testing/fixtures/v2')
const VALID_ULID = '01JC8ZQ4M7X2K9T5VB3N6D8RHW'
const VALID_ULID_2 = '01JC8ZR1B2C3D4E5F6G7H8J9KM'
const VALID_UTC = '2026-11-16T10:00:00Z'

function readV1Fixture(relPath: string): string {
  return fs.readFileSync(path.join(fixturesV1Dir, relPath), 'utf8')
}

function readV2Fixture(relPath: string): string {
  return fs.readFileSync(path.join(fixturesV2Dir, relPath), 'utf8')
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

function makeValidCanvas(
  elements: Record<string, unknown>,
  schema: number = CANVAS_SCHEMA_VERSION,
): Record<string, unknown> {
  return {
    schema,
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
    style: { bg: 'auto', border: 'auto' },
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    },
    updatedAt: VALID_UTC,
    ...overrides,
  }
}

function makeV1TextElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

describe('schema parsers and fixtures [T1.1, M4-Schema]', () => {
  it('uses per-file schema versions (knovites/node v1, canvas v2) and provides createEmptyCanvas()', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(CANVAS_SCHEMA_VERSION).toBe(2)
    expect(createEmptyCanvas()).toEqual({ schema: 2, elements: {} })
  })

  it('parses valid v1 manifest/node and v2 canvas fixtures cleanly with no issues', () => {
    const knovites = parseKnovitesJson(readV1Fixture('knovites.json'))
    expect(knovites.status).toBe('ok')
    if (knovites.status === 'ok') {
      expect(knovites.issues).toEqual([])
      expect(knovites.data.schema).toBe(CURRENT_SCHEMA_VERSION)
    }

    const node = parseNodeJson(readV1Fixture('node.json'))
    expect(node.status).toBe('ok')
    if (node.status === 'ok') {
      expect(node.issues).toEqual([])
      expect(node.data.id).toBe(VALID_ULID)
    }

    const canvasV2 = parseCanvasJson(readV2Fixture('canvas.json'))
    expect(canvasV2.status).toBe('ok')
    if (canvasV2.status === 'ok') {
      expect(canvasV2.issues).toEqual([])
      expect(canvasV2.data.schema).toBe(CANVAS_SCHEMA_VERSION)
      expect(Object.keys(canvasV2.data.elements)).toEqual([
        'e_8f2a1c0d',
        'e_91bc40aa',
        'e_a200none',
      ])
      const textEl = canvasV2.data.elements['e_8f2a1c0d']
      expect(textEl?.type).toBe('text')
      if (textEl?.type === 'text') {
        expect(textEl.textScale).toBe(1.25)
        expect(textEl.style).toEqual({ bg: 'auto', border: 'auto' })
      }
      const frameless = canvasV2.data.elements['e_a200none']
      expect(frameless?.type).toBe('text')
      if (frameless?.type === 'text') {
        expect(frameless.style).toEqual({ bg: 'none', border: 'none' })
        expect(frameless.textScale).toBeUndefined()
      }
    }

    const rootCanvasV2 = parseCanvasJson(readV2Fixture('root-canvas.json'))
    expect(rootCanvasV2.status).toBe('ok')
    if (rootCanvasV2.status === 'ok') {
      expect(rootCanvasV2.issues).toEqual([])
      expect(rootCanvasV2.data.schema).toBe(CANVAS_SCHEMA_VERSION)
      expect(Object.keys(rootCanvasV2.data.elements)).toEqual(['e_home0001', 'e_home0002'])
    }
  })

  it('migrates v1 canvas.json and root-canvas.json fixtures cleanly to v2 while preserving content and assets', () => {
    const canvas = parseCanvasJson(readV1Fixture('canvas.json'))
    expect(canvas.status).toBe('ok')
    if (canvas.status === 'ok') {
      expect(canvas.issues).toEqual([])
      expect(canvas.data.schema).toBe(2)
      expect(Object.keys(canvas.data.elements)).toEqual(['e_8f2a1c0d', 'e_91bc40aa'])
      const textEl = canvas.data.elements['e_8f2a1c0d']
      expect(textEl?.type).toBe('text')
      if (textEl?.type === 'text') {
        expect(textEl.style).toEqual({ bg: 'auto', border: 'auto' })
        expect(textEl.content.content).toHaveLength(3)
      }
      const imgEl = canvas.data.elements['e_91bc40aa']
      expect(imgEl?.type).toBe('image')
      if (imgEl?.type === 'image') {
        expect(imgEl.asset).toBe('assets/3fa9c1d2e4b5a671.webp')
        expect(imgEl.nw).toBe(1600)
        expect(imgEl.nh).toBe(1040)
      }
    }

    const rootCanvas = parseCanvasJson(readV1Fixture('root-canvas.json'))
    expect(rootCanvas.status).toBe('ok')
    if (rootCanvas.status === 'ok') {
      expect(rootCanvas.issues).toEqual([])
      expect(rootCanvas.data.schema).toBe(2)
      expect(Object.keys(rootCanvas.data.elements)).toEqual(['e_home0001', 'e_home0002'])
      const homeText = rootCanvas.data.elements['e_home0001']
      if (homeText?.type === 'text') {
        expect(homeText.style).toEqual({ bg: 'auto', border: 'auto' })
      }
      const homeImg = rootCanvas.data.elements['e_home0002']
      if (homeImg?.type === 'image') {
        expect(homeImg.asset).toBe('assets/7ab1c2d3e4f50987.webp')
      }
    }
  })

  it('migrates legacy v1 canvas hex colors on style and TipTap marks safely to Auto via migrateCanvasV1ToV2', () => {
    const legacyV1 = {
      schema: 1,
      elements: {
        e_8f2a1c0d: makeV1TextElement({
          style: { bg: '#fef3c7', border: '#d97706' },
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Colored legacy text',
                    marks: [
                      { type: 'bold' },
                      {
                        type: 'textStyle',
                        attrs: { color: '#7c9cff', fontFamily: 'Inter', fontSize: '16px' },
                      },
                      { type: 'highlight', attrs: { color: '#fbbf24' } },
                    ],
                  },
                  {
                    type: 'text',
                    text: 'Pure hex color',
                    marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }],
                  },
                ],
              },
            ],
          },
        }),
        e_91bc40aa: makeImageElement(),
      },
    }

    const migrated = migrateCanvasV1ToV2(legacyV1)
    expect(migrated.status).toBe('ok')
    if (migrated.status === 'ok') {
      expect(migrated.data.schema).toBe(2)
      expect(migrated.issues.map((i) => i.code)).toEqual(
        expect.arrayContaining(['migrated_legacy_hex_style', 'migrated_legacy_hex_color']),
      )
      const textEl = migrated.data.elements['e_8f2a1c0d']
      expect(textEl?.type).toBe('text')
      if (textEl?.type === 'text') {
        expect(textEl.style).toEqual({ bg: 'auto', border: 'auto' })
        const nodes = textEl.content.content?.[0]?.content ?? []
        expect(nodes[0]?.text).toBe('Colored legacy text')
        expect(nodes[0]?.marks).toEqual([
          { type: 'bold' },
          { type: 'textStyle', attrs: { fontFamily: 'Inter', fontSize: '16px' } },
        ])
        expect(nodes[1]?.text).toBe('Pure hex color')
        expect(nodes[1]?.marks).toBeUndefined()
      }
      const imgEl = migrated.data.elements['e_91bc40aa']
      expect(imgEl?.type).toBe('image')
      if (imgEl?.type === 'image') {
        expect(imgEl.asset).toBe('assets/3fa9c1d2e4b5a671.webp')
      }
    }

    // parseCanvasJson invokes the same v1 -> v2 upgrade path automatically
    const viaParse = parseCanvasJson(legacyV1)
    expect(viaParse).toEqual(migrated)
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

  it('parses v1 and v2 invalid fixtures into the expected discriminated outcomes without throwing', () => {
    const invalidId = parseNodeJson(readV1Fixture('invalid/node-invalid-id.json'))
    expect(invalidId.status).toBe('corrupt')

    const newerNode = parseNodeJson(readV1Fixture('invalid/node-newer-schema.json'))
    expect(newerNode).toEqual({ status: 'newer-schema', schemaVersion: 2 })

    const invalidAsset = parseCanvasJson(readV1Fixture('invalid/canvas-invalid-asset.json'))
    expect(invalidAsset.status).toBe('corrupt')

    const unsanitized = parseCanvasJson(readV1Fixture('invalid/canvas-unsanitized-tiptap.json'))
    expect(unsanitized.status).toBe('ok')
    if (unsanitized.status === 'ok') {
      expect(unsanitized.data.schema).toBe(2)
      expect(unsanitized.issues.length).toBeGreaterThanOrEqual(5)
      const textEl = unsanitized.data.elements['e_8f2a1c0d']
      expect(textEl?.type).toBe('text')
      if (textEl?.type === 'text') {
        expect(textEl.x).toBe(121)
        expect(textEl.style).toEqual({ bg: 'auto', border: 'auto' })
        expect(textEl.content.content).toHaveLength(1)
        const paragraph = textEl.content.content?.[0]
        const textNode = paragraph?.content?.[0]
        expect(textNode?.marks).toEqual([{ type: 'bold' }])
      }
    }

    // New v2 invalid fixtures
    const newerCanvas = parseCanvasJson(readV2Fixture('invalid/canvas-newer-schema.json'))
    expect(newerCanvas).toEqual({ status: 'newer-schema', schemaVersion: 3 })

    const rawHexCanvas = parseCanvasJson(readV2Fixture('invalid/canvas-raw-hex.json'))
    expect(rawHexCanvas.status).toBe('corrupt')

    const badAlignCanvas = parseCanvasJson(readV2Fixture('invalid/canvas-bad-align.json'))
    expect(badAlignCanvas.status).toBe('ok')
    if (badAlignCanvas.status === 'ok') {
      expect(badAlignCanvas.issues.filter((i) => i.code === 'disallowed_text_align')).toHaveLength(
        3,
      )
      const textEl = badAlignCanvas.data.elements['e_8f2a1c0d']
      expect(textEl?.type).toBe('text')
      if (textEl?.type === 'text') {
        const blocks = textEl.content.content ?? []
        expect(blocks[0]?.attrs).toEqual({ level: 2 })
        expect(blocks[1]?.attrs).toBeUndefined()
        expect(blocks[2]?.attrs).toBeUndefined()
      }
    }

    const obfuscatedHrefCanvas = parseCanvasJson(
      readV2Fixture('invalid/canvas-obfuscated-href.json'),
    )
    expect(obfuscatedHrefCanvas.status).toBe('ok')
    if (obfuscatedHrefCanvas.status === 'ok') {
      const codes = obfuscatedHrefCanvas.issues.map((i) => i.code)
      expect(codes).toEqual(
        expect.arrayContaining([
          'disallowed_tiptap_node',
          'disallowed_tiptap_attr',
          'disallowed_link_href',
        ]),
      )
      expect(
        obfuscatedHrefCanvas.issues.filter((i) => i.code === 'disallowed_link_href'),
      ).toHaveLength(6)
      const textEl = obfuscatedHrefCanvas.data.elements['e_8f2a1c0d']
      expect(textEl?.type).toBe('text')
      if (textEl?.type === 'text') {
        // Inline image node stripped, onclick stripped, all bad links & raw hex / bad CSS marks stripped
        expect(textEl.content).toEqual({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'obfuscated links' }],
            },
          ],
        })
      }
    }
  })

  it('returns corrupt for malformed JSON, non-objects, and invalid schema versions; newer-schema for > max version', () => {
    for (const badInput of ['{not json', null, [], 42, 'hello']) {
      expect(parseKnovitesJson(badInput).status).toBe('corrupt')
      expect(parseNodeJson(badInput).status).toBe('corrupt')
      expect(parseCanvasJson(badInput).status).toBe('corrupt')
    }

    for (const badSchema of [0, -1, 1.5, '1', '2', null]) {
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
    expect(parseCanvasJson({ schema: 3, elements: {} })).toEqual({
      status: 'newer-schema',
      schemaVersion: 3,
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
        '01JC8ZQ4M7X2K9T5VB3N6D8RH',
        '01JC8ZQ4M7X2K9T5VB3N6D8RHW0',
        '01jc8zq4m7x2k9t5vb3n6d8rhw',
        '01IC8ZQ4M7X2K9T5VB3N6D8RHW',
        '01LC8ZQ4M7X2K9T5VB3N6D8RHW',
        '01OC8ZQ4M7X2K9T5VB3N6D8RHW',
        '01UC8ZQ4M7X2K9T5VB3N6D8RHW',
        '81JC8ZQ4M7X2K9T5VB3N6D8RHW',
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

  describe('canvas.json v2 boundaries', () => {
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

    it('restricts v2 style.bg and style.border strictly to semantic tokens + auto + none (no hex, no null, no frame field)', () => {
      for (const token of CANVAS_STYLE_TOKENS) {
        const parsed = parseCanvasJson(
          makeValidCanvas({
            e_8f2a1c0d: makeTextElement({ style: { bg: token, border: token } }),
          }),
        )
        expect(parsed.status).toBe('ok')
      }

      for (const badStyle of [null, '#ff0000', '#7c9cff', '#fff', 'blue', 'transparent', '']) {
        expect(
          parseCanvasJson(
            makeValidCanvas({
              e_8f2a1c0d: makeTextElement({ style: { bg: badStyle, border: 'auto' } }),
            }),
          ).status,
        ).toBe('corrupt')
        expect(
          parseCanvasJson(
            makeValidCanvas({
              e_8f2a1c0d: makeTextElement({ style: { bg: 'auto', border: badStyle } }),
            }),
          ).status,
        ).toBe('corrupt')
      }

      // Adding a separate `frame` property must be rejected by strict schema
      expect(
        parseCanvasJson(
          makeValidCanvas({
            e_8f2a1c0d: makeTextElement({ style: { bg: 'none', border: 'none', frame: 'none' } }),
          }),
        ).status,
      ).toBe('corrupt')
    })

    it('validates textScale within [0.5, 3.0], omits default 1 on parse, and rejects invalid/out-of-range values', () => {
      for (const validScale of [TEXT_SCALE_MIN, 0.75, 1.25, 2.5, TEXT_SCALE_MAX]) {
        const parsed = parseCanvasJson(
          makeValidCanvas({ e_8f2a1c0d: makeTextElement({ textScale: validScale }) }),
        )
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
          const el = parsed.data.elements['e_8f2a1c0d']
          expect(el?.type).toBe('text')
          if (el?.type === 'text') {
            expect(el.textScale).toBe(validScale)
          }
        }
      }

      // Default textScale === 1 is normalized away
      const defaultScale = parseCanvasJson(
        makeValidCanvas({ e_8f2a1c0d: makeTextElement({ textScale: 1 }) }),
      )
      expect(defaultScale.status).toBe('ok')
      if (defaultScale.status === 'ok') {
        const el = defaultScale.data.elements['e_8f2a1c0d']
        expect(el?.type).toBe('text')
        if (el?.type === 'text') {
          expect('textScale' in el).toBe(false)
        }
      }

      for (const badScale of [
        0,
        -1,
        0.49,
        3.01,
        10,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        '1.5',
        null,
      ]) {
        expect(
          parseCanvasJson(makeValidCanvas({ e_8f2a1c0d: makeTextElement({ textScale: badScale }) }))
            .status,
        ).toBe('corrupt')
      }

      // Image elements must reject textScale
      expect(
        parseCanvasJson(makeValidCanvas({ e_91bc40aa: makeImageElement({ textScale: 1.5 }) }))
          .status,
      ).toBe('corrupt')
    })

    it('enforces image asset/nw/nh requirements', () => {
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

  describe('TipTap content whitelist sanitizer (v2 semantic tokens, textAlign, strict href & XSS defense)', () => {
    it('preserves all allowed nodes, textAlign (center/right, omits left), semantic color/highlight tokens, and valid href schemes', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1, textAlign: 'center' },
            content: [{ type: 'text', text: 'H1' }],
          },
          {
            type: 'heading',
            attrs: { level: 3, textAlign: 'right' },
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
                    attrs: { textAlign: 'center' },
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
                              color: 'accent',
                              fontFamily: 'Inter',
                              fontSize: '16px',
                            },
                          },
                          { type: 'highlight', attrs: { color: 'warning' } },
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

      // Verify all 5 text color tokens and all 4 highlight tokens are accepted
      for (const token of TEXT_COLOR_TOKENS) {
        const res = sanitizeEditorContent({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: token,
                  marks: [{ type: 'textStyle', attrs: { color: token } }],
                },
              ],
            },
          ],
        })
        expect(res.issues).toEqual([])
        expect(res.doc.content?.[0]?.content?.[0]?.marks).toEqual([
          { type: 'textStyle', attrs: { color: token } },
        ])
      }

      for (const token of HIGHLIGHT_COLOR_TOKENS) {
        const res = sanitizeEditorContent({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: token,
                  marks: [{ type: 'highlight', attrs: { color: token } }],
                },
              ],
            },
          ],
        })
        expect(res.issues).toEqual([])
        expect(res.doc.content?.[0]?.content?.[0]?.marks).toEqual([
          { type: 'highlight', attrs: { color: token } },
        ])
      }

      // 'violet' is valid for textStyle.color but NOT in the 4-token highlight palette
      const violetHighlight = sanitizeEditorContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'highlight', attrs: { color: 'violet' } }],
              },
            ],
          },
        ],
      })
      expect(violetHighlight.issues).toHaveLength(1)
      expect(violetHighlight.doc.content?.[0]?.content?.[0]?.marks).toBeUndefined()
    })

    it('omits default textAlign "left" cleanly and strips null / "justify" / invalid textAlign', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { textAlign: 'left' },
            content: [{ type: 'text', text: 'default left' }],
          },
          {
            type: 'heading',
            attrs: { level: 2, textAlign: 'left' },
            content: [{ type: 'text', text: 'left heading' }],
          },
          {
            type: 'paragraph',
            attrs: { textAlign: null },
            content: [{ type: 'text', text: 'null align' }],
          },
          {
            type: 'paragraph',
            attrs: { textAlign: 'justify' },
            content: [{ type: 'text', text: 'justify align' }],
          },
        ],
      }

      const parsed = parseCanvasJson(makeValidCanvas({ e_8f2a1c0d: makeTextElement({ content }) }))
      expect(parsed.status).toBe('ok')
      if (parsed.status === 'ok') {
        expect(parsed.issues.filter((i) => i.code === 'disallowed_text_align')).toHaveLength(2)
        const el = parsed.data.elements['e_8f2a1c0d']
        expect(el?.type).toBe('text')
        if (el?.type === 'text') {
          expect(el.content).toEqual({
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'default left' }] },
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'left heading' }],
              },
              { type: 'paragraph', content: [{ type: 'text', text: 'null align' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'justify align' }] },
            ],
          })
        }
      }
    })

    it('enforces strict href allowlist both in isAllowedHref / sanitizeEditorContent and parseCanvasJson', () => {
      for (const good of [
        'http://example.com',
        'https://example.com/path?a=1#b',
        'mailto:sec@example.com',
        `knovites:${VALID_ULID}`,
      ]) {
        expect(isAllowedHref(good)).toBe(true)
      }

      const badHrefs = [
        '',
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        'java\nscript:alert(1)',
        'java\tscript:alert(1)',
        ' javascript:alert(1)',
        ' https://example.com',
        'https://example.com ',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        'knovites:bad-id',
        'KNOVITES:' + VALID_ULID,
      ]
      for (const bad of badHrefs) {
        expect(isAllowedHref(bad)).toBe(false)

        const editorClean = sanitizeEditorContent({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: bad } }] },
              ],
            },
          ],
        })
        expect(editorClean.issues.some((i) => i.code === 'disallowed_link_href')).toBe(true)
        expect(editorClean.doc.content?.[0]?.content?.[0]?.marks).toBeUndefined()

        const parsed = parseCanvasJson(
          makeValidCanvas({
            e_8f2a1c0d: makeTextElement({
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'link',
                        marks: [{ type: 'link', attrs: { href: bad } }],
                      },
                    ],
                  },
                ],
              },
            }),
          }),
        )
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
          expect(parsed.issues.some((i) => i.code === 'disallowed_link_href')).toBe(true)
          const el = parsed.data.elements['e_8f2a1c0d']
          if (el?.type === 'text') {
            expect(el.content.content?.[0]?.content?.[0]?.marks).toBeUndefined()
          }
        }
      }
    })

    it('strips raw hex marks, on* attrs, dangerous CSS values, inline images, and unknown nodes/marks', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 4 },
            content: [{ type: 'text', text: 'Too deep' }],
          },
          {
            type: 'image',
            attrs: { src: 'http://evil.example/a.png' },
          },
          {
            type: 'customWidget',
            content: [{ type: 'text', text: 'drop' }],
          },
          {
            type: 'paragraph',
            attrs: { align: 'center', onclick: 'alert(1)', onmouseover: 'x()' },
            content: [
              {
                type: 'text',
                text: 'cleaned text',
                marks: [
                  {
                    type: 'link',
                    attrs: {
                      href: 'https://example.com',
                      target: '_blank',
                      rel: 'noopener',
                      class: 'ext',
                      title: 'x',
                      onclick: 'evil()',
                    },
                  },
                  { type: 'superscript' },
                  {
                    type: 'textStyle',
                    attrs: {
                      color: '#ff0000',
                      fontFamily: 'Inter; background:url(javascript:alert(1))',
                      fontSize: '14px',
                      onclick: 'alert(1)',
                    },
                  },
                  { type: 'textStyle', attrs: { color: '#7c9cff' } },
                  { type: 'highlight', attrs: { color: '#fbbf24', extra: 'x' } },
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
                    text: 'cleaned text',
                    marks: [
                      { type: 'link', attrs: { href: 'https://example.com' } },
                      { type: 'textStyle', attrs: { fontSize: '14px' } },
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

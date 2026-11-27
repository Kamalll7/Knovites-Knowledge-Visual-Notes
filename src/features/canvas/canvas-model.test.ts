import { describe, expect, it } from 'vitest'
import {
  CANVAS_SCHEMA_VERSION,
  ELEMENT_ID_REGEX,
  createEmptyCanvas,
  type CanvasJson,
} from '@/domain/schema'
import {
  addTextElementToCanvas,
  canvasDocToFlowNodes,
  createPlainTextDoc,
  updateTextElementContent,
} from '@/features/canvas/canvas-model'

const NOW = '2026-11-27T11:00:00Z'

describe('canvas-model pure mapping & immutable updates [T4.2, FR-CVS-01, FR-TXT-08]', () => {
  it('maps CanvasJson elements to React Flow nodes ordered by fractional z-index', () => {
    const doc: CanvasJson = {
      schema: CANVAS_SCHEMA_VERSION,
      elements: {
        e_top00002: {
          type: 'text',
          x: 420,
          y: 120,
          w: 300,
          z: 'a2',
          textScale: 1.5,
          style: { bg: 'none', border: 'none' },
          content: createPlainTextDoc('Top note'),
          updatedAt: NOW,
        },
        e_img00001: {
          type: 'image',
          x: 80,
          y: 260,
          w: 400,
          h: 240,
          z: 'a1',
          asset: 'assets/3fa9c1d2e4b5a671.webp',
          nw: 1600,
          nh: 960,
          alt: 'Stack diagram',
          updatedAt: NOW,
        },
        e_base0000: {
          type: 'text',
          x: 40,
          y: 40,
          w: 320,
          z: 'a0',
          style: { bg: 'auto', border: 'auto' },
          content: createPlainTextDoc('Base note'),
          updatedAt: NOW,
        },
      },
    }

    const nodes = canvasDocToFlowNodes(doc)
    expect(nodes.map((n) => n.id)).toEqual(['e_base0000', 'e_img00001', 'e_top00002'])
    expect(nodes.map((n) => n.type)).toEqual(['canvasText', 'canvasImage', 'canvasText'])
    expect(nodes[0]?.position).toEqual({ x: 40, y: 40 })
    expect(nodes[0]?.zIndex).toBe(1)
    expect(nodes[1]?.zIndex).toBe(2)
    expect(nodes[2]?.zIndex).toBe(3)
    expect(nodes[2]?.style).toEqual({ width: 450 })
  })

  it('produces brand new CanvasJson and TipTapDoc references without mutating previous state', () => {
    const empty = createEmptyCanvas()
    const { doc: doc1, elementId } = addTextElementToCanvas(empty, {
      x: 100,
      y: 80,
      text: 'First box',
      now: NOW,
    })

    expect(ELEMENT_ID_REGEX.test(elementId)).toBe(true)
    expect(doc1).not.toBe(empty)
    expect(doc1.elements).not.toBe(empty.elements)
    expect(Object.keys(empty.elements)).toEqual([])
    expect(Object.keys(doc1.elements)).toEqual([elementId])

    const elBefore = doc1.elements[elementId]!
    expect(elBefore.type).toBe('text')
    const contentBefore = elBefore.type === 'text' ? elBefore.content : null

    const doc2 = updateTextElementContent(
      doc1,
      elementId,
      createPlainTextDoc('Updated box'),
      '2026-11-27T11:05:00Z',
    )
    expect(doc2).not.toBe(doc1)
    expect(doc2.elements).not.toBe(doc1.elements)
    expect(doc2.elements[elementId]).not.toBe(elBefore)
    const elAfter = doc2.elements[elementId]!
    expect(elAfter.type).toBe('text')
    if (elAfter.type === 'text') {
      expect(elAfter.content).not.toBe(contentBefore)
      expect(elAfter.content.content?.[0]?.content?.[0]?.text).toBe('Updated box')
    }
    // Original doc1 remained completely immutable
    if (elBefore.type === 'text') {
      expect(elBefore.content.content?.[0]?.content?.[0]?.text).toBe('First box')
    }
  })
})

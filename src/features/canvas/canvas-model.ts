import type { Node } from '@xyflow/react'
import { generateKeyBetween } from 'fractional-indexing'
import {
  CANVAS_SCHEMA_VERSION,
  type CanvasElement,
  type CanvasImageElement,
  type CanvasJson,
  type CanvasStyleToken,
  type CanvasTextElement,
  type TipTapDoc,
} from '@/domain/schema'

export const DEFAULT_TEXT_BOX_WIDTH = 320

export interface CanvasTextNodeData extends Record<string, unknown> {
  readonly elementId: string
  readonly element: CanvasTextElement
}

export interface CanvasImageNodeData extends Record<string, unknown> {
  readonly elementId: string
  readonly element: CanvasImageElement
}

export type CanvasTextFlowNode = Node<CanvasTextNodeData, 'canvasText'>
export type CanvasImageFlowNode = Node<CanvasImageNodeData, 'canvasImage'>
export type CanvasFlowNode = CanvasTextFlowNode | CanvasImageFlowNode

const ELEMENT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function compareLex(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Maps a `CanvasJson` v2 document into React Flow nodes sorted deterministically by `(z, id)`.
 */
export function canvasDocToFlowNodes(doc: CanvasJson): CanvasFlowNode[] {
  const entries = Object.entries(doc.elements).sort(([idA, elA], [idB, elB]) => {
    const byZ = compareLex(elA.z, elB.z)
    return byZ !== 0 ? byZ : compareLex(idA, idB)
  })

  return entries.map(([id, element], index) => {
    const zIndex = index + 1
    if (element.type === 'text') {
      const scale = element.textScale ?? 1
      return {
        id,
        type: 'canvasText',
        position: { x: element.x, y: element.y },
        zIndex,
        data: { elementId: id, element },
        style: { width: Math.round(element.w * scale) },
      }
    }
    return {
      id,
      type: 'canvasImage',
      position: { x: element.x, y: element.y },
      zIndex,
      data: { elementId: id, element },
      style: { width: element.w, height: element.h },
    }
  })
}

export function createPlainTextDoc(text: string): TipTapDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text.length > 0 ? [{ type: 'text', text }] : [],
      },
    ],
  }
}

export function isTipTapDocEmpty(doc: TipTapDoc): boolean {
  const walk = (nodes?: TipTapDoc['content']): boolean => {
    if (!nodes || nodes.length === 0) return true
    for (const node of nodes) {
      if (node.text && node.text.trim().length > 0) return false
      if (node.content && !walk(node.content)) return false
    }
    return true
  }
  return walk(doc.content)
}

export function generateCanvasElementId(existingIds: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let suffix = ''
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(8)
      crypto.getRandomValues(bytes)
      for (let i = 0; i < 8; i += 1) {
        suffix += ELEMENT_ID_ALPHABET[bytes[i]! % ELEMENT_ID_ALPHABET.length]!
      }
    } else {
      const seed = (Date.now() + attempt * 9973).toString(36).padStart(8, '0').slice(-8)
      suffix = seed.replace(/[^a-z0-9]/g, '0')
    }
    const candidate = `e_${suffix}`
    if (!existingIds.has(candidate)) {
      return candidate
    }
  }
  let counter = existingIds.size + 1
  while (existingIds.has(`e_${counter.toString(36).padStart(8, '0')}`)) {
    counter += 1
  }
  return `e_${counter.toString(36).padStart(8, '0')}`
}

export function nextElementZOrder(doc: CanvasJson): string {
  let maxZ: string | null = null
  for (const el of Object.values(doc.elements)) {
    if (maxZ === null || compareLex(el.z, maxZ) > 0) {
      maxZ = el.z
    }
  }
  try {
    return generateKeyBetween(maxZ, null)
  } catch {
    return maxZ === null ? 'a0' : `${maxZ}1`
  }
}

export function addTextElementToCanvas(
  doc: CanvasJson,
  params: {
    readonly x: number
    readonly y: number
    readonly w?: number
    readonly text: string
    readonly bg?: CanvasStyleToken
    readonly border?: CanvasStyleToken
    readonly textScale?: number
    readonly now?: string
  },
): { readonly doc: CanvasJson; readonly elementId: string } {
  const existingIds = new Set(Object.keys(doc.elements))
  const elementId = generateCanvasElementId(existingIds)
  const now = params.now ?? new Date().toISOString()
  const nextElement: CanvasTextElement = {
    type: 'text',
    x: Math.round(params.x),
    y: Math.round(params.y),
    w: Math.round(params.w ?? DEFAULT_TEXT_BOX_WIDTH),
    z: nextElementZOrder(doc),
    ...(params.textScale !== undefined && params.textScale !== 1
      ? { textScale: params.textScale }
      : {}),
    style: {
      bg: params.bg ?? 'auto',
      border: params.border ?? 'auto',
    },
    content: createPlainTextDoc(params.text),
    updatedAt: now,
  }
  const nextElements: Record<string, CanvasElement> = {
    ...doc.elements,
    [elementId]: nextElement,
  }
  return {
    elementId,
    doc: {
      schema: CANVAS_SCHEMA_VERSION,
      elements: nextElements,
    },
  }
}

/**
 * Immutably replaces a text element's `content` with a brand new `TipTapDoc` and `CanvasJson` reference
 * so the `WeakMap`-based static renderer cache (`FR-TXT-08`) invalidates deterministically.
 */
export function updateTextElementContent(
  doc: CanvasJson,
  elementId: string,
  nextContent: TipTapDoc,
  now: string = new Date().toISOString(),
): CanvasJson {
  const existing = doc.elements[elementId]
  if (!existing || existing.type !== 'text') return doc
  const updatedElement: CanvasTextElement = {
    ...existing,
    content: nextContent,
    updatedAt: now,
  }
  return {
    schema: CANVAS_SCHEMA_VERSION,
    elements: {
      ...doc.elements,
      [elementId]: updatedElement,
    },
  }
}

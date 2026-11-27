import {
  isPlainObject,
  type CanvasElement,
  type CanvasJson,
  type KnovitesJson,
  type NodeJson,
  type TipTapDoc,
  type TipTapNode,
} from '@/domain/schema'

function normalizeInt(value: number): number {
  const rounded = Math.round(value)
  return Object.is(rounded, -0) ? 0 : rounded
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'number') {
    return normalizeNumber(value)
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    const sortedKeys = Object.keys(value).sort()
    for (const key of sortedKeys) {
      const prop = value[key]
      if (prop !== undefined) {
        out[key] = canonicalize(prop)
      }
    }
    return out
  }
  return value
}

function serializeCanonical(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

function normalizeTipTapNode(node: TipTapNode): TipTapNode {
  const next: TipTapNode = { type: node.type }
  if (node.text !== undefined) {
    next.text = node.text
  }
  if (node.marks !== undefined && node.marks.length > 0) {
    next.marks = node.marks
  }
  if (node.attrs && isPlainObject(node.attrs)) {
    const cleanedAttrs: Record<string, string | number | null> = {}
    for (const [key, val] of Object.entries(node.attrs)) {
      if (
        key === 'textAlign' &&
        (node.type === 'paragraph' || node.type === 'heading') &&
        (val === null || val === 'left')
      ) {
        continue
      }
      if (val !== undefined) {
        cleanedAttrs[key] = val
      }
    }
    if (Object.keys(cleanedAttrs).length > 0) {
      next.attrs = cleanedAttrs
    }
  }
  if (node.content !== undefined) {
    next.content = node.content.map(normalizeTipTapNode)
  }
  return next
}

function normalizeTipTapDoc(doc: TipTapDoc): TipTapDoc {
  const out: TipTapDoc = { type: 'doc' }
  if (doc.content !== undefined) {
    out.content = doc.content.map(normalizeTipTapNode)
  }
  return out
}

function normalizeCanvasElement(element: CanvasElement): CanvasElement {
  const rotation = element.rotation !== undefined ? normalizeInt(element.rotation) : undefined
  if (element.type === 'text') {
    const { textScale, ...rest } = element
    return {
      ...rest,
      x: normalizeInt(element.x),
      y: normalizeInt(element.y),
      w: normalizeInt(element.w),
      content: normalizeTipTapDoc(element.content),
      ...(rotation !== undefined ? { rotation } : {}),
      ...(textScale !== undefined && textScale !== 1
        ? { textScale: normalizeNumber(textScale) }
        : {}),
    }
  }
  return {
    ...element,
    x: normalizeInt(element.x),
    y: normalizeInt(element.y),
    w: normalizeInt(element.w),
    h: normalizeInt(element.h),
    nw: normalizeInt(element.nw),
    nh: normalizeInt(element.nh),
    ...(rotation !== undefined ? { rotation } : {}),
  }
}

export function serializeKnovitesJson(doc: KnovitesJson): string {
  return serializeCanonical(doc)
}

export function serializeNodeJson(doc: NodeJson): string {
  return serializeCanonical(doc)
}

export function serializeCanvasJson(doc: CanvasJson): string {
  const normalizedElements: Record<string, CanvasElement> = {}
  for (const [id, element] of Object.entries(doc.elements)) {
    normalizedElements[id] = normalizeCanvasElement(element)
  }
  return serializeCanonical({
    schema: doc.schema,
    elements: normalizedElements,
  })
}

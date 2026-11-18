import { z } from 'zod'
import { sanitizeTipTapDoc } from '@/domain/schema/tiptap'
import {
  ASSET_PATH_REGEX,
  CURRENT_SCHEMA_VERSION,
  ELEMENT_ID_REGEX,
  HEX_COLOR_REGEX,
  ORDER_INDEX_REGEX,
  TAG_REGEX,
  ULID_REGEX,
  isPlainObject,
  type CanvasElement,
  type CanvasImageElement,
  type CanvasJson,
  type CanvasTextElement,
  type KnovitesJson,
  type NodeJson,
  type ParseResult,
  type SchemaIssue,
} from '@/domain/schema/types'

const utcIsoDatetimeSchema = z.iso.datetime()
const ulidSchema = z.string().regex(ULID_REGEX, 'Expected valid ULID')
const hexColorSchema = z.string().regex(HEX_COLOR_REGEX, 'Expected #rrggbb hex color')
const nullableHexColorSchema = hexColorSchema.nullable()
const orderStringSchema = z
  .string()
  .min(1, 'Order string must be non-empty')
  .regex(ORDER_INDEX_REGEX, 'Order string must not contain whitespace')

export const knovitesJsonSchema = z.strictObject({
  schema: z.literal(CURRENT_SCHEMA_VERSION),
  title: z.string().min(1).max(200),
  createdAt: utcIsoDatetimeSchema,
})

const nodeLinkSchema = z.strictObject({
  to: ulidSchema,
  label: z.string().max(80).optional(),
})

export const nodeJsonSchema = z.strictObject({
  schema: z.literal(CURRENT_SCHEMA_VERSION),
  id: ulidSchema,
  title: z.string().min(1).max(200),
  type: z.enum(['category', 'concept', 'technique', 'challenge', 'lab']).default('concept'),
  status: z.enum(['none', 'learning', 'practiced', 'mastered']).default('none'),
  tags: z.array(z.string().regex(TAG_REGEX, 'Tag must match [a-z0-9_-]{1,32}')).max(20),
  order: orderStringSchema,
  color: nullableHexColorSchema,
  links: z.array(nodeLinkSchema).max(100),
  createdAt: utcIsoDatetimeSchema,
  updatedAt: utcIsoDatetimeSchema,
})

const canvasTextStyleSchema = z.strictObject({
  bg: nullableHexColorSchema,
  border: nullableHexColorSchema,
})

const finiteNumberSchema = z.number().refine(Number.isFinite, 'Expected finite number')

const rawCanvasTextElementSchema = z.strictObject({
  type: z.literal('text'),
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  w: finiteNumberSchema,
  h: z.unknown().optional(),
  z: orderStringSchema,
  rotation: finiteNumberSchema.optional(),
  style: canvasTextStyleSchema,
  content: z
    .object({ type: z.literal('doc') })
    .passthrough()
    .refine(
      (doc) => doc['content'] === undefined || Array.isArray(doc['content']),
      'doc.content must be an array when present',
    ),
  updatedAt: utcIsoDatetimeSchema,
})

const rawCanvasImageElementSchema = z.strictObject({
  type: z.literal('image'),
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  w: finiteNumberSchema,
  h: finiteNumberSchema,
  z: orderStringSchema,
  rotation: finiteNumberSchema.optional(),
  asset: z.string().regex(ASSET_PATH_REGEX, 'Expected assets/<16-hex>.<png|jpg|jpeg|webp|gif>'),
  nw: z.number().int().min(1),
  nh: z.number().int().min(1),
  alt: z.string().optional(),
  updatedAt: utcIsoDatetimeSchema,
})

const rawCanvasElementSchema = z.discriminatedUnion('type', [
  rawCanvasTextElementSchema,
  rawCanvasImageElementSchema,
])

const rawCanvasJsonSchema = z.strictObject({
  schema: z.literal(CURRENT_SCHEMA_VERSION),
  elements: z.record(
    z.string().regex(ELEMENT_ID_REGEX, 'Element ID must match e_<8 lowercase alphanumeric>'),
    rawCanvasElementSchema,
  ),
})

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

function roundCoord(value: number, path: string, issues: SchemaIssue[]): number {
  if (Number.isInteger(value)) {
    return normalizeZero(value)
  }
  const rounded = normalizeZero(Math.round(value))
  issues.push({
    path,
    code: 'rounded_coordinate',
    message: `Rounded non-integer coordinate/dimension ${value} to ${rounded}.`,
  })
  return rounded
}

function mapZodIssues(zodIssues: z.core.$ZodIssue[]): SchemaIssue[] {
  return zodIssues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }))
}

function decodeInput(
  input: unknown,
):
  | { kind: 'ready'; value: Record<string, unknown> }
  | { kind: 'newer-schema'; schemaVersion: number }
  | { kind: 'corrupt'; errors: SchemaIssue[] } {
  let parsed: unknown = input
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown
    } catch (error) {
      return {
        kind: 'corrupt',
        errors: [
          {
            path: '',
            code: 'invalid_json',
            message: error instanceof Error ? error.message : 'Invalid JSON syntax',
          },
        ],
      }
    }
  }

  if (!isPlainObject(parsed)) {
    return {
      kind: 'corrupt',
      errors: [
        {
          path: '',
          code: 'invalid_root',
          message: 'Expected JSON root object.',
        },
      ],
    }
  }

  const schema = parsed['schema']
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return {
      kind: 'corrupt',
      errors: [
        {
          path: 'schema',
          code: 'invalid_schema',
          message: 'Field "schema" must be a positive integer.',
        },
      ],
    }
  }

  if (schema > CURRENT_SCHEMA_VERSION) {
    return {
      kind: 'newer-schema',
      schemaVersion: schema,
    }
  }

  return { kind: 'ready', value: parsed }
}

function parseWithZodSchema<T>(input: unknown, schema: z.ZodType<T>): ParseResult<T> {
  const decoded = decodeInput(input)
  if (decoded.kind === 'corrupt') {
    return { status: 'corrupt', errors: decoded.errors }
  }
  if (decoded.kind === 'newer-schema') {
    return { status: 'newer-schema', schemaVersion: decoded.schemaVersion }
  }

  const result = schema.safeParse(decoded.value)
  if (!result.success) {
    return { status: 'corrupt', errors: mapZodIssues(result.error.issues) }
  }
  return { status: 'ok', data: result.data, issues: [] }
}

export function parseKnovitesJson(input: unknown): ParseResult<KnovitesJson> {
  return parseWithZodSchema(input, knovitesJsonSchema)
}

export function parseNodeJson(input: unknown): ParseResult<NodeJson> {
  return parseWithZodSchema(input, nodeJsonSchema)
}

export function parseCanvasJson(input: unknown): ParseResult<CanvasJson> {
  const decoded = decodeInput(input)
  if (decoded.kind === 'corrupt') {
    return { status: 'corrupt', errors: decoded.errors }
  }
  if (decoded.kind === 'newer-schema') {
    return { status: 'newer-schema', schemaVersion: decoded.schemaVersion }
  }

  const result = rawCanvasJsonSchema.safeParse(decoded.value)
  if (!result.success) {
    return { status: 'corrupt', errors: mapZodIssues(result.error.issues) }
  }

  const issues: SchemaIssue[] = []
  const errors: SchemaIssue[] = []
  const cleanElements: Record<string, CanvasElement> = {}

  for (const [id, rawEl] of Object.entries(result.data.elements)) {
    const basePath = `elements.${id}`
    const x = roundCoord(rawEl.x, `${basePath}.x`, issues)
    const y = roundCoord(rawEl.y, `${basePath}.y`, issues)
    const w = roundCoord(rawEl.w, `${basePath}.w`, issues)

    if (w < 1) {
      errors.push({
        path: `${basePath}.w`,
        code: 'invalid_dimension',
        message: 'Width "w" must round to at least 1.',
      })
      continue
    }

    const rotation =
      rawEl.rotation !== undefined
        ? roundCoord(rawEl.rotation, `${basePath}.rotation`, issues)
        : undefined

    if (rawEl.type === 'text') {
      if ('h' in rawEl && rawEl.h !== undefined) {
        issues.push({
          path: `${basePath}.h`,
          code: 'ignored_text_height',
          message: 'Ignored height "h" on text element because text height is auto-derived.',
        })
      }
      const cleanEl: CanvasTextElement = {
        type: 'text',
        x,
        y,
        w,
        z: rawEl.z,
        style: rawEl.style,
        content: sanitizeTipTapDoc(rawEl.content, `${basePath}.content`, issues),
        updatedAt: rawEl.updatedAt,
      }
      if (rotation !== undefined) {
        cleanEl.rotation = rotation
      }
      cleanElements[id] = cleanEl
    } else {
      const h = roundCoord(rawEl.h, `${basePath}.h`, issues)
      if (h < 1) {
        errors.push({
          path: `${basePath}.h`,
          code: 'invalid_dimension',
          message: 'Height "h" must round to at least 1.',
        })
        continue
      }
      const cleanEl: CanvasImageElement = {
        type: 'image',
        x,
        y,
        w,
        h,
        z: rawEl.z,
        asset: rawEl.asset,
        nw: rawEl.nw,
        nh: rawEl.nh,
        updatedAt: rawEl.updatedAt,
      }
      if (rotation !== undefined) {
        cleanEl.rotation = rotation
      }
      if (rawEl.alt !== undefined) {
        cleanEl.alt = rawEl.alt
      }
      cleanElements[id] = cleanEl
    }
  }

  if (errors.length > 0) {
    return { status: 'corrupt', errors }
  }

  return {
    status: 'ok',
    data: {
      schema: CURRENT_SCHEMA_VERSION,
      elements: cleanElements,
    },
    issues,
  }
}

import { z } from 'zod'
import { sanitizeTipTapDoc } from '@/domain/schema/tiptap'
import {
  ASSET_PATH_REGEX,
  CANVAS_SCHEMA_VERSION,
  CANVAS_STYLE_TOKENS,
  CURRENT_SCHEMA_VERSION,
  ELEMENT_ID_REGEX,
  HEX_COLOR_REGEX,
  ORDER_INDEX_REGEX,
  TAG_REGEX,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  ULID_REGEX,
  isPlainObject,
  type CanvasElement,
  type CanvasImageElement,
  type CanvasJson,
  type CanvasStyleToken,
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
const canvasStyleTokenSchema = z.enum(CANVAS_STYLE_TOKENS)
const orderStringSchema = z
  .string()
  .min(1, 'Order string must be non-empty')
  .regex(ORDER_INDEX_REGEX, 'Order string must not contain whitespace')
const finiteNumberSchema = z.number().refine(Number.isFinite, 'Expected finite number')

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

const tipTapDocContainerSchema = z
  .object({ type: z.literal('doc') })
  .passthrough()
  .refine(
    (doc) => doc['content'] === undefined || Array.isArray(doc['content']),
    'doc.content must be an array when present',
  )

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

const canvasV1TextStyleSchema = z.strictObject({
  bg: nullableHexColorSchema,
  border: nullableHexColorSchema,
})

const rawCanvasV1TextElementSchema = z.strictObject({
  type: z.literal('text'),
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  w: finiteNumberSchema,
  h: z.unknown().optional(),
  z: orderStringSchema,
  rotation: finiteNumberSchema.optional(),
  style: canvasV1TextStyleSchema,
  content: tipTapDocContainerSchema,
  updatedAt: utcIsoDatetimeSchema,
})

const rawCanvasV1JsonSchema = z.strictObject({
  schema: z.literal(1),
  elements: z.record(
    z.string().regex(ELEMENT_ID_REGEX, 'Element ID must match e_<8 lowercase alphanumeric>'),
    z.discriminatedUnion('type', [rawCanvasV1TextElementSchema, rawCanvasImageElementSchema]),
  ),
})

const canvasV2TextStyleSchema = z.strictObject({
  bg: canvasStyleTokenSchema,
  border: canvasStyleTokenSchema,
})

const textScaleSchema = finiteNumberSchema
  .min(TEXT_SCALE_MIN, `textScale must be at least ${TEXT_SCALE_MIN}`)
  .max(TEXT_SCALE_MAX, `textScale must be at most ${TEXT_SCALE_MAX}`)

const rawCanvasV2TextElementSchema = z.strictObject({
  type: z.literal('text'),
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  w: finiteNumberSchema,
  h: z.unknown().optional(),
  z: orderStringSchema,
  rotation: finiteNumberSchema.optional(),
  textScale: textScaleSchema.optional(),
  style: canvasV2TextStyleSchema,
  content: tipTapDocContainerSchema,
  updatedAt: utcIsoDatetimeSchema,
})

const rawCanvasV2JsonSchema = z.strictObject({
  schema: z.literal(CANVAS_SCHEMA_VERSION),
  elements: z.record(
    z.string().regex(ELEMENT_ID_REGEX, 'Element ID must match e_<8 lowercase alphanumeric>'),
    z.discriminatedUnion('type', [rawCanvasV2TextElementSchema, rawCanvasImageElementSchema]),
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
  maxSchemaVersion: number,
):
  | { kind: 'ready'; value: Record<string, unknown>; schemaVersion: number }
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

  if (schema > maxSchemaVersion) {
    return {
      kind: 'newer-schema',
      schemaVersion: schema,
    }
  }

  return { kind: 'ready', value: parsed, schemaVersion: schema }
}

function parseWithZodSchema<T>(
  input: unknown,
  schema: z.ZodType<T>,
  maxSchemaVersion: number,
): ParseResult<T> {
  const decoded = decodeInput(input, maxSchemaVersion)
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
  return parseWithZodSchema(input, knovitesJsonSchema, CURRENT_SCHEMA_VERSION)
}

export function parseNodeJson(input: unknown): ParseResult<NodeJson> {
  return parseWithZodSchema(input, nodeJsonSchema, CURRENT_SCHEMA_VERSION)
}

type RawTextElV1 = z.infer<typeof rawCanvasV1TextElementSchema>
type RawTextElV2 = z.infer<typeof rawCanvasV2TextElementSchema>
type RawImageEl = z.infer<typeof rawCanvasImageElementSchema>

function mapLegacyStyleValue(
  value: string | null,
  path: string,
  issues: SchemaIssue[],
): CanvasStyleToken {
  if (value !== null) {
    issues.push({
      path,
      code: 'migrated_legacy_hex_style',
      message: `Migrated legacy v1 hex style "${value}" to "auto".`,
    })
  }
  return 'auto'
}

function finalizeCanvasElements(
  rawElements: Record<string, RawTextElV1 | RawTextElV2 | RawImageEl>,
  legacyV1: boolean,
): ParseResult<CanvasJson> {
  const issues: SchemaIssue[] = []
  const errors: SchemaIssue[] = []
  const cleanElements: Record<string, CanvasElement> = {}

  for (const [id, rawEl] of Object.entries(rawElements)) {
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

      const style = legacyV1
        ? {
            bg: mapLegacyStyleValue(
              (rawEl as RawTextElV1).style.bg,
              `${basePath}.style.bg`,
              issues,
            ),
            border: mapLegacyStyleValue(
              (rawEl as RawTextElV1).style.border,
              `${basePath}.style.border`,
              issues,
            ),
          }
        : (rawEl as RawTextElV2).style

      const cleanEl: CanvasTextElement = {
        type: 'text',
        x,
        y,
        w,
        z: rawEl.z,
        style,
        content: sanitizeTipTapDoc(rawEl.content, `${basePath}.content`, issues, {
          legacyV1HexMigration: legacyV1,
        }),
        updatedAt: rawEl.updatedAt,
      }
      if (rotation !== undefined) {
        cleanEl.rotation = rotation
      }
      if (!legacyV1) {
        const rawScale = (rawEl as RawTextElV2).textScale
        if (rawScale !== undefined && rawScale !== 1) {
          cleanEl.textScale = rawScale
        }
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
      schema: CANVAS_SCHEMA_VERSION,
      elements: cleanElements,
    },
    issues,
  }
}

/**
 * Pure migration `canvas.json` v1 -> v2 (`docs/data-format.md` §5.7):
 * maps v1 `null` and `#rrggbb` card styles to `'auto'`, strips legacy `#rrggbb` TipTap mark colors
 * safely to Auto, and preserves all text content, links, and image assets intact.
 */
export function migrateCanvasV1ToV2(input: unknown): ParseResult<CanvasJson> {
  const decoded = decodeInput(input, 1)
  if (decoded.kind === 'corrupt') {
    return { status: 'corrupt', errors: decoded.errors }
  }
  if (decoded.kind === 'newer-schema') {
    return { status: 'newer-schema', schemaVersion: decoded.schemaVersion }
  }

  const result = rawCanvasV1JsonSchema.safeParse(decoded.value)
  if (!result.success) {
    return { status: 'corrupt', errors: mapZodIssues(result.error.issues) }
  }

  return finalizeCanvasElements(result.data.elements, true)
}

export function parseCanvasJson(input: unknown): ParseResult<CanvasJson> {
  const decoded = decodeInput(input, CANVAS_SCHEMA_VERSION)
  if (decoded.kind === 'corrupt') {
    return { status: 'corrupt', errors: decoded.errors }
  }
  if (decoded.kind === 'newer-schema') {
    return { status: 'newer-schema', schemaVersion: decoded.schemaVersion }
  }

  if (decoded.schemaVersion === 1) {
    return migrateCanvasV1ToV2(decoded.value)
  }

  const result = rawCanvasV2JsonSchema.safeParse(decoded.value)
  if (!result.success) {
    return { status: 'corrupt', errors: mapZodIssues(result.error.issues) }
  }

  return finalizeCanvasElements(result.data.elements, false)
}

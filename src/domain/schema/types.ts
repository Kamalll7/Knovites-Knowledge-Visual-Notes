export const CURRENT_SCHEMA_VERSION = 1 as const
export const CANVAS_SCHEMA_VERSION = 2 as const
export const VIRTUAL_ROOT_ID = '__root__' as const
export type VirtualRootId = typeof VIRTUAL_ROOT_ID

export const KNOVITES_META_FILE = 'knovites.json' as const
export const NODE_META_FILE = 'node.json' as const
export const CANVAS_FILE = 'canvas.json' as const
export const ASSETS_DIR = 'assets' as const

export const TEXT_SCALE_MIN = 0.5 as const
export const TEXT_SCALE_MAX = 3.0 as const

export const TEXT_ALIGN_VALUES = ['left', 'center', 'right'] as const
export type TextAlignValue = (typeof TEXT_ALIGN_VALUES)[number]

export const TEXT_COLOR_TOKENS = ['accent', 'warning', 'success', 'danger', 'violet'] as const
export type TextColorToken = (typeof TEXT_COLOR_TOKENS)[number]

export const HIGHLIGHT_COLOR_TOKENS = ['warning', 'success', 'accent', 'danger'] as const
export type HighlightColorToken = (typeof HIGHLIGHT_COLOR_TOKENS)[number]

export const CANVAS_STYLE_TOKENS = [
  'auto',
  'none',
  'accent',
  'warning',
  'success',
  'danger',
  'violet',
] as const
export type CanvasStyleToken = (typeof CANVAS_STYLE_TOKENS)[number]

const TEXT_ALIGN_SET = new Set<string>(TEXT_ALIGN_VALUES)
const TEXT_COLOR_TOKEN_SET = new Set<string>(TEXT_COLOR_TOKENS)
const HIGHLIGHT_COLOR_TOKEN_SET = new Set<string>(HIGHLIGHT_COLOR_TOKENS)
const CANVAS_STYLE_TOKEN_SET = new Set<string>(CANVAS_STYLE_TOKENS)

export function isVirtualRootId(id: string | null | undefined): id is VirtualRootId {
  return id === VIRTUAL_ROOT_ID
}

export function isAllowedTextAlign(value: unknown): value is TextAlignValue {
  return typeof value === 'string' && TEXT_ALIGN_SET.has(value)
}

export function isTextColorToken(value: unknown): value is TextColorToken {
  return typeof value === 'string' && TEXT_COLOR_TOKEN_SET.has(value)
}

export function isHighlightColorToken(value: unknown): value is HighlightColorToken {
  return typeof value === 'string' && HIGHLIGHT_COLOR_TOKEN_SET.has(value)
}

export function isCanvasStyleToken(value: unknown): value is CanvasStyleToken {
  return typeof value === 'string' && CANVAS_STYLE_TOKEN_SET.has(value)
}

export function isValidTextScale(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= TEXT_SCALE_MIN &&
    value <= TEXT_SCALE_MAX
  )
}

export const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
export const ELEMENT_ID_REGEX = /^e_[a-z0-9]{8}$/
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/
export const TAG_REGEX = /^[a-z0-9_-]{1,32}$/
export const ASSET_PATH_REGEX = /^assets\/[0-9a-f]{16}\.(?:png|jpg|jpeg|webp|gif)$/
export const ORDER_INDEX_REGEX = /^\S+$/

export interface SchemaIssue {
  path: string
  code: string
  message: string
}

export type ParseResult<T> =
  | { status: 'ok'; data: T; issues: SchemaIssue[] }
  | { status: 'corrupt'; errors: SchemaIssue[] }
  | { status: 'newer-schema'; schemaVersion: number }

export interface KnovitesJson {
  schema: 1
  title: string
  createdAt: string
}

export type NodeType = 'category' | 'concept' | 'technique' | 'challenge' | 'lab'
export type NodeStatus = 'none' | 'learning' | 'practiced' | 'mastered'

export interface NodeLink {
  to: string
  label?: string
}

export interface NodeJson {
  schema: 1
  id: string
  title: string
  type: NodeType
  status: NodeStatus
  tags: string[]
  order: string
  color: string | null
  links: NodeLink[]
  createdAt: string
  updatedAt: string
}

export type TipTapMarkType =
  'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link' | 'textStyle' | 'highlight'

export interface TipTapMark {
  type: TipTapMarkType
  attrs?: Record<string, string | null>
}

export type TipTapNodeType =
  | 'doc'
  | 'paragraph'
  | 'heading'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'codeBlock'
  | 'blockquote'
  | 'hardBreak'
  | 'horizontalRule'
  | 'text'

export interface TipTapNode {
  type: TipTapNodeType
  attrs?: Record<string, string | number | null>
  content?: TipTapNode[]
  marks?: TipTapMark[]
  text?: string
}

export interface TipTapDoc {
  type: 'doc'
  content?: TipTapNode[]
}

export interface CanvasTextStyle {
  bg: CanvasStyleToken
  border: CanvasStyleToken
}

export interface CanvasTextElement {
  type: 'text'
  x: number
  y: number
  w: number
  z: string
  rotation?: number
  textScale?: number
  style: CanvasTextStyle
  content: TipTapDoc
  updatedAt: string
}

export interface CanvasImageElement {
  type: 'image'
  x: number
  y: number
  w: number
  h: number
  z: string
  rotation?: number
  asset: string
  nw: number
  nh: number
  alt?: string
  updatedAt: string
}

export type CanvasElement = CanvasTextElement | CanvasImageElement

export interface CanvasJson {
  schema: typeof CANVAS_SCHEMA_VERSION
  elements: Record<string, CanvasElement>
}

export function createEmptyCanvas(): CanvasJson {
  return {
    schema: CANVAS_SCHEMA_VERSION,
    elements: {},
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const CURRENT_SCHEMA_VERSION = 1 as const

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
  bg: string | null
  border: string | null
}

export interface CanvasTextElement {
  type: 'text'
  x: number
  y: number
  w: number
  z: string
  rotation?: number
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
  schema: 1
  elements: Record<string, CanvasElement>
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

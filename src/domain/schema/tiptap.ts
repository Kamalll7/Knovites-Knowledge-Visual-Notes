import {
  HEX_COLOR_REGEX,
  ULID_REGEX,
  isAllowedTextAlign,
  isHighlightColorToken,
  isPlainObject,
  isTextColorToken,
  type CanvasJson,
  type SchemaIssue,
  type TipTapDoc,
  type TipTapMark,
  type TipTapNode,
} from '@/domain/schema/types'

export interface SanitizeTipTapOptions {
  /** When true (during v1 -> v2 migration), legacy `#rrggbb` mark colors record `migrated_legacy_hex_color`. */
  legacyV1HexMigration?: boolean
}

const SIMPLE_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code'])
const CONTAINER_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'blockquote',
])
const LEAF_NODES = new Set(['hardBreak', 'horizontalRule'])
const KNOVITES_HREF_REGEX = new RegExp(`^knovites:${ULID_REGEX.source.slice(1, -1)}$`)
const SAFE_FONT_FAMILY_REGEX = /^[a-zA-Z0-9\s,'"-]{1,120}$/
const SAFE_FONT_SIZE_REGEX = /^(\d{1,3}(?:\.\d{1,2})?)(?:px|rem|em)$/
const SAFE_CODE_LANGUAGE_REGEX = /^[a-zA-Z0-9_+#.-]{0,32}$/
const DANGEROUS_CSS_PATTERN =
  /(?:url\s*\(|expression\s*\(|javascript:|vbscript:|data:|@import|background)/i

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function isAllowedHref(href: string): boolean {
  if (href.length === 0 || href !== href.trim() || hasControlCharacter(href)) {
    return false
  }
  if (KNOVITES_HREF_REGEX.test(href)) {
    return true
  }
  try {
    const parsed = new URL(href)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname.length > 0
    }
    if (parsed.protocol === 'mailto:') {
      return parsed.pathname.trim().length > 0
    }
    return false
  } catch {
    return false
  }
}

function isSafeFontFamily(value: string): boolean {
  const trimmed = value.trim()
  return (
    trimmed.length > 0 &&
    !hasControlCharacter(value) &&
    !DANGEROUS_CSS_PATTERN.test(value) &&
    SAFE_FONT_FAMILY_REGEX.test(trimmed)
  )
}

function isSafeFontSize(value: string): boolean {
  if (value !== value.trim() || hasControlCharacter(value) || DANGEROUS_CSS_PATTERN.test(value)) {
    return false
  }
  const match = SAFE_FONT_SIZE_REGEX.exec(value)
  return Boolean(match?.[1] && Number.parseFloat(match[1]) > 0)
}

function recordExtraAttrs(
  attrs: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
  issues: SchemaIssue[],
): void {
  for (const key of Object.keys(attrs)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        code: 'disallowed_tiptap_attr',
        message: `Removed disallowed attribute "${key}".`,
      })
    }
  }
}

function sanitizeTextAlignAttr(
  rawAlign: unknown,
  path: string,
  issues: SchemaIssue[],
): 'center' | 'right' | undefined {
  if (rawAlign === undefined) return undefined
  if (isAllowedTextAlign(rawAlign)) return rawAlign === 'left' ? undefined : rawAlign
  issues.push({
    path,
    code: 'disallowed_text_align',
    message: 'Removed disallowed textAlign attribute (expected "left", "center", or "right").',
  })
  return undefined
}

function recordInvalidColor(
  color: unknown,
  markName: 'textStyle' | 'highlight',
  path: string,
  issues: SchemaIssue[],
  legacyV1Hex: boolean,
): void {
  if (legacyV1Hex && typeof color === 'string' && HEX_COLOR_REGEX.test(color)) {
    issues.push({
      path,
      code: 'migrated_legacy_hex_color',
      message: `Migrated legacy v1 hex ${markName} color "${color}" to Auto.`,
    })
  } else {
    issues.push({
      path,
      code: 'disallowed_tiptap_attr',
      message: `Removed invalid ${markName} color attribute (expected semantic token).`,
    })
  }
}

function sanitizeMark(
  rawMark: unknown,
  path: string,
  issues: SchemaIssue[],
  legacyV1Hex: boolean,
): TipTapMark | null {
  if (!isPlainObject(rawMark) || typeof rawMark['type'] !== 'string') {
    issues.push({
      path,
      code: 'disallowed_tiptap_mark',
      message: 'Removed malformed TipTap mark.',
    })
    return null
  }

  const markType = rawMark['type']
  const rawAttrs = rawMark['attrs']

  if (SIMPLE_MARKS.has(markType)) {
    if (rawAttrs !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: `Removed disallowed attributes on "${markType}" mark.`,
      })
    }
    return { type: markType as TipTapMark['type'] }
  }

  if (markType === 'link') {
    if (
      !isPlainObject(rawAttrs) ||
      typeof rawAttrs['href'] !== 'string' ||
      !isAllowedHref(rawAttrs['href'])
    ) {
      issues.push({
        path: `${path}.attrs.href`,
        code: 'disallowed_link_href',
        message: 'Removed link mark with disallowed or missing href scheme.',
      })
      return null
    }
    recordExtraAttrs(rawAttrs, new Set(['href']), `${path}.attrs`, issues)
    return {
      type: 'link',
      attrs: { href: rawAttrs['href'] },
    }
  }

  if (markType === 'textStyle') {
    const cleanAttrs: Record<string, string | null> = {}
    if (isPlainObject(rawAttrs)) {
      recordExtraAttrs(
        rawAttrs,
        new Set(['color', 'fontFamily', 'fontSize']),
        `${path}.attrs`,
        issues,
      )
      const color = rawAttrs['color']
      if (isTextColorToken(color)) {
        cleanAttrs['color'] = color
      } else if (color !== undefined && color !== null) {
        recordInvalidColor(color, 'textStyle', `${path}.attrs.color`, issues, legacyV1Hex)
      }

      const fontFamily = rawAttrs['fontFamily']
      if (typeof fontFamily === 'string' && isSafeFontFamily(fontFamily)) {
        cleanAttrs['fontFamily'] = fontFamily
      } else if (fontFamily !== undefined && fontFamily !== null) {
        issues.push({
          path: `${path}.attrs.fontFamily`,
          code: 'disallowed_tiptap_attr',
          message: 'Removed invalid or unsafe textStyle fontFamily attribute.',
        })
      }

      const fontSize = rawAttrs['fontSize']
      if (typeof fontSize === 'string' && isSafeFontSize(fontSize)) {
        cleanAttrs['fontSize'] = fontSize
      } else if (fontSize !== undefined && fontSize !== null) {
        issues.push({
          path: `${path}.attrs.fontSize`,
          code: 'disallowed_tiptap_attr',
          message: 'Removed invalid or unsafe textStyle fontSize attribute.',
        })
      }
    } else if (rawAttrs !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: 'Removed malformed attributes on textStyle mark.',
      })
    }

    return Object.keys(cleanAttrs).length > 0 ? { type: 'textStyle', attrs: cleanAttrs } : null
  }

  if (markType === 'highlight') {
    if (isPlainObject(rawAttrs)) {
      recordExtraAttrs(rawAttrs, new Set(['color']), `${path}.attrs`, issues)
      const color = rawAttrs['color']
      if (isHighlightColorToken(color)) {
        return { type: 'highlight', attrs: { color } }
      }
      if (color !== undefined && color !== null) {
        recordInvalidColor(color, 'highlight', `${path}.attrs.color`, issues, legacyV1Hex)
      }
    } else if (rawAttrs !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: 'Removed malformed attributes on highlight mark.',
      })
    }

    return null
  }

  issues.push({
    path,
    code: 'disallowed_tiptap_mark',
    message: `Removed disallowed TipTap mark "${markType}".`,
  })
  return null
}

function sanitizeMarks(
  rawMarks: unknown,
  path: string,
  issues: SchemaIssue[],
  legacyV1Hex: boolean,
): TipTapMark[] | undefined {
  if (rawMarks === undefined) return undefined
  if (!Array.isArray(rawMarks)) {
    issues.push({
      path,
      code: 'disallowed_tiptap_mark',
      message: 'Removed non-array TipTap marks.',
    })
    return undefined
  }
  const cleanMarks: TipTapMark[] = []
  for (let i = 0; i < rawMarks.length; i += 1) {
    const clean = sanitizeMark(rawMarks[i], `${path}[${i}]`, issues, legacyV1Hex)
    if (clean) {
      cleanMarks.push(clean)
    }
  }
  return cleanMarks.length > 0 ? cleanMarks : undefined
}

function sanitizeNodeContent(
  rawContent: unknown,
  path: string,
  issues: SchemaIssue[],
  legacyV1Hex: boolean,
): TipTapNode[] | undefined {
  if (rawContent === undefined) return undefined
  if (!Array.isArray(rawContent)) {
    issues.push({
      path,
      code: 'disallowed_tiptap_node',
      message: 'Removed non-array TipTap node content.',
    })
    return undefined
  }
  const cleanNodes: TipTapNode[] = []
  for (let i = 0; i < rawContent.length; i += 1) {
    const clean = sanitizeChildNode(rawContent[i], `${path}[${i}]`, issues, legacyV1Hex)
    if (clean) {
      cleanNodes.push(clean)
    }
  }
  return cleanNodes
}

function sanitizeChildNode(
  rawNode: unknown,
  path: string,
  issues: SchemaIssue[],
  legacyV1Hex: boolean,
): TipTapNode | null {
  if (!isPlainObject(rawNode) || typeof rawNode['type'] !== 'string') {
    issues.push({
      path,
      code: 'disallowed_tiptap_node',
      message: 'Removed malformed TipTap node.',
    })
    return null
  }

  const nodeType = rawNode['type']

  if (nodeType === 'text') {
    if (typeof rawNode['text'] !== 'string') {
      issues.push({
        path,
        code: 'invalid_text_node',
        message: 'Removed TipTap text node missing string text.',
      })
      return null
    }
    if (rawNode['attrs'] !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: 'Removed disallowed attributes on text node.',
      })
    }
    if (rawNode['content'] !== undefined) {
      issues.push({
        path: `${path}.content`,
        code: 'disallowed_tiptap_node',
        message: 'Removed disallowed child content on text node.',
      })
    }
    const marks = sanitizeMarks(rawNode['marks'], `${path}.marks`, issues, legacyV1Hex)
    const node: TipTapNode = { type: 'text', text: rawNode['text'] }
    if (marks) {
      node.marks = marks
    }
    return node
  }

  if (rawNode['marks'] !== undefined) {
    issues.push({
      path: `${path}.marks`,
      code: 'disallowed_tiptap_mark',
      message: `Removed disallowed marks on "${nodeType}" node.`,
    })
  }

  if (LEAF_NODES.has(nodeType)) {
    if (rawNode['attrs'] !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: `Removed disallowed attributes on "${nodeType}" node.`,
      })
    }
    if (rawNode['content'] !== undefined) {
      issues.push({
        path: `${path}.content`,
        code: 'disallowed_tiptap_node',
        message: `Removed disallowed child content on "${nodeType}" node.`,
      })
    }
    return { type: nodeType as TipTapNode['type'] }
  }

  if (!CONTAINER_NODES.has(nodeType)) {
    issues.push({
      path,
      code: 'disallowed_tiptap_node',
      message: `Removed disallowed TipTap node "${nodeType}".`,
    })
    return null
  }

  const cleanNode: TipTapNode = { type: nodeType as TipTapNode['type'] }

  if (nodeType === 'paragraph') {
    const rawAttrs = rawNode['attrs']
    if (isPlainObject(rawAttrs)) {
      recordExtraAttrs(rawAttrs, new Set(['textAlign']), `${path}.attrs`, issues)
      const textAlign = sanitizeTextAlignAttr(
        rawAttrs['textAlign'],
        `${path}.attrs.textAlign`,
        issues,
      )
      if (textAlign !== undefined) {
        cleanNode.attrs = { textAlign }
      }
    } else if (rawAttrs !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: 'Removed malformed attributes on paragraph node.',
      })
    }
  } else if (nodeType === 'heading') {
    const rawAttrs = rawNode['attrs']
    const level = isPlainObject(rawAttrs) ? rawAttrs['level'] : undefined
    if (level !== 1 && level !== 2 && level !== 3) {
      issues.push({
        path: `${path}.attrs.level`,
        code: 'invalid_heading_level',
        message: 'Removed heading node with level outside 1..3.',
      })
      return null
    }
    recordExtraAttrs(
      rawAttrs as Record<string, unknown>,
      new Set(['level', 'textAlign']),
      `${path}.attrs`,
      issues,
    )
    const attrs: Record<string, string | number | null> = { level }
    const textAlign = sanitizeTextAlignAttr(
      (rawAttrs as Record<string, unknown>)['textAlign'],
      `${path}.attrs.textAlign`,
      issues,
    )
    if (textAlign !== undefined) {
      attrs['textAlign'] = textAlign
    }
    cleanNode.attrs = attrs
  } else if (nodeType === 'codeBlock') {
    const rawAttrs = rawNode['attrs']
    if (isPlainObject(rawAttrs)) {
      recordExtraAttrs(rawAttrs, new Set(['language']), `${path}.attrs`, issues)
      const language = rawAttrs['language']
      if (
        language === null ||
        (typeof language === 'string' && SAFE_CODE_LANGUAGE_REGEX.test(language))
      ) {
        cleanNode.attrs = { language }
      } else if (language !== undefined) {
        issues.push({
          path: `${path}.attrs.language`,
          code: 'disallowed_tiptap_attr',
          message: 'Removed invalid codeBlock language attribute.',
        })
      }
    } else if (rawAttrs !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: 'Removed malformed attributes on codeBlock node.',
      })
    }
  } else if (rawNode['attrs'] !== undefined) {
    issues.push({
      path: `${path}.attrs`,
      code: 'disallowed_tiptap_attr',
      message: `Removed disallowed attributes on "${nodeType}" node.`,
    })
  }

  const content = sanitizeNodeContent(rawNode['content'], `${path}.content`, issues, legacyV1Hex)
  if (content !== undefined) {
    cleanNode.content = content
  }

  return cleanNode
}

export function sanitizeTipTapDoc(
  rawDoc: Record<string, unknown>,
  basePath: string,
  issues: SchemaIssue[],
  options: SanitizeTipTapOptions = {},
): TipTapDoc {
  if (rawDoc['attrs'] !== undefined) {
    issues.push({
      path: `${basePath}.attrs`,
      code: 'disallowed_tiptap_attr',
      message: 'Removed disallowed attributes on doc root.',
    })
  }
  if (rawDoc['marks'] !== undefined) {
    issues.push({
      path: `${basePath}.marks`,
      code: 'disallowed_tiptap_mark',
      message: 'Removed disallowed marks on doc root.',
    })
  }

  const cleanDoc: TipTapDoc = { type: 'doc' }
  const content = sanitizeNodeContent(
    rawDoc['content'],
    `${basePath}.content`,
    issues,
    Boolean(options.legacyV1HexMigration),
  )
  if (content !== undefined) {
    cleanDoc.content = content
  }
  return cleanDoc
}

export function sanitizeEditorContent(rawDoc: unknown): {
  doc: TipTapDoc
  issues: SchemaIssue[]
} {
  const issues: SchemaIssue[] = []
  if (!isPlainObject(rawDoc) || rawDoc['type'] !== 'doc') {
    issues.push({
      path: 'content',
      code: 'disallowed_tiptap_node',
      message: 'Expected TipTap root node with type "doc".',
    })
    return { doc: { type: 'doc', content: [] }, issues }
  }
  return {
    doc: sanitizeTipTapDoc(rawDoc, 'content', issues),
    issues,
  }
}

const KNOVITES_HREF_PREFIX = 'knovites:'

/**
 * Extracts unique target node ULIDs referenced by `knovites:<ulid>` link marks in a TipTap doc
 * (`docs/data-format.md` §5.4, `FR-MAP-16`). Pure, iterative, preserves first-seen order.
 */
export function extractKnovitesLinkTargetsFromDoc(doc: TipTapDoc | null | undefined): string[] {
  if (!doc || !Array.isArray(doc.content) || doc.content.length === 0) return []
  const seen = new Set<string>()
  const targets: string[] = []
  const stack: TipTapNode[] = []
  for (let i = doc.content.length - 1; i >= 0; i -= 1) {
    stack.push(doc.content[i]!)
  }
  while (stack.length > 0) {
    const node = stack.pop()!
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark.type !== 'link') continue
        const href = mark.attrs?.['href']
        if (typeof href === 'string' && KNOVITES_HREF_REGEX.test(href)) {
          const targetId = href.slice(KNOVITES_HREF_PREFIX.length)
          if (!seen.has(targetId)) {
            seen.add(targetId)
            targets.push(targetId)
          }
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (let i = node.content.length - 1; i >= 0; i -= 1) {
        stack.push(node.content[i]!)
      }
    }
  }
  return targets
}

/**
 * Extracts unique `knovites:<ulid>` link targets across all text elements of a `CanvasJson` doc.
 */
export function extractKnovitesLinkTargetsFromCanvas(doc: CanvasJson | null | undefined): string[] {
  if (!doc || !isPlainObject(doc.elements)) return []
  const seen = new Set<string>()
  const targets: string[] = []
  for (const element of Object.values(doc.elements)) {
    if (element.type !== 'text') continue
    for (const id of extractKnovitesLinkTargetsFromDoc(element.content)) {
      if (!seen.has(id)) {
        seen.add(id)
        targets.push(id)
      }
    }
  }
  return targets
}

import {
  HEX_COLOR_REGEX,
  ULID_REGEX,
  isPlainObject,
  type SchemaIssue,
  type TipTapDoc,
  type TipTapMark,
  type TipTapNode,
} from '@/domain/schema/types'

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

function isAllowedHref(href: string): boolean {
  if (KNOVITES_HREF_REGEX.test(href)) {
    return true
  }
  try {
    const parsed = new URL(href)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname.length > 0
    }
    if (parsed.protocol === 'mailto:') {
      return href.slice('mailto:'.length).trim().length > 0
    }
    return false
  } catch {
    return false
  }
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

function sanitizeMark(rawMark: unknown, path: string, issues: SchemaIssue[]): TipTapMark | null {
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
      if (color === null || (typeof color === 'string' && HEX_COLOR_REGEX.test(color))) {
        cleanAttrs['color'] = color
      } else if (color !== undefined) {
        issues.push({
          path: `${path}.attrs.color`,
          code: 'disallowed_tiptap_attr',
          message: 'Removed invalid textStyle color attribute.',
        })
      }

      for (const strKey of ['fontFamily', 'fontSize'] as const) {
        const val = rawAttrs[strKey]
        if (val === null || (typeof val === 'string' && val.length > 0)) {
          cleanAttrs[strKey] = val
        } else if (val !== undefined) {
          issues.push({
            path: `${path}.attrs.${strKey}`,
            code: 'disallowed_tiptap_attr',
            message: `Removed invalid textStyle ${strKey} attribute.`,
          })
        }
      }
    } else if (rawAttrs !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: 'Removed malformed attributes on textStyle mark.',
      })
    }

    return Object.keys(cleanAttrs).length > 0
      ? { type: 'textStyle', attrs: cleanAttrs }
      : { type: 'textStyle' }
  }

  if (markType === 'highlight') {
    const cleanAttrs: Record<string, string | null> = {}
    if (isPlainObject(rawAttrs)) {
      recordExtraAttrs(rawAttrs, new Set(['color']), `${path}.attrs`, issues)
      const color = rawAttrs['color']
      if (color === null || (typeof color === 'string' && HEX_COLOR_REGEX.test(color))) {
        cleanAttrs['color'] = color
      } else if (color !== undefined) {
        issues.push({
          path: `${path}.attrs.color`,
          code: 'disallowed_tiptap_attr',
          message: 'Removed invalid highlight color attribute.',
        })
      }
    } else if (rawAttrs !== undefined) {
      issues.push({
        path: `${path}.attrs`,
        code: 'disallowed_tiptap_attr',
        message: 'Removed malformed attributes on highlight mark.',
      })
    }

    return Object.keys(cleanAttrs).length > 0
      ? { type: 'highlight', attrs: cleanAttrs }
      : { type: 'highlight' }
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
    const clean = sanitizeMark(rawMarks[i], `${path}[${i}]`, issues)
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
    const clean = sanitizeChildNode(rawContent[i], `${path}[${i}]`, issues)
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
    const marks = sanitizeMarks(rawNode['marks'], `${path}.marks`, issues)
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

  if (nodeType === 'heading') {
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
      new Set(['level']),
      `${path}.attrs`,
      issues,
    )
    cleanNode.attrs = { level }
  } else if (nodeType === 'codeBlock') {
    const rawAttrs = rawNode['attrs']
    if (isPlainObject(rawAttrs)) {
      recordExtraAttrs(rawAttrs, new Set(['language']), `${path}.attrs`, issues)
      const language = rawAttrs['language']
      if (language === null || typeof language === 'string') {
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

  const content = sanitizeNodeContent(rawNode['content'], `${path}.content`, issues)
  if (content !== undefined) {
    cleanNode.content = content
  }

  return cleanNode
}

export function sanitizeTipTapDoc(
  rawDoc: Record<string, unknown>,
  basePath: string,
  issues: SchemaIssue[],
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
  const content = sanitizeNodeContent(rawDoc['content'], `${basePath}.content`, issues)
  if (content !== undefined) {
    cleanDoc.content = content
  }
  return cleanDoc
}

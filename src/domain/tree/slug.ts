import { FORBIDDEN_SLUGS } from '@/domain/tree/types'

const MAX_SLUG_LENGTH = 48

export function slugify(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const dashed = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')

  if (dashed.length === 0 || FORBIDDEN_SLUGS.has(dashed)) {
    return 'node'
  }
  return dashed
}

export function resolveUniqueSlug(
  baseSlug: string,
  existingSiblingSlugs: Iterable<string>,
): string {
  const taken = new Set(existingSiblingSlugs)
  const cleanBase = baseSlug.length === 0 || FORBIDDEN_SLUGS.has(baseSlug) ? 'node' : baseSlug

  if (!taken.has(cleanBase)) {
    return cleanBase
  }

  let suffix = 2
  while (true) {
    const candidate = `${cleanBase}-${suffix}`
    if (!taken.has(candidate) && !FORBIDDEN_SLUGS.has(candidate)) {
      return candidate
    }
    suffix += 1
  }
}

export function deriveNodePath(parentPath: string | null, slug: string): string {
  return parentPath === null || parentPath.length === 0 ? slug : `${parentPath}/${slug}`
}

export function normalizeFolderPath(rawPath: string): string {
  let trimmed = rawPath.replace(/^\/+|\/+$/g, '')
  if (trimmed === 'node.json') {
    return ''
  }
  if (trimmed.endsWith('/node.json')) {
    trimmed = trimmed.slice(0, -'/node.json'.length)
  }
  return trimmed
}

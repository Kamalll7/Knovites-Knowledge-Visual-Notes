import { ASSETS_DIR, CANVAS_FILE, NODE_META_FILE } from '@/domain/schema'

/**
 * Normalizes a repo-relative path so it never carries leading `./`, leading `/`,
 * trailing `/`, or duplicate slashes. Preserves dotfiles like `.gitignore`.
 */
export function normalizeRepoRelativePath(rawPath: string): string {
  return rawPath
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

/**
 * Checks whether a repository file path is valid for Git Data API:
 * non-empty, no leading/trailing slash, no empty/dot/parent segments.
 */
export function isValidRepoFilePath(filePath: string): boolean {
  if (filePath.length === 0 || filePath.startsWith('/') || filePath.endsWith('/')) {
    return false
  }
  if (filePath.includes('//')) {
    return false
  }
  const segments = filePath.split('/')
  return segments.every((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
}

/**
 * Resolves `<nodePath>/node.json` for a regular node.
 * Rejects empty path because virtual root `'__root__'` has no `node.json`.
 */
export function resolveNodeFilePath(nodePath: string): string {
  const clean = normalizeRepoRelativePath(nodePath)
  if (clean.length === 0) {
    throw new Error('Virtual root "__root__" does not have a node.json file.')
  }
  return `${clean}/${NODE_META_FILE}`
}

/**
 * Resolves `canvas.json` for virtual root (`nodePath === ''`) or `<nodePath>/canvas.json`
 * for a regular node. Never produces a leading slash.
 */
export function resolveCanvasFilePath(nodePath: string): string {
  const clean = normalizeRepoRelativePath(nodePath)
  return clean.length === 0 ? CANVAS_FILE : `${clean}/${CANVAS_FILE}`
}

/**
 * Normalizes an asset path relative to its owner folder into `assets/<file>`.
 */
export function normalizeAssetRelativePath(assetRelativePath: string): string {
  const clean = normalizeRepoRelativePath(assetRelativePath)
  if (clean.length === 0 || clean === ASSETS_DIR) {
    throw new Error('Asset relative path must include a filename.')
  }
  return clean.startsWith(`${ASSETS_DIR}/`) ? clean : `${ASSETS_DIR}/${clean}`
}

/**
 * Resolves an asset path relative to the repo root without any leading slash:
 * - virtual root (`ownerPath === ''`) -> `'assets/<file>'`
 * - regular node (`ownerPath === 'pwn/rop'`) -> `'pwn/rop/assets/<file>'`
 */
export function resolveAssetFilePath(ownerPath: string, assetRelativePath: string): string {
  const cleanOwner = normalizeRepoRelativePath(ownerPath)
  const cleanAsset = normalizeAssetRelativePath(assetRelativePath)
  return cleanOwner.length === 0 ? cleanAsset : `${cleanOwner}/${cleanAsset}`
}

/**
 * Resolves an unknown/user extra file path relative to the repo root without any leading slash:
 * - virtual root (`ownerPath === ''`) -> `'README.md'`
 * - regular node (`ownerPath === 'pwn'`) -> `'pwn/exploit.py'`
 */
export function resolveExtraFilePath(ownerPath: string, relativePath: string): string {
  const cleanOwner = normalizeRepoRelativePath(ownerPath)
  const cleanRel = normalizeRepoRelativePath(relativePath)
  if (cleanRel.length === 0) {
    throw new Error('Extra file relative path must be non-empty.')
  }
  return cleanOwner.length === 0 ? cleanRel : `${cleanOwner}/${cleanRel}`
}

/**
 * Parses a strict repo-relative `node.json` path (rejecting root `'node.json'` and leading `'/'`).
 */
export function parseNodeFilePath(filePath: string): string | null {
  if (!isValidRepoFilePath(filePath)) {
    return null
  }
  const suffix = `/${NODE_META_FILE}`
  if (!filePath.endsWith(suffix)) {
    return null
  }
  const ownerPath = filePath.slice(0, -suffix.length)
  return ownerPath.length > 0 ? ownerPath : null
}

/**
 * Parses a strict repo-relative `canvas.json` path (rejecting leading `'/'`).
 * Recognizes `'canvas.json'` as virtual root (`{ isRoot: true, ownerPath: '' }`)
 * and `'<ownerPath>/canvas.json'` as a regular node canvas.
 */
export function parseCanvasFilePath(
  filePath: string,
): { isRoot: boolean; ownerPath: string } | null {
  if (!isValidRepoFilePath(filePath)) {
    return null
  }
  if (filePath === CANVAS_FILE) {
    return { isRoot: true, ownerPath: '' }
  }
  const suffix = `/${CANVAS_FILE}`
  if (!filePath.endsWith(suffix)) {
    return null
  }
  const ownerPath = filePath.slice(0, -suffix.length)
  return ownerPath.length > 0 ? { isRoot: false, ownerPath } : null
}

/**
 * Returns true if `filePath` is a valid repo-relative asset path belonging directly to
 * virtual root `'__root__'` (`'assets/<file>'`, without leading slash or traversal).
 */
export function isRootAssetFilePath(filePath: string): boolean {
  if (!isValidRepoFilePath(filePath)) {
    return false
  }
  return filePath.startsWith(`${ASSETS_DIR}/`) && filePath.length > ASSETS_DIR.length + 1
}

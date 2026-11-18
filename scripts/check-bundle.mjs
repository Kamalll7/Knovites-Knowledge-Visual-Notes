import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const distDir = path.resolve(import.meta.dirname, '../dist')
const indexHtmlPath = path.join(distDir, 'index.html')
const assetsDir = path.join(distDir, 'assets')

const INITIAL_BUDGET_BYTES = 600 * 1024 // 600 KB gzip (spec-ui-nfr.md §7.1)
const LAZY_CHUNK_BUDGET_BYTES = 500 * 1024 // 500 KB gzip per lazy route chunk

if (!fs.existsSync(indexHtmlPath)) {
  console.error('dist/index.html not found. Run `pnpm build` first.')
  process.exit(1)
}

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8')
const initialAssetRefs = new Set()
const refPattern = /(?:src|href)=["']\/?(assets\/[^"']+\.(?:js|css))["']/g
for (const match of indexHtml.matchAll(refPattern)) {
  initialAssetRefs.add(match[1])
}

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath)
  return zlib.gzipSync(buf, { level: 9 }).length
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`
}

let initialTotalBytes = 0
const lazyChunks = []

if (fs.existsSync(assetsDir)) {
  for (const entry of fs.readdirSync(assetsDir)) {
    if (!entry.endsWith('.js') && !entry.endsWith('.css')) continue
    const rel = `assets/${entry}`
    const size = gzipSize(path.join(assetsDir, entry))
    if (initialAssetRefs.has(rel)) {
      initialTotalBytes += size
      console.log(`[initial] ${rel}: ${formatKb(size)} gzip`)
    } else {
      lazyChunks.push({ rel, size })
      console.log(`[lazy]    ${rel}: ${formatKb(size)} gzip`)
    }
  }
}

console.log(
  `Initial bundle total: ${formatKb(initialTotalBytes)} / ${formatKb(INITIAL_BUDGET_BYTES)} gzip`,
)

let failed = false
if (initialTotalBytes === 0) {
  console.error('No initial JS/CSS assets found in dist/index.html.')
  failed = true
}
if (initialTotalBytes > INITIAL_BUDGET_BYTES) {
  console.error(
    `Initial bundle exceeds 600 KB gzip budget (${formatKb(initialTotalBytes)} > ${formatKb(INITIAL_BUDGET_BYTES)}).`,
  )
  failed = true
}
for (const chunk of lazyChunks) {
  if (chunk.size > LAZY_CHUNK_BUDGET_BYTES) {
    console.error(
      `Lazy chunk ${chunk.rel} exceeds 500 KB gzip budget (${formatKb(chunk.size)} > ${formatKb(LAZY_CHUNK_BUDGET_BYTES)}).`,
    )
    failed = true
  }
}

if (failed) {
  process.exit(1)
}
console.log('Bundle size check passed.')

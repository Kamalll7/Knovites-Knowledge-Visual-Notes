import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { build } from 'vite'

const spikeDir = import.meta.dirname

async function measureEntry(name, entryCode) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `s1-bundle-${name}-`))
  const outDir = path.join(tmpDir, 'dist')
  const entryPath = path.join(spikeDir, `.tmp-${name}.ts`)
  fs.writeFileSync(entryPath, entryCode, 'utf8')

  try {
    await build({
      root: spikeDir,
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
        write: true,
        lib: {
          entry: entryPath,
          formats: ['es'],
          fileName: () => `${name}.js`,
        },
      },
    })

    const jsFiles = fs.readdirSync(outDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
    let rawBytes = 0
    let gzipBytes = 0
    for (const file of jsFiles) {
      const content = fs.readFileSync(path.join(outDir, file))
      rawBytes += content.byteLength
      gzipBytes += zlib.gzipSync(content, { level: 9 }).byteLength
    }
    return {
      name,
      files: jsFiles,
      rawBytes,
      rawKb: Number((rawBytes / 1024).toFixed(2)),
      gzipBytes,
      gzipKb: Number((gzipBytes / 1024).toFixed(2)),
    }
  } finally {
    fs.rmSync(entryPath, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

const results = []
results.push(
  await measureEntry(
    'thin-fetch',
    `export { ThinGitHubFetchClient } from './fetch-client.ts'\nexport { RateGuard } from './rate-guard.ts'\nexport { planGitTreeMutations } from './planner.ts'\nexport { computeGitBlobSha1 } from './sha1.ts'\n`,
  ),
)
results.push(
  await measureEntry(
    'octokit-client',
    `export { OctokitSpikeClient } from './octokit-client.ts'\n`,
  ),
)
results.push(await measureEntry('octokit-named-octokit', `export { Octokit } from 'octokit'\n`))

console.log(JSON.stringify(results, null, 2))

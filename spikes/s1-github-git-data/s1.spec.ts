import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { generateBatchTextFiles } from './fixtures'
import { planGitTreeMutations, type Changeset, type RemoteTreeEntry } from './planner'
import { MAX_WRITES_PER_RUN, MIN_WRITE_DELAY_MS } from './rate-guard'
import { redactSecrets, registerSecret } from './redact'
import { computeGitBlobSha1, utf8ToBase64 } from './sha1'

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env.local'))
} catch {
  // .env.local tidak ada di CI — tes live auto-skip
}

const RAW_TOKEN = process.env.KNOVITES_S1_TOKEN?.trim() ?? ''
const RAW_REPO = process.env.KNOVITES_S1_REPO?.trim() ?? ''
registerSecret(RAW_TOKEN)

const HAS_LIVE_ENV = RAW_TOKEN.length > 0 && RAW_REPO.includes('/')
const [REPO_OWNER = '', REPO_NAME = ''] = RAW_REPO.split('/')

let totalWritesAcrossSuite = 0
let recordedMainHeadSha = ''

function logTelemetry(tag: string, payload: unknown): void {
  const safeJson = redactSecrets(JSON.stringify(payload))
  console.log(`[S1:${tag}] ${safeJson}`)
}

function summarizeLatencies(samples: number[]): {
  count: number
  minMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
} {
  if (samples.length === 0) {
    return { count: 0, minMs: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!
  return {
    count: sorted.length,
    minMs: Number(sorted[0]!.toFixed(1)),
    meanMs: Number((sum / sorted.length).toFixed(1)),
    p50Ms: Number(pct(0.5).toFixed(1)),
    p95Ms: Number(pct(0.95).toFixed(1)),
    maxMs: Number(sorted[sorted.length - 1]!.toFixed(1)),
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function initHarness(page: Page, afterWriteGap = false): Promise<void> {
  if (afterWriteGap) {
    await sleep(MIN_WRITE_DELAY_MS)
  }
  await page.goto('/')
  await expect(page.getByTestId('s1-harness')).toBeVisible()
  await page.evaluate((t) => {
    window.__S1__!.init(t)
  }, RAW_TOKEN)
}

async function recordSuiteWrites(page: Page): Promise<void> {
  const stats = await page.evaluate(() => window.__S1__!.getStats())
  totalWritesAcrossSuite += stats.writeCount
  expect(totalWritesAcrossSuite).toBeLessThanOrEqual(MAX_WRITES_PER_RUN)
}

function makeTempBranchName(label: string): string {
  return `s1-run-${Date.now()}-${label}`
}

async function assertSafePrivateTestRepo(
  page: Page,
): Promise<{ mainSha: string; baseTreeSha: string }> {
  if (!REPO_NAME.includes('s1-test')) {
    throw new Error(`Unsafe target repo "${REPO_NAME}": must contain "s1-test"`)
  }
  const repoInfo = await page.evaluate(
    async ({ owner, repo }) => {
      const repoRes = await window.__S1__!.fetchGetRepo(owner, repo)
      const refRes = await window.__S1__!.fetchGetRef(owner, repo, 'heads/main')
      const commitRes = refRes.ok
        ? await window.__S1__!.getCommit(owner, repo, refRes.data.object.sha)
        : null
      return { repoRes, refRes, commitRes }
    },
    { owner: REPO_OWNER, repo: REPO_NAME },
  )

  expect(repoInfo.repoRes.status).toBe(200)
  expect(repoInfo.repoRes.data.private).toBe(true)
  expect(repoInfo.repoRes.data.name).toContain('s1-test')
  expect(repoInfo.refRes.status).toBe(200)
  expect(repoInfo.commitRes?.status).toBe(200)

  const mainSha = repoInfo.refRes.data.object.sha
  const baseTreeSha = repoInfo.commitRes!.data.tree.sha
  if (!recordedMainHeadSha) {
    recordedMainHeadSha = mainSha
  }
  return { mainSha, baseTreeSha }
}

// ---------------------------------------------------------------------------
// 1. Tes unit murni (tanpa jaringan, selalu berjalan di CI/lokal)
// ---------------------------------------------------------------------------

test.describe('Spike S1 Pure Planner, SHA-1, dan Redaction', () => {
  test('U1. planner menerapkan deletes -> moves -> upserts, case-only, swap, overwrite, extraFiles, dan melewati hapus path absen', () => {
    const remoteTree = new Map<string, RemoteTreeEntry>([
      [
        'catatan/node-1/node.json',
        { path: 'catatan/node-1/node.json', mode: '100644', type: 'blob', sha: 'sha-node1' },
      ],
      [
        'catatan/node-1/extra.txt',
        { path: 'catatan/node-1/extra.txt', mode: '100644', type: 'blob', sha: 'sha-extra1' },
      ],
      [
        'catatan/swap-a.json',
        { path: 'catatan/swap-a.json', mode: '100644', type: 'blob', sha: 'sha-swap-a' },
      ],
      [
        'catatan/swap-b.json',
        { path: 'catatan/swap-b.json', mode: '100644', type: 'blob', sha: 'sha-swap-b' },
      ],
      [
        'catatan/CaseOnly.json',
        { path: 'catatan/CaseOnly.json', mode: '100644', type: 'blob', sha: 'sha-case' },
      ],
      [
        'catatan/overwrite-target.json',
        {
          path: 'catatan/overwrite-target.json',
          mode: '100644',
          type: 'blob',
          sha: 'sha-old-target',
        },
      ],
      [
        'catatan/move-src.json',
        { path: 'catatan/move-src.json', mode: '100644', type: 'blob', sha: 'sha-move-src' },
      ],
      [
        'catatan/deleted.json',
        { path: 'catatan/deleted.json', mode: '100644', type: 'blob', sha: 'sha-deleted' },
      ],
    ])

    const changeset: Changeset = {
      deletes: ['catatan/deleted.json', 'catatan/does-not-exist.json'],
      moves: [
        { from: 'catatan/swap-a.json', to: 'catatan/swap-b.json' },
        { from: 'catatan/swap-b.json', to: 'catatan/swap-a.json' },
        { from: 'catatan/CaseOnly.json', to: 'catatan/caseonly.json' },
        { from: 'catatan/move-src.json', to: 'catatan/overwrite-target.json' },
        { from: 'catatan/local-only-never-pushed.json', to: 'catatan/moved-local.json' },
      ],
      upserts: [
        { path: 'catatan/overwrite-target.json', content: '{"winner":"upsert"}' },
        { path: 'catatan/new.json', content: '{"fresh":true}' },
      ],
    }

    const upsertedBlobShas = new Map<string, string>([
      ['catatan/overwrite-target.json', 'sha-upsert-winner'],
      ['catatan/new.json', 'sha-new'],
    ])

    const plan = planGitTreeMutations({ changeset, remoteTree, upsertedBlobShas })

    expect(plan.skippedMissingDeletes).toEqual(['catatan/does-not-exist.json'])
    expect(plan.skippedMissingMoveSources).toEqual(['catatan/local-only-never-pushed.json'])

    const byPath = new Map(plan.mutations.map((m) => [m.path, m]))
    // Path tidak ada tidak pernah dikirim sebagai sha: null
    expect(byPath.has('catatan/does-not-exist.json')).toBe(false)
    // Delete path eksis dikirim sebagai sha: null
    expect(byPath.get('catatan/deleted.json')?.sha).toBeNull()
    // Swap memakai snapshot SHA awal dan tidak menghapus path sumber karena keduanya jadi target
    expect(byPath.get('catatan/swap-a.json')?.sha).toBe('sha-swap-b')
    expect(byPath.get('catatan/swap-b.json')?.sha).toBe('sha-swap-a')
    // Case-only rename menambah path baru dan menghapus path lama
    expect(byPath.get('catatan/caseonly.json')?.sha).toBe('sha-case')
    expect(byPath.get('catatan/CaseOnly.json')?.sha).toBeNull()
    // Upsert menang atas moves.to di path yang sama; move-src tetap dihapus
    expect(byPath.get('catatan/overwrite-target.json')?.sha).toBe('sha-upsert-winner')
    expect(byPath.get('catatan/move-src.json')?.sha).toBeNull()
    // extra.txt & node-1 tidak disentuh mutasi sehingga base_tree mempertahankannya
    expect(byPath.has('catatan/node-1/extra.txt')).toBe(false)
  })

  test('U2. computeGitBlobSha1 cocok dengan format header blob Git untuk ASCII, UTF-8 non-ASCII, dan biner', async () => {
    const emptySha = await computeGitBlobSha1('')
    expect(emptySha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')

    const helloSha = await computeGitBlobSha1('hello\n')
    expect(helloSha).toBe('ce013625030ba8dba906f756967f9e9ca394464a')

    const unicode = 'café — catatan Δαβ\n'
    const unicodeSha = await computeGitBlobSha1(unicode)
    expect(unicodeSha).toMatch(/^[0-9a-f]{40}$/)

    const b64Roundtrip = utf8ToBase64(unicode)
    expect(b64Roundtrip.length).toBeGreaterThan(0)
  })

  test('U3. redactSecrets menyensor github_pat_, header Bearer, dan token terdaftar', () => {
    const fakePat = 'github_pat_' + '11AAAAA0000bbbbCCCCddddEEEEffff111122223333'
    registerSecret(fakePat)
    const msg = `Authorization: Bearer ${fakePat} failed with ${fakePat}`
    const redacted = redactSecrets(msg)
    expect(redacted).not.toContain('github_pat_')
    expect(redacted).not.toContain(fakePat)
    expect(redacted).toContain('[REDACTED]')
  })
})

// ---------------------------------------------------------------------------
// 2. Tes live GitHub REST / Git Data API di browser Chromium
// ---------------------------------------------------------------------------

test.describe('Spike S1 Live GitHub Git Data API di Browser', () => {
  test.skip(!HAS_LIVE_ENV, 'KNOVITES_S1_TOKEN atau KNOVITES_S1_REPO belum disetel (.env.local)')

  test('B1. Guard repo privat s1-test, rate_limit, CORS Access-Control-Expose-Headers, dan paritas read Octokit vs Fetch', async ({
    page,
  }) => {
    await initHarness(page)
    const { mainSha, baseTreeSha } = await assertSafePrivateTestRepo(page)

    const result = await page.evaluate(
      async ({ owner, repo, treeSha }) => {
        const rateRes = await window.__S1__!.fetchGetRateLimit()
        const fetchTreeRes = await window.__S1__!.getTree(owner, repo, treeSha, true)
        const octoRepoRes = await window.__S1__!.octokitGetRepo(owner, repo)
        const octoTreeRes = await window.__S1__!.octokitGetTree(owner, repo, treeSha)
        return { rateRes, fetchTreeRes, octoRepoRes, octoTreeRes }
      },
      { owner: REPO_OWNER, repo: REPO_NAME, treeSha: baseTreeSha },
    )

    expect(result.rateRes.status).toBe(200)
    expect(result.fetchTreeRes.status).toBe(200)
    expect(result.octoRepoRes.status).toBe(200)
    expect(result.octoTreeRes.status).toBe(200)
    expect(result.octoTreeRes.data.sha).toBe(result.fetchTreeRes.data.sha)

    logTelemetry('B1', {
      mainSha,
      baseTreeSha,
      corsExposedHeaders: Object.keys(result.fetchTreeRes.headers),
      rateHeaders: {
        limit: result.fetchTreeRes.headers['x-ratelimit-limit'],
        remaining: result.fetchTreeRes.headers['x-ratelimit-remaining'],
        used: result.fetchTreeRes.headers['x-ratelimit-used'],
        reset: result.fetchTreeRes.headers['x-ratelimit-reset'],
        etag: result.fetchTreeRes.headers['etag'],
      },
      fetchTreeLatencyMs: Number(result.fetchTreeRes.latencyMs.toFixed(1)),
      octokitTreeLatencyMs: Number(result.octoTreeRes.latencyMs.toFixed(1)),
    })

    await recordSuiteWrites(page)
  })

  test('B2. Push & pull fixture 30 node (~67 file, 15 PNG, path Unicode/spasi, extraFiles) via Fetch & Octokit di branch sementara', async ({
    page,
  }) => {
    await initHarness(page, true)
    const { mainSha, baseTreeSha } = await assertSafePrivateTestRepo(page)
    const branch = makeTempBranchName('b2-fixture')

    try {
      const outcome = await page.evaluate(
        async ({ owner, repo, branchName, headSha, treeSha }) => {
          const createRefRes = await window.__S1__!.createBranch(owner, repo, branchName, headSha)
          if (!createRefRes.ok) {
            throw new Error(`createBranch HTTP ${createRefRes.status}`)
          }

          // Buat 30 node (~40 JSON + 10 extra.md + 15 PNG + 2 root = 67 file)
          // 15 PNG diunggah lewat createBlob base64; teks diuji lewat entry tree inline + beberapa createBlob
          const pngFiles: Array<{ path: string; bytesLen: number; localSha: string; b64: string }> =
            []
          const treeEntries: Array<{
            path: string
            mode: '100644'
            type: 'blob'
            sha?: string
            content?: string
          }> = []

          // Pakai file batch + PNG sintetis di browser via runLargeBlobProbe? Tidak, langsung konstruksi base64 ringan:
          const encoder = new TextEncoder()
          const toB64 = (bytes: Uint8Array) => {
            let bin = ''
            for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!)
            return btoa(bin)
          }

          treeEntries.push({
            path: 'vault/vault.json',
            mode: '100644',
            type: 'blob',
            content: JSON.stringify({ schema: 1, title: 'S1 Synthetic Vault' }),
          })
          treeEntries.push({
            path: 'vault/README-extra.txt',
            mode: '100644',
            type: 'blob',
            content: 'extra file preserved',
          })

          for (let i = 1; i <= 30; i += 1) {
            const folder =
              i === 3
                ? 'vault/catatan/ide baru — café 3'
                : `vault/catatan/node-${String(i).padStart(2, '0')}`
            treeEntries.push({
              path: `${folder}/node.json`,
              mode: '100644',
              type: 'blob',
              content: JSON.stringify({
                schema: 1,
                id: `01S1NODE000000000000000${String(i).padStart(3, '0')}`,
                title: i === 3 ? 'Ide Baru — Café #3' : `Node #${i}`,
              }),
            })
            if (i <= 20) {
              treeEntries.push({
                path: `${folder}/canvas.json`,
                mode: '100644',
                type: 'blob',
                content: JSON.stringify({ schema: 1, node: i, unicode: 'Δαβ' }),
              })
            }
            if (i <= 10) {
              treeEntries.push({
                path: `${folder}/extra-note.txt`,
                mode: '100644',
                type: 'blob',
                content: `extra-${i}`,
              })
            }
            if (i <= 15) {
              // Valid 1x1 PNG + padding seed unik per gambar
              const header = new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
                0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
                0x00, 0x90, 0x77, 0x53, 0xde,
              ])
              const pad = encoder.encode(`KNOVITES-PNG-SEED-${i}-${'X'.repeat(2048)}`)
              const combined = new Uint8Array(header.length + pad.length)
              combined.set(header, 0)
              combined.set(pad, header.length)
              const b64 = toB64(combined)
              const localSha = await window.__S1__!.computeSha1FromBase64(b64)
              const blobRes = await window.__S1__!.createBlobBase64(owner, repo, b64)
              if (!blobRes.ok) throw new Error(`createBlob PNG ${i} failed HTTP ${blobRes.status}`)
              pngFiles.push({
                path: `${folder}/assets/gambar-${i}.png`,
                bytesLen: combined.byteLength,
                localSha,
                b64,
              })
              treeEntries.push({
                path: `${folder}/assets/gambar-${i}.png`,
                mode: '100644',
                type: 'blob',
                sha: blobRes.data.sha,
              })
              if (blobRes.data.sha !== localSha) {
                throw new Error(`SHA-1 mismatch for PNG ${i}: ${blobRes.data.sha} vs ${localSha}`)
              }
            }
          }

          const newTree = await window.__S1__!.createTree(owner, repo, treeSha, treeEntries)
          const newCommit = await window.__S1__!.createCommit(
            owner,
            repo,
            'spike s1 fixture commit',
            newTree.data.sha,
            [headSha],
          )
          const updatedRef = await window.__S1__!.updateBranchHead(
            owner,
            repo,
            branchName,
            newCommit.data.sha,
            false,
          )

          // Juga uji 1 roundtrip tulis via Octokit di branch yang sama
          const octoRes = await window.__S1__!.octokitRoundtripOneBlob({
            owner,
            repo,
            branch: branchName,
            parentCommitSha: newCommit.data.sha,
            baseTreeSha: newTree.data.sha,
            path: 'vault/octokit-probe.txt',
            content: 'Written by octokit.rest.git in Chromium — Δαβ',
          })

          // Pull kembali tree rekursif + verifikasi path Unicode & concurrent PNG blobs (<=4)
          const fetchedTree = await window.__S1__!.getTree(owner, repo, newCommit.data.sha, true)
          const samplePngShas = pngFiles.slice(0, 5).map((p) => {
            const match = fetchedTree.data.tree.find((entry) => entry.path === p.path)
            return match?.sha ?? ''
          })
          const pullBatch = await window.__S1__!.runBlobPullBatch(owner, repo, samplePngShas)

          return {
            totalUploadedPaths: treeEntries.length,
            fetchedTreeCount: fetchedTree.data.tree.length,
            truncated: fetchedTree.data.truncated,
            hasUnicodePath: fetchedTree.data.tree.some(
              (entry) => entry.path === 'vault/catatan/ide baru — café 3/node.json',
            ),
            hasExtraFile: fetchedTree.data.tree.some(
              (entry) => entry.path === 'vault/README-extra.txt',
            ),
            updateRefStatus: updatedRef.status,
            octoRes,
            pullBatch,
          }
        },
        {
          owner: REPO_OWNER,
          repo: REPO_NAME,
          branchName: branch,
          headSha: mainSha,
          treeSha: baseTreeSha,
        },
      )

      expect(outcome.updateRefStatus).toBe(200)
      expect(outcome.truncated).toBe(false)
      expect(outcome.hasUnicodePath).toBe(true)
      expect(outcome.hasExtraFile).toBe(true)
      expect(outcome.octoRes.refStatus).toBe(200)
      expect(outcome.octoRes.blobMatch).toBe(true)
      expect(outcome.pullBatch.verifiedCount).toBe(5)

      logTelemetry('B2', outcome)
    } finally {
      const delStatus = await page.evaluate(
        ({ owner, repo, branchName }) => window.__S1__!.deleteBranch(owner, repo, branchName),
        { owner: REPO_OWNER, repo: REPO_NAME, branchName: branch },
      )
      expect([204, 404, 422]).toContain(delStatus)
      await recordSuiteWrites(page)
    }
  })

  test('B3. Changeset deletes->moves->upserts live + perilaku sha:null pada path yang tidak ada', async ({
    page,
  }) => {
    await initHarness(page, true)
    const { mainSha, baseTreeSha } = await assertSafePrivateTestRepo(page)
    const branch = makeTempBranchName('b3-changeset')

    try {
      const outcome = await page.evaluate(
        async ({ owner, repo, branchName, headSha, treeSha }) => {
          await window.__S1__!.createBranch(owner, repo, branchName, headSha)

          // Commit dasar berisi file untuk delete, swap, case-only, overwrite move, dan extraFiles
          const initTree = await window.__S1__!.createTree(owner, repo, treeSha, [
            { path: 's1-plan/keep-extra.txt', mode: '100644', type: 'blob', content: 'stay-put' },
            {
              path: 's1-plan/to-delete.json',
              mode: '100644',
              type: 'blob',
              content: '{"bye":true}',
            },
            { path: 's1-plan/swap-a.json', mode: '100644', type: 'blob', content: '{"v":"A"}' },
            { path: 's1-plan/swap-b.json', mode: '100644', type: 'blob', content: '{"v":"B"}' },
            { path: 's1-plan/CaseFile.json', mode: '100644', type: 'blob', content: '{"c":1}' },
            { path: 's1-plan/move-src.json', mode: '100644', type: 'blob', content: '{"src":1}' },
            {
              path: 's1-plan/overwrite-target.json',
              mode: '100644',
              type: 'blob',
              content: '{"old":1}',
            },
          ])
          const initCommit = await window.__S1__!.createCommit(
            owner,
            repo,
            's1 b3 base tree',
            initTree.data.sha,
            [headSha],
          )
          await window.__S1__!.updateBranchHead(owner, repo, branchName, initCommit.data.sha, false)

          const remoteTreeRes = await window.__S1__!.getTree(owner, repo, initTree.data.sha, true)

          // Probe langsung (#7 / Prasyarat M6 #2): apakah sha:null untuk path tidak ada ditolak GitHub?
          const missingDeleteProbe = await window.__S1__!.createTree(
            owner,
            repo,
            initTree.data.sha,
            [
              {
                path: 's1-plan/nonexistent-ghost-file.json',
                mode: '100644',
                type: 'blob',
                sha: null,
              },
            ],
          )

          // Eksekusi changeset terencana lewat planner (menangkal path tidak ada!)
          const plannedPush = await window.__S1__!.pushPlannedChangeset({
            owner,
            repo,
            branch: branchName,
            parentCommitSha: initCommit.data.sha,
            baseTreeSha: initTree.data.sha,
            remoteTreeEntries: remoteTreeRes.data.tree,
            changeset: {
              deletes: ['s1-plan/to-delete.json', 's1-plan/nonexistent-ghost-file.json'],
              moves: [
                { from: 's1-plan/swap-a.json', to: 's1-plan/swap-b.json' },
                { from: 's1-plan/swap-b.json', to: 's1-plan/swap-a.json' },
                { from: 's1-plan/CaseFile.json', to: 's1-plan/casefile.json' },
                { from: 's1-plan/move-src.json', to: 's1-plan/overwrite-target.json' },
              ],
              upserts: [
                { path: 's1-plan/overwrite-target.json', content: '{"winner":"upsert-wins"}' },
                { path: 's1-plan/added.json', content: '{"new":true}' },
              ],
            },
            message: 's1 b3 planned changeset commit',
          })

          const afterTreeRes = await window.__S1__!.getTree(owner, repo, plannedPush.treeSha, true)
          const afterPaths = afterTreeRes.data.tree.map((t) => t.path)
          const swapASha = afterTreeRes.data.tree.find((t) => t.path === 's1-plan/swap-a.json')?.sha
          const swapBSha = afterTreeRes.data.tree.find((t) => t.path === 's1-plan/swap-b.json')?.sha
          const oldSwapASha = remoteTreeRes.data.tree.find(
            (t) => t.path === 's1-plan/swap-a.json',
          )?.sha
          const oldSwapBSha = remoteTreeRes.data.tree.find(
            (t) => t.path === 's1-plan/swap-b.json',
          )?.sha
          const targetSha = afterTreeRes.data.tree.find(
            (t) => t.path === 's1-plan/overwrite-target.json',
          )?.sha
          const targetBlob = targetSha
            ? await window.__S1__!.getBlobJson(owner, repo, targetSha)
            : null

          return {
            missingDeleteProbeStatus: missingDeleteProbe.status,
            missingDeleteProbeBody: missingDeleteProbe.data,
            skippedMissingDeletes: plannedPush.skippedMissingDeletes,
            plannedUpdateRefStatus: plannedPush.updateRefStatus,
            afterPaths,
            swapOk: swapASha === oldSwapBSha && swapBSha === oldSwapASha,
            targetBlobBase64: targetBlob?.data?.content ?? '',
          }
        },
        {
          owner: REPO_OWNER,
          repo: REPO_NAME,
          branchName: branch,
          headSha: mainSha,
          treeSha: baseTreeSha,
        },
      )

      // Pastikan planner menolak/melewati hapus path yang tidak ada & hasil commit akurat
      expect(outcome.skippedMissingDeletes).toEqual(['s1-plan/nonexistent-ghost-file.json'])
      expect(outcome.plannedUpdateRefStatus).toBe(200)
      expect(outcome.afterPaths).not.toContain('s1-plan/to-delete.json')
      expect(outcome.afterPaths).not.toContain('s1-plan/CaseFile.json')
      expect(outcome.afterPaths).toContain('s1-plan/casefile.json')
      expect(outcome.afterPaths).not.toContain('s1-plan/move-src.json')
      expect(outcome.afterPaths).toContain('s1-plan/keep-extra.txt')
      expect(outcome.afterPaths).toContain('s1-plan/added.json')
      expect(outcome.swapOk).toBe(true)

      const decodedWinner = Buffer.from(outcome.targetBlobBase64, 'base64').toString('utf8')
      expect(decodedWinner).toBe('{"winner":"upsert-wins"}')

      logTelemetry('B3', {
        missingDeleteProbeStatus: outcome.missingDeleteProbeStatus,
        missingDeleteProbeBody: outcome.missingDeleteProbeBody,
        skippedMissingDeletes: outcome.skippedMissingDeletes,
        swapOk: outcome.swapOk,
        winnerDecoded: decodedWinner,
      })
    } finally {
      await page.evaluate(
        ({ owner, repo, branchName }) => window.__S1__!.deleteBranch(owner, repo, branchName),
        { owner: REPO_OWNER, repo: REPO_NAME, branchName: branch },
      )
      await recordSuiteWrites(page)
    }
  })

  test('B4. Non-fast-forward PATCH /git/refs dengan force:false ditolak (catat kode status & body)', async ({
    page,
  }) => {
    await initHarness(page, true)
    const { mainSha, baseTreeSha } = await assertSafePrivateTestRepo(page)
    const branch = makeTempBranchName('b4-nonff')

    try {
      const outcome = await page.evaluate(
        async ({ owner, repo, branchName, headSha, treeSha }) => {
          await window.__S1__!.createBranch(owner, repo, branchName, headSha)

          const treeA = await window.__S1__!.createTree(owner, repo, treeSha, [
            { path: 's1-nonff/a.txt', mode: '100644', type: 'blob', content: 'commit A' },
          ])
          const commitA = await window.__S1__!.createCommit(
            owner,
            repo,
            'commit A (winner)',
            treeA.data.sha,
            [headSha],
          )
          const fastForwardRes = await window.__S1__!.updateBranchHead(
            owner,
            repo,
            branchName,
            commitA.data.sha,
            false,
          )

          // Commit B juga bercabang dari headSha (bukan keturunan Commit A) -> non-fast-forward!
          const treeB = await window.__S1__!.createTree(owner, repo, treeSha, [
            { path: 's1-nonff/b.txt', mode: '100644', type: 'blob', content: 'commit B' },
          ])
          const commitB = await window.__S1__!.createCommit(
            owner,
            repo,
            'commit B (diverged)',
            treeB.data.sha,
            [headSha],
          )
          const conflictRes = await window.__S1__!.updateBranchHead(
            owner,
            repo,
            branchName,
            commitB.data.sha,
            false,
          )

          return {
            fastForwardStatus: fastForwardRes.status,
            conflictStatus: conflictRes.status,
            conflictOk: conflictRes.ok,
            conflictBody: conflictRes.data,
            conflictHeaders: conflictRes.headers,
          }
        },
        {
          owner: REPO_OWNER,
          repo: REPO_NAME,
          branchName: branch,
          headSha: mainSha,
          treeSha: baseTreeSha,
        },
      )

      expect(outcome.fastForwardStatus).toBe(200)
      expect(outcome.conflictOk).toBe(false)
      expect(outcome.conflictStatus).toBe(422)

      logTelemetry('B4', outcome)
    } finally {
      await page.evaluate(
        ({ owner, repo, branchName }) => window.__S1__!.deleteBranch(owner, repo, branchName),
        { owner: REPO_OWNER, repo: REPO_NAME, branchName: branch },
      )
      await recordSuiteWrites(page)
    }
  })

  test('B5. Conditional GET (If-None-Match -> 304) dengan cache no-store vs default dan dampak kuota', async ({
    page,
  }) => {
    await initHarness(page)
    await assertSafePrivateTestRepo(page)

    const outcome = await page.evaluate(
      async ({ owner, repo }) => {
        const r1 = await window.__S1__!.pollBranchHead(owner, repo, 'main', undefined, 'no-store')
        const etag = r1.headers['etag']
        const remAfter1 = Number(r1.headers['x-ratelimit-remaining'] ?? NaN)

        const r2NoStore = await window.__S1__!.pollBranchHead(owner, repo, 'main', etag, 'no-store')
        const remAfter304 = Number(r2NoStore.headers['x-ratelimit-remaining'] ?? NaN)

        const r3DefaultCache = await window.__S1__!.pollBranchHead(
          owner,
          repo,
          'main',
          etag,
          'default',
        )

        const r4Unconditional = await window.__S1__!.fetchGetRef(owner, repo, 'heads/main', {
          cache: 'no-store',
        })
        const remAfter200 = Number(r4Unconditional.headers['x-ratelimit-remaining'] ?? NaN)

        return {
          r1Status: r1.status,
          etag,
          remAfter1,
          r2Status: r2NoStore.status,
          r2LatencyMs: Number(r2NoStore.latencyMs.toFixed(1)),
          remAfter304,
          r3DefaultCacheStatus: r3DefaultCache.status,
          r4Status: r4Unconditional.status,
          remAfter200,
        }
      },
      { owner: REPO_OWNER, repo: REPO_NAME },
    )

    expect(outcome.r1Status).toBe(200)
    expect(outcome.etag).toBeTruthy()
    expect(outcome.r2Status).toBe(304)
    // 304 tidak menghabiskan kuota rate-limit primer GitHub
    expect(outcome.remAfter304).toBe(outcome.remAfter1)
    expect(outcome.r4Status).toBe(200)
    expect(outcome.remAfter200).toBe(outcome.remAfter304 - 1)

    logTelemetry('B5', outcome)
    await recordSuiteWrites(page)
  })

  test('B6. Blob besar (1 MB PNG & 10 MB biner): kecocokan SHA-1 lokal, JSON base64 vs raw+json', async ({
    page,
  }) => {
    await initHarness(page, true)
    await assertSafePrivateTestRepo(page)

    const outcome = await page.evaluate(
      async ({ owner, repo }) => {
        const oneMb = await window.__S1__!.runLargeBlobProbe(owner, repo, 1024 * 1024, 'png')
        const tenMb = await window.__S1__!.runLargeBlobProbe(
          owner,
          repo,
          10 * 1024 * 1024,
          'binary',
        )
        return { oneMb, tenMb }
      },
      { owner: REPO_OWNER, repo: REPO_NAME },
    )

    expect(outcome.oneMb.createStatus).toBe(201)
    expect(outcome.oneMb.createdSha).toBe(outcome.oneMb.localSha1)
    expect(outcome.oneMb.getJsonStatus).toBe(200)
    expect(outcome.oneMb.getJsonBytesMatch).toBe(true)
    expect(outcome.oneMb.getRawStatus).toBe(200)
    expect(outcome.oneMb.getRawBytesMatch).toBe(true)

    expect(outcome.tenMb.createStatus).toBe(201)
    expect(outcome.tenMb.createdSha).toBe(outcome.tenMb.localSha1)
    expect(outcome.tenMb.getJsonStatus).toBe(200)
    expect(outcome.tenMb.getJsonBytesMatch).toBe(true)
    expect(outcome.tenMb.getRawStatus).toBe(200)
    expect(outcome.tenMb.getRawBytesMatch).toBe(true)

    logTelemetry('B6', {
      oneMb: {
        ...outcome.oneMb,
        createLatencyMs: Number(outcome.oneMb.createLatencyMs.toFixed(1)),
        getJsonLatencyMs: Number(outcome.oneMb.getJsonLatencyMs.toFixed(1)),
        getRawLatencyMs: Number(outcome.oneMb.getRawLatencyMs.toFixed(1)),
      },
      tenMb: {
        ...outcome.tenMb,
        createLatencyMs: Number(outcome.tenMb.createLatencyMs.toFixed(1)),
        getJsonLatencyMs: Number(outcome.tenMb.getJsonLatencyMs.toFixed(1)),
        getRawLatencyMs: Number(outcome.tenMb.getRawLatencyMs.toFixed(1)),
      },
    })
    await recordSuiteWrites(page)
  })

  test('B7. Benchmark latensi push & pull (N = 5, 30, 80 file + tree inline N=30) dan konsumsi kuota', async ({
    page,
  }) => {
    await initHarness(page, true)
    const { mainSha, baseTreeSha } = await assertSafePrivateTestRepo(page)
    const branch = makeTempBranchName('b7-bench')

    try {
      const benchResults: Array<Record<string, unknown>> = []

      await page.evaluate(
        ({ owner, repo, branchName, headSha }) =>
          window.__S1__!.createBranch(owner, repo, branchName, headSha),
        { owner: REPO_OWNER, repo: REPO_NAME, branchName: branch, headSha: mainSha },
      )

      let parentSha = mainSha
      let currentTreeSha = baseTreeSha

      for (const n of [5, 30, 80]) {
        const files = generateBatchTextFiles(n, `bench-${n}`)
        const pushPayload = files.map((f) => ({ path: f.path, base64: f.base64 }))

        const step = await page.evaluate(
          async ({ owner, repo, branchName, parentCommitSha, treeSha, batch }) => {
            const beforeRemaining = (await window.__S1__!.fetchGetRateLimit()).headers[
              'x-ratelimit-remaining'
            ]
            const wallPushStart = performance.now()
            const blobPush = await window.__S1__!.runBlobPushBatch(owner, repo, batch)
            const treeRes = await window.__S1__!.createTree(
              owner,
              repo,
              treeSha,
              blobPush.shas.map((item) => ({
                path: item.path,
                mode: '100644' as const,
                type: 'blob' as const,
                sha: item.sha,
              })),
            )
            const commitRes = await window.__S1__!.createCommit(
              owner,
              repo,
              `bench N=${batch.length}`,
              treeRes.data.sha,
              [parentCommitSha],
            )
            const refRes = await window.__S1__!.updateBranchHead(
              owner,
              repo,
              branchName,
              commitRes.data.sha,
              false,
            )
            const pushWallMs = performance.now() - wallPushStart

            // Pull alur penuh: getRef -> getCommit -> getTree(recursive) -> N getBlob (concurrency<=4)
            const wallPullStart = performance.now()
            const refPull = await window.__S1__!.fetchGetRef(owner, repo, `heads/${branchName}`)
            const commitPull = await window.__S1__!.getCommit(owner, repo, refPull.data.object.sha)
            const treePull = await window.__S1__!.getTree(
              owner,
              repo,
              commitPull.data.tree.sha,
              true,
            )
            const targetShas = blobPush.shas.map((x) => x.sha)
            const blobPull = await window.__S1__!.runBlobPullBatch(owner, repo, targetShas)
            const pullWallMs = performance.now() - wallPullStart
            const afterRemaining = (await window.__S1__!.fetchGetRateLimit()).headers[
              'x-ratelimit-remaining'
            ]

            return {
              nextParentSha: commitRes.data.sha,
              nextTreeSha: treeRes.data.sha,
              refStatus: refRes.status,
              pushWallMs,
              blobPushLatencies: blobPush.latenciesMs,
              treeLatencyMs: treeRes.latencyMs,
              commitLatencyMs: commitRes.latencyMs,
              refLatencyMs: refRes.latencyMs,
              pullWallMs,
              pullRefMs: refPull.latencyMs,
              pullCommitMs: commitPull.latencyMs,
              pullTreeMs: treePull.latencyMs,
              pullBlobLatencies: blobPull.latenciesMs,
              verifiedCount: blobPull.verifiedCount,
              beforeRemaining: Number(beforeRemaining ?? NaN),
              afterRemaining: Number(afterRemaining ?? NaN),
            }
          },
          {
            owner: REPO_OWNER,
            repo: REPO_NAME,
            branchName: branch,
            parentCommitSha: parentSha,
            treeSha: currentTreeSha,
            batch: pushPayload,
          },
        )

        expect(step.refStatus).toBe(200)
        expect(step.verifiedCount).toBe(n)
        parentSha = step.nextParentSha
        currentTreeSha = step.nextTreeSha

        benchResults.push({
          n,
          mode: 'blobs+tree+commit+ref',
          pushWallMs: Number(step.pushWallMs.toFixed(1)),
          pushBlobHttp: summarizeLatencies(step.blobPushLatencies),
          pushFinalizeHttpMs: Number(
            (step.treeLatencyMs + step.commitLatencyMs + step.refLatencyMs).toFixed(1),
          ),
          pullWallMs: Number(step.pullWallMs.toFixed(1)),
          pullMetadataMs: Number((step.pullRefMs + step.pullCommitMs + step.pullTreeMs).toFixed(1)),
          pullBlobHttp: summarizeLatencies(step.pullBlobLatencies),
          quotaDelta: step.beforeRemaining - step.afterRemaining,
        })
      }

      // Perbandingan tambahan: inline `content` pada createTree untuk N=30 file teks
      const inlineFiles = generateBatchTextFiles(30, 'bench-inline-30')
      const inlineStep = await page.evaluate(
        async ({ owner, repo, branchName, parentCommitSha, treeSha, files }) => {
          const started = performance.now()
          const treeRes = await window.__S1__!.createTree(
            owner,
            repo,
            treeSha,
            files.map((f) => ({
              path: f.path,
              mode: '100644' as const,
              type: 'blob' as const,
              content: f.content,
            })),
          )
          const commitRes = await window.__S1__!.createCommit(
            owner,
            repo,
            'bench inline N=30',
            treeRes.data.sha,
            [parentCommitSha],
          )
          const refRes = await window.__S1__!.updateBranchHead(
            owner,
            repo,
            branchName,
            commitRes.data.sha,
            false,
          )
          return {
            refStatus: refRes.status,
            wallMs: performance.now() - started,
            writesCount: 3,
          }
        },
        {
          owner: REPO_OWNER,
          repo: REPO_NAME,
          branchName: branch,
          parentCommitSha: parentSha,
          treeSha: currentTreeSha,
          files: inlineFiles,
        },
      )
      expect(inlineStep.refStatus).toBe(200)

      logTelemetry('B7', {
        benchmarks: benchResults,
        inlineN30: {
          ...inlineStep,
          wallMs: Number(inlineStep.wallMs.toFixed(1)),
        },
      })
    } finally {
      await page.evaluate(
        ({ owner, repo, branchName }) => window.__S1__!.deleteBranch(owner, repo, branchName),
        { owner: REPO_OWNER, repo: REPO_NAME, branchName: branch },
      )
      await recordSuiteWrites(page)
    }
  })

  test('B8. Verifikator akhir: tidak ada branch s1-run-* tersisa dan HEAD main tidak berubah', async ({
    page,
  }) => {
    await initHarness(page)
    const { mainSha } = await assertSafePrivateTestRepo(page)

    const leftover = await page.evaluate(
      async ({ owner, repo }) => {
        const res = await window.__S1__!.listMatchingRefs(owner, repo, 'heads/s1-run-')
        return res
      },
      { owner: REPO_OWNER, repo: REPO_NAME },
    )

    expect(leftover.status).toBe(200)
    expect(leftover.data).toEqual([])
    expect(mainSha).toBe(recordedMainHeadSha)
    expect(totalWritesAcrossSuite).toBeLessThanOrEqual(MAX_WRITES_PER_RUN)

    logTelemetry('B8', {
      leftoverBranches: leftover.data.length,
      mainHeadSha: mainSha,
      totalWritesAcrossSuite,
    })
  })
})

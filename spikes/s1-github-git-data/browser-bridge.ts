import {
  ThinGitHubFetchClient,
  type GitBlobResponse,
  type GitCommitResponse,
  type GitHubHttpResponse,
  type GitRefResponse,
  type GitTreeEntryInput,
  type GitTreeResponse,
  type RepoSummary,
} from './fetch-client'
import { createDeterministicBytes, createSyntheticPngBytes } from './fixtures'
import { OctokitSpikeClient } from './octokit-client'
import type { Changeset, RemoteTreeEntry } from './planner'
import { RateGuard, type RateGuardStats } from './rate-guard'
import { base64ToBytes, bytesToBase64, computeGitBlobSha1, utf8ToBase64 } from './sha1'
import {
  cleanupTempBranch,
  pollBranchHeadIfChanged,
  pushPlannedChangeset,
  updateBranchHeadSafe,
  type PushStepResult,
} from './sync-flow'

export interface TelemetryListener {
  (stats: RateGuardStats): void
}

export interface BrowserApiBridge {
  init: (token: string, initialWritesUsed?: number, lastWriteEpochMs?: number) => void
  getStats: () => RateGuardStats
  fetchGetRepo: (owner: string, repo: string) => Promise<GitHubHttpResponse<RepoSummary>>
  fetchGetRateLimit: () => Promise<GitHubHttpResponse<Record<string, unknown>>>
  fetchGetRef: (
    owner: string,
    repo: string,
    ref: string,
    options?: { ifNoneMatch?: string; cache?: RequestCache },
  ) => Promise<GitHubHttpResponse<GitRefResponse>>
  pollBranchHead: (
    owner: string,
    repo: string,
    branch: string,
    etag?: string,
    cache?: RequestCache,
  ) => Promise<GitHubHttpResponse<GitRefResponse>>
  listMatchingRefs: (
    owner: string,
    repo: string,
    prefix: string,
  ) => Promise<GitHubHttpResponse<GitRefResponse[]>>
  createBranch: (
    owner: string,
    repo: string,
    branch: string,
    sha: string,
  ) => Promise<GitHubHttpResponse<GitRefResponse>>
  deleteBranch: (owner: string, repo: string, branch: string) => Promise<number>
  updateBranchHead: (
    owner: string,
    repo: string,
    branch: string,
    sha: string,
    force?: boolean,
  ) => Promise<GitHubHttpResponse<GitRefResponse>>
  getCommit: (
    owner: string,
    repo: string,
    commitSha: string,
  ) => Promise<GitHubHttpResponse<GitCommitResponse>>
  createCommit: (
    owner: string,
    repo: string,
    message: string,
    treeSha: string,
    parents: string[],
  ) => Promise<GitHubHttpResponse<GitCommitResponse>>
  getTree: (
    owner: string,
    repo: string,
    treeSha: string,
    recursive?: boolean,
  ) => Promise<GitHubHttpResponse<GitTreeResponse>>
  createTree: (
    owner: string,
    repo: string,
    baseTree: string | undefined,
    tree: GitTreeEntryInput[],
  ) => Promise<GitHubHttpResponse<{ sha: string }>>
  createBlobBase64: (
    owner: string,
    repo: string,
    base64: string,
  ) => Promise<GitHubHttpResponse<{ sha: string; url: string }>>
  createBlobUtf8: (
    owner: string,
    repo: string,
    text: string,
  ) => Promise<GitHubHttpResponse<{ sha: string; url: string }>>
  getBlobJson: (
    owner: string,
    repo: string,
    sha: string,
  ) => Promise<GitHubHttpResponse<GitBlobResponse | null>>
  getBlobRawBytes: (
    owner: string,
    repo: string,
    sha: string,
  ) => Promise<{
    status: number
    ok: boolean
    headers: Record<string, string>
    latencyMs: number
    byteLength: number
    gitSha1: string
  }>
  computeSha1FromBase64: (base64: string) => Promise<string>
  computeSha1FromText: (text: string) => Promise<string>
  pushPlannedChangeset: (params: {
    owner: string
    repo: string
    branch: string
    parentCommitSha: string
    baseTreeSha: string
    remoteTreeEntries: RemoteTreeEntry[]
    changeset: Changeset
    message: string
    allowMissingDeletes?: boolean
    forceRefUpdate?: boolean
  }) => Promise<PushStepResult>
  runBlobPullBatch: (
    owner: string,
    repo: string,
    shas: string[],
  ) => Promise<{
    totalWallMs: number
    latenciesMs: number[]
    verifiedCount: number
    totalBytes: number
    lastRemaining: number | null
  }>
  runBlobPushBatch: (
    owner: string,
    repo: string,
    files: Array<{ path: string; base64: string }>,
  ) => Promise<{
    shas: Array<{ path: string; sha: string }>
    latenciesMs: number[]
    lastRemaining: number | null
  }>
  octokitGetRepo: (owner: string, repo: string) => Promise<GitHubHttpResponse<RepoSummary>>
  octokitGetTree: (
    owner: string,
    repo: string,
    treeSha: string,
  ) => Promise<GitHubHttpResponse<GitTreeResponse>>
  octokitRoundtripOneBlob: (params: {
    owner: string
    repo: string
    branch: string
    parentCommitSha: string
    baseTreeSha: string
    path: string
    content: string
  }) => Promise<{ blobSha: string; commitSha: string; refStatus: number; blobMatch: boolean }>
  runLargeBlobProbe: (
    owner: string,
    repo: string,
    byteLength: number,
    kind: 'png' | 'binary',
  ) => Promise<{
    localSha1: string
    createStatus: number
    createdSha: string
    createLatencyMs: number
    getJsonStatus: number
    getJsonLatencyMs: number
    getJsonBytesMatch: boolean
    getRawStatus: number
    getRawLatencyMs: number
    getRawBytesMatch: boolean
    getRawContentType: string | null
    getRawCorsHeaders: Record<string, string>
  }>
}

declare global {
  interface Window {
    __S1__?: BrowserApiBridge
  }
}

let activeFetchClient: ThinGitHubFetchClient | null = null
let activeOctokitClient: OctokitSpikeClient | null = null
let activeGuard = new RateGuard()
const listeners = new Set<TelemetryListener>()

export function subscribeTelemetry(fn: TelemetryListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notifyTelemetry(): void {
  const snapshot = activeGuard.getStats()
  for (const listener of listeners) {
    listener(snapshot)
  }
}

function requireFetchClient(): ThinGitHubFetchClient {
  if (!activeFetchClient) {
    throw new Error('Spike S1 client not initialized')
  }
  return activeFetchClient
}

function requireOctokitClient(): OctokitSpikeClient {
  if (!activeOctokitClient) {
    throw new Error('Spike S1 Octokit client not initialized')
  }
  return activeOctokitClient
}

export function installBrowserBridge(): void {
  window.__S1__ = {
    init(token: string) {
      activeGuard = new RateGuard()
      activeFetchClient = new ThinGitHubFetchClient(token, activeGuard)
      activeOctokitClient = new OctokitSpikeClient(token, activeGuard)
      notifyTelemetry()
    },
    getStats() {
      return activeGuard.getStats()
    },
    async fetchGetRepo(owner, repo) {
      const res = await requireFetchClient().getRepo(owner, repo)
      notifyTelemetry()
      return res
    },
    async fetchGetRateLimit() {
      const res = await requireFetchClient().getRateLimit()
      notifyTelemetry()
      return res
    },
    async fetchGetRef(owner, repo, ref, options) {
      const res = await requireFetchClient().getRef(owner, repo, ref, options)
      notifyTelemetry()
      return res
    },
    async pollBranchHead(owner, repo, branch, etag, cache) {
      const res = await pollBranchHeadIfChanged(
        requireFetchClient(),
        owner,
        repo,
        branch,
        etag,
        cache,
      )
      notifyTelemetry()
      return res
    },
    async listMatchingRefs(owner, repo, prefix) {
      const res = await requireFetchClient().listMatchingRefs(owner, repo, prefix)
      notifyTelemetry()
      return res
    },
    async createBranch(owner, repo, branch, sha) {
      const res = await requireFetchClient().createRef(owner, repo, `refs/heads/${branch}`, sha)
      notifyTelemetry()
      return res
    },
    async deleteBranch(owner, repo, branch) {
      const status = await cleanupTempBranch(requireFetchClient(), owner, repo, branch)
      notifyTelemetry()
      return status
    },
    async updateBranchHead(owner, repo, branch, sha, force = false) {
      const res = await updateBranchHeadSafe(requireFetchClient(), owner, repo, branch, sha, force)
      notifyTelemetry()
      return res
    },
    async getCommit(owner, repo, commitSha) {
      const res = await requireFetchClient().getCommit(owner, repo, commitSha)
      notifyTelemetry()
      return res
    },
    async createCommit(owner, repo, message, tree, parents) {
      const res = await requireFetchClient().createCommit(owner, repo, { message, tree, parents })
      notifyTelemetry()
      return res
    },
    async getTree(owner, repo, treeSha, recursive = true) {
      const res = await requireFetchClient().getTree(owner, repo, treeSha, recursive)
      notifyTelemetry()
      return res
    },
    async createTree(owner, repo, baseTree, tree) {
      const res = await requireFetchClient().createTree(owner, repo, {
        ...(baseTree ? { base_tree: baseTree } : {}),
        tree,
      })
      notifyTelemetry()
      return res
    },
    async createBlobBase64(owner, repo, base64) {
      const res = await requireFetchClient().createBlob(owner, repo, base64, 'base64')
      notifyTelemetry()
      return res
    },
    async createBlobUtf8(owner, repo, text) {
      const res = await requireFetchClient().createBlob(owner, repo, text, 'utf-8')
      notifyTelemetry()
      return res
    },
    async getBlobJson(owner, repo, sha) {
      const res = await requireFetchClient().getBlob(owner, repo, sha, 'json')
      notifyTelemetry()
      return res
    },
    async getBlobRawBytes(owner, repo, sha) {
      const res = await requireFetchClient().getBlob(owner, repo, sha, 'raw')
      notifyTelemetry()
      const bytes = res.rawBytes ?? new Uint8Array(0)
      const gitSha1 = await computeGitBlobSha1(bytes)
      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        latencyMs: res.latencyMs,
        byteLength: bytes.byteLength,
        gitSha1,
      }
    },
    async computeSha1FromBase64(base64) {
      return computeGitBlobSha1(base64ToBytes(base64))
    },
    async computeSha1FromText(text) {
      return computeGitBlobSha1(text)
    },
    async pushPlannedChangeset(params) {
      const map = new Map<string, RemoteTreeEntry>(
        params.remoteTreeEntries.map((entry) => [entry.path, entry]),
      )
      const res = await pushPlannedChangeset({
        client: requireFetchClient(),
        owner: params.owner,
        repo: params.repo,
        branch: params.branch,
        parentCommitSha: params.parentCommitSha,
        baseTreeSha: params.baseTreeSha,
        remoteTree: map,
        changeset: params.changeset,
        message: params.message,
        allowMissingDeletes: params.allowMissingDeletes,
        forceRefUpdate: params.forceRefUpdate,
      })
      notifyTelemetry()
      return res
    },
    async runBlobPullBatch(owner, repo, shas) {
      const client = requireFetchClient()
      const started = performance.now()
      const latenciesMs: number[] = []
      let verifiedCount = 0
      let totalBytes = 0

      await Promise.all(
        shas.map(async (sha) => {
          const res = await client.getBlob(owner, repo, sha, 'json')
          latenciesMs.push(res.latencyMs)
          if (res.ok && res.data) {
            const bytes = base64ToBytes(res.data.content)
            totalBytes += bytes.byteLength
            const localSha = await computeGitBlobSha1(bytes)
            if (localSha === sha) verifiedCount += 1
          }
        }),
      )
      notifyTelemetry()
      return {
        totalWallMs: performance.now() - started,
        latenciesMs,
        verifiedCount,
        totalBytes,
        lastRemaining: activeGuard.getStats().lastRemaining,
      }
    },
    async runBlobPushBatch(owner, repo, files) {
      const client = requireFetchClient()
      const shas: Array<{ path: string; sha: string }> = []
      const latenciesMs: number[] = []
      for (const file of files) {
        const res = await client.createBlob(owner, repo, file.base64, 'base64')
        latenciesMs.push(res.latencyMs)
        if (!res.ok) {
          throw new Error(`Batch createBlob failed HTTP ${res.status} for ${file.path}`)
        }
        shas.push({ path: file.path, sha: res.data.sha })
      }
      notifyTelemetry()
      return {
        shas,
        latenciesMs,
        lastRemaining: activeGuard.getStats().lastRemaining,
      }
    },
    async octokitGetRepo(owner, repo) {
      const res = await requireOctokitClient().getRepo(owner, repo)
      notifyTelemetry()
      return res
    },
    async octokitGetTree(owner, repo, treeSha) {
      const res = await requireOctokitClient().getTree(owner, repo, treeSha, true)
      notifyTelemetry()
      return res
    },
    async octokitRoundtripOneBlob(params) {
      const octokit = requireOctokitClient()
      const b64 = utf8ToBase64(params.content)
      const blobRes = await octokit.createBlob(params.owner, params.repo, b64, 'base64')
      const treeRes = await octokit.createTree(params.owner, params.repo, {
        base_tree: params.baseTreeSha,
        tree: [{ path: params.path, mode: '100644', type: 'blob', sha: blobRes.data.sha }],
      })
      const commitRes = await octokit.createCommit(params.owner, params.repo, {
        message: 's1 octokit roundtrip probe',
        tree: treeRes.data.sha,
        parents: [params.parentCommitSha],
      })
      const refRes = await octokit.updateRef(
        params.owner,
        params.repo,
        `heads/${params.branch}`,
        commitRes.data.sha,
        false,
      )
      const getBlobRes = await octokit.getBlob(params.owner, params.repo, blobRes.data.sha)
      const roundtripBytes = base64ToBytes(getBlobRes.data.content)
      const expectedBytes = base64ToBytes(bytesToBase64(new TextEncoder().encode(params.content)))
      const blobMatch =
        roundtripBytes.byteLength === expectedBytes.byteLength &&
        roundtripBytes.every((b, idx) => b === expectedBytes[idx])
      notifyTelemetry()
      return {
        blobSha: blobRes.data.sha,
        commitSha: commitRes.data.sha,
        refStatus: refRes.status,
        blobMatch,
      }
    },
    async runLargeBlobProbe(owner, repo, byteLength, kind) {
      const client = requireFetchClient()
      const payload =
        kind === 'png'
          ? createSyntheticPngBytes(byteLength, 77)
          : createDeterministicBytes(byteLength, 99)
      const localSha1 = await computeGitBlobSha1(payload)
      const base64 = bytesToBase64(payload)

      const createRes = await client.createBlob(owner, repo, base64, 'base64')
      const jsonRes = await client.getBlob(owner, repo, createRes.data.sha, 'json')
      let getJsonBytesMatch = false
      if (jsonRes.ok && jsonRes.data) {
        const decoded = base64ToBytes(jsonRes.data.content)
        getJsonBytesMatch =
          decoded.byteLength === payload.byteLength &&
          (await computeGitBlobSha1(decoded)) === localSha1
      }

      const rawRes = await client.getBlob(owner, repo, createRes.data.sha, 'raw')
      const rawBytes = rawRes.rawBytes ?? new Uint8Array(0)
      const getRawBytesMatch =
        rawRes.ok &&
        rawBytes.byteLength === payload.byteLength &&
        (await computeGitBlobSha1(rawBytes)) === localSha1

      notifyTelemetry()
      return {
        localSha1,
        createStatus: createRes.status,
        createdSha: createRes.data.sha,
        createLatencyMs: createRes.latencyMs,
        getJsonStatus: jsonRes.status,
        getJsonLatencyMs: jsonRes.latencyMs,
        getJsonBytesMatch,
        getRawStatus: rawRes.status,
        getRawLatencyMs: rawRes.latencyMs,
        getRawBytesMatch,
        getRawContentType: rawRes.headers['content-type'] ?? null,
        getRawCorsHeaders: rawRes.headers,
      }
    },
  }
}

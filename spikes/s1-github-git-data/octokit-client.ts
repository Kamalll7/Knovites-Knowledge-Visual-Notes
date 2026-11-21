// eslint-disable-next-line no-restricted-imports -- Spike S1 compares Octokit vs thin fetch in browser
import { Octokit, RequestError } from 'octokit'
import type {
  GitBlobResponse,
  GitCommitResponse,
  GitHubHttpResponse,
  GitRefResponse,
  GitTreeEntryInput,
  GitTreeResponse,
  RepoSummary,
} from './fetch-client'
import { RateGuard } from './rate-guard'
import { formatRedactedError, redactHeaders, redactSecrets, registerSecret } from './redact'

function normalizeHeaders(
  raw: Record<string, string | number | undefined> | undefined,
): Record<string, string> {
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue
    out[k.toLowerCase()] =
      k.toLowerCase() === 'authorization' ? '[REDACTED]' : redactSecrets(String(v))
  }
  return out
}

export class OctokitSpikeClient {
  private readonly octokit: Octokit
  readonly guard: RateGuard

  constructor(token: string, guard?: RateGuard) {
    registerSecret(token)
    this.guard = guard ?? new RateGuard()

    const guardedFetch: typeof fetch = (input, init) => {
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase()
      return this.guard.scheduleRequest(method, () => fetch(input, init))
    }

    this.octokit = new Octokit({
      auth: token,
      // Matikan auto-retry/throttling bawaan agar patuh aturan abort instan 403/429 & pace > 1000ms
      throttle: { enabled: false },
      retry: { enabled: false },
      request: {
        fetch: guardedFetch,
      },
    })
  }

  private async wrapCall<T>(
    fn: () => Promise<{
      status: number
      headers: Record<string, string | number | undefined>
      data: T
    }>,
  ): Promise<GitHubHttpResponse<T>> {
    const started = performance.now()
    try {
      const res = await fn()
      return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        headers: normalizeHeaders(res.headers),
        data: res.data,
        latencyMs: performance.now() - started,
      }
    } catch (error) {
      if (error instanceof RequestError) {
        const resHeaders = error.response?.headers
          ? normalizeHeaders(error.response.headers as Record<string, string | number | undefined>)
          : redactHeaders({})
        return {
          status: error.status,
          ok: false,
          headers: resHeaders,
          data: (error.response?.data ?? redactSecrets(error.message)) as T,
          latencyMs: performance.now() - started,
        }
      }
      throw new Error(formatRedactedError(error), { cause: error })
    }
  }

  getRepo(owner: string, repo: string): Promise<GitHubHttpResponse<RepoSummary>> {
    return this.wrapCall(() => this.octokit.rest.repos.get({ owner, repo }))
  }

  getRef(owner: string, repo: string, ref: string): Promise<GitHubHttpResponse<GitRefResponse>> {
    return this.wrapCall(() => this.octokit.rest.git.getRef({ owner, repo, ref }))
  }

  createBlob(
    owner: string,
    repo: string,
    content: string,
    encoding: 'base64' | 'utf-8' = 'base64',
  ): Promise<GitHubHttpResponse<{ sha: string; url: string }>> {
    return this.wrapCall(() => this.octokit.rest.git.createBlob({ owner, repo, content, encoding }))
  }

  getBlob(
    owner: string,
    repo: string,
    fileSha: string,
  ): Promise<GitHubHttpResponse<GitBlobResponse>> {
    return this.wrapCall(() => this.octokit.rest.git.getBlob({ owner, repo, file_sha: fileSha }))
  }

  getCommit(
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<GitHubHttpResponse<GitCommitResponse>> {
    return this.wrapCall(() =>
      this.octokit.rest.git.getCommit({ owner, repo, commit_sha: commitSha }),
    )
  }

  getTree(
    owner: string,
    repo: string,
    treeSha: string,
    recursive = true,
  ): Promise<GitHubHttpResponse<GitTreeResponse>> {
    return this.wrapCall(
      () =>
        this.octokit.rest.git.getTree({
          owner,
          repo,
          tree_sha: treeSha,
          ...(recursive ? { recursive: 'true' } : {}),
        }) as Promise<{
          status: number
          headers: Record<string, string | number | undefined>
          data: GitTreeResponse
        }>,
    )
  }

  createTree(
    owner: string,
    repo: string,
    params: { base_tree?: string; tree: GitTreeEntryInput[] },
  ): Promise<GitHubHttpResponse<{ sha: string }>> {
    return this.wrapCall(() =>
      this.octokit.rest.git.createTree({
        owner,
        repo,
        ...(params.base_tree ? { base_tree: params.base_tree } : {}),
        tree: params.tree.map((entry) => ({
          path: entry.path,
          mode: entry.mode,
          type: entry.type,
          ...(entry.sha !== undefined ? { sha: entry.sha } : {}),
          ...(entry.content !== undefined ? { content: entry.content } : {}),
        })),
      }),
    )
  }

  createCommit(
    owner: string,
    repo: string,
    params: { message: string; tree: string; parents: string[] },
  ): Promise<GitHubHttpResponse<GitCommitResponse>> {
    return this.wrapCall(() => this.octokit.rest.git.createCommit({ owner, repo, ...params }))
  }

  updateRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
    force: boolean,
  ): Promise<GitHubHttpResponse<GitRefResponse>> {
    return this.wrapCall(() => this.octokit.rest.git.updateRef({ owner, repo, ref, sha, force }))
  }
}

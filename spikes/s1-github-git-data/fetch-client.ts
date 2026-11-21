import { RateGuard } from './rate-guard'
import { formatRedactedError, redactHeaders, redactSecrets, registerSecret } from './redact'

const API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'

export interface GitHubHttpResponse<T = unknown> {
  status: number
  ok: boolean
  headers: Record<string, string>
  data: T
  rawBytes?: Uint8Array
  latencyMs: number
}

export interface GitTreeEntryInput {
  path: string
  mode: '100644' | '100755' | '040000' | '160000' | '120000'
  type: 'blob' | 'tree' | 'commit'
  sha?: string | null
  content?: string
}

export interface RepoSummary {
  name: string
  full_name: string
  private: boolean
  default_branch: string
  size: number
}

export interface GitRefResponse {
  ref: string
  object: { type: string; sha: string; url: string }
}

export interface GitCommitResponse {
  sha: string
  tree: { sha: string; url: string }
  parents: Array<{ sha: string }>
  message: string
}

export interface GitTreeResponse {
  sha: string
  truncated: boolean
  tree: Array<{
    path: string
    mode: string
    type: 'blob' | 'tree' | 'commit'
    sha: string
    size?: number
  }>
}

export interface GitBlobResponse {
  sha: string
  size: number | null
  encoding: string
  content: string
}

function encodeRefPath(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/')
}

export class ThinGitHubFetchClient {
  private readonly token: string
  readonly guard: RateGuard

  constructor(token: string, guard?: RateGuard) {
    registerSecret(token)
    this.token = token
    this.guard = guard ?? new RateGuard()
  }

  async requestJson<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown
      headers?: Record<string, string>
      cache?: RequestCache
      accept?: string
      rawResponse?: boolean
    },
  ): Promise<GitHubHttpResponse<T>> {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`
    const reqHeaders = new Headers({
      Accept: options?.accept ?? 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': API_VERSION,
      ...options?.headers,
    })
    let bodyString: string | undefined
    if (options?.body !== undefined) {
      reqHeaders.set('Content-Type', 'application/json')
      bodyString = JSON.stringify(options.body)
    }

    const started = performance.now()
    let response: Response
    try {
      response = await this.guard.scheduleRequest(method, () =>
        fetch(url, {
          method,
          headers: reqHeaders,
          body: bodyString,
          cache: options?.cache ?? 'no-store',
        }),
      )
    } catch (error) {
      throw new Error(formatRedactedError(error), { cause: error })
    }

    const latencyMs = performance.now() - started
    const headers = redactHeaders(response.headers)

    if (response.status === 204 || response.status === 304) {
      return {
        status: response.status,
        ok: response.status === 204,
        headers,
        data: null as T,
        latencyMs,
      }
    }

    if (options?.rawResponse && response.ok) {
      const buf = new Uint8Array(await response.arrayBuffer())
      return {
        status: response.status,
        ok: response.ok,
        headers,
        data: null as T,
        rawBytes: buf,
        latencyMs,
      }
    }

    const rawText = await response.text()
    let parsed: unknown = null
    if (rawText.length > 0) {
      try {
        parsed = JSON.parse(rawText) as unknown
      } catch {
        parsed = redactSecrets(rawText)
      }
    }
    return {
      status: response.status,
      ok: response.ok,
      headers,
      data: parsed as T,
      latencyMs,
    }
  }

  getRepo(owner: string, repo: string): Promise<GitHubHttpResponse<RepoSummary>> {
    return this.requestJson('GET', `/repos/${owner}/${repo}`)
  }

  getRateLimit(): Promise<GitHubHttpResponse<Record<string, unknown>>> {
    return this.requestJson('GET', '/rate_limit')
  }

  getRef(
    owner: string,
    repo: string,
    ref: string,
    options?: { ifNoneMatch?: string; cache?: RequestCache },
  ): Promise<GitHubHttpResponse<GitRefResponse>> {
    const headers: Record<string, string> = {}
    if (options?.ifNoneMatch) {
      headers['If-None-Match'] = options.ifNoneMatch
    }
    return this.requestJson('GET', `/repos/${owner}/${repo}/git/ref/${encodeRefPath(ref)}`, {
      headers,
      cache: options?.cache ?? 'no-store',
    })
  }

  listMatchingRefs(
    owner: string,
    repo: string,
    prefix: string,
  ): Promise<GitHubHttpResponse<GitRefResponse[]>> {
    return this.requestJson(
      'GET',
      `/repos/${owner}/${repo}/git/matching-refs/${encodeRefPath(prefix)}`,
    )
  }

  createRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
  ): Promise<GitHubHttpResponse<GitRefResponse>> {
    return this.requestJson('POST', `/repos/${owner}/${repo}/git/refs`, {
      body: { ref, sha },
    })
  }

  updateRef(
    owner: string,
    repo: string,
    ref: string,
    sha: string,
    force: boolean,
  ): Promise<GitHubHttpResponse<GitRefResponse>> {
    return this.requestJson('PATCH', `/repos/${owner}/${repo}/git/refs/${encodeRefPath(ref)}`, {
      body: { sha, force },
    })
  }

  deleteRef(owner: string, repo: string, ref: string): Promise<GitHubHttpResponse<null>> {
    return this.requestJson('DELETE', `/repos/${owner}/${repo}/git/refs/${encodeRefPath(ref)}`)
  }

  getCommit(
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<GitHubHttpResponse<GitCommitResponse>> {
    return this.requestJson('GET', `/repos/${owner}/${repo}/git/commits/${commitSha}`)
  }

  createCommit(
    owner: string,
    repo: string,
    params: { message: string; tree: string; parents: string[] },
  ): Promise<GitHubHttpResponse<GitCommitResponse>> {
    return this.requestJson('POST', `/repos/${owner}/${repo}/git/commits`, {
      body: params,
    })
  }

  getTree(
    owner: string,
    repo: string,
    treeSha: string,
    recursive = true,
  ): Promise<GitHubHttpResponse<GitTreeResponse>> {
    const query = recursive ? '?recursive=1' : ''
    return this.requestJson('GET', `/repos/${owner}/${repo}/git/trees/${treeSha}${query}`)
  }

  createTree(
    owner: string,
    repo: string,
    params: { base_tree?: string; tree: GitTreeEntryInput[] },
  ): Promise<GitHubHttpResponse<{ sha: string }>> {
    return this.requestJson('POST', `/repos/${owner}/${repo}/git/trees`, {
      body: params,
    })
  }

  createBlob(
    owner: string,
    repo: string,
    content: string,
    encoding: 'base64' | 'utf-8' = 'base64',
  ): Promise<GitHubHttpResponse<{ sha: string; url: string }>> {
    return this.requestJson('POST', `/repos/${owner}/${repo}/git/blobs`, {
      body: { content, encoding },
    })
  }

  getBlob(
    owner: string,
    repo: string,
    sha: string,
    format: 'json' | 'raw' = 'json',
  ): Promise<GitHubHttpResponse<GitBlobResponse | null>> {
    if (format === 'raw') {
      return this.requestJson('GET', `/repos/${owner}/${repo}/git/blobs/${sha}`, {
        accept: 'application/vnd.github.raw+json',
        rawResponse: true,
      })
    }
    return this.requestJson('GET', `/repos/${owner}/${repo}/git/blobs/${sha}`)
  }
}

import type { ThinGitHubFetchClient, GitHubHttpResponse, GitRefResponse } from './fetch-client'
import type { Changeset, GitTreeMutation, RemoteTreeEntry } from './planner'
import { planGitTreeMutations } from './planner'
import { utf8ToBase64 } from './sha1'

export interface PushStepResult {
  createTreeStatus: number
  createCommitStatus: number
  updateRefStatus: number
  commitSha: string
  treeSha: string
  mutations: GitTreeMutation[]
  skippedMissingDeletes: string[]
}

export async function pollBranchHeadIfChanged(
  client: ThinGitHubFetchClient,
  owner: string,
  repo: string,
  branch: string,
  etag?: string,
  cache: RequestCache = 'no-store',
): Promise<GitHubHttpResponse<GitRefResponse>> {
  return client.getRef(owner, repo, `heads/${branch}`, {
    ifNoneMatch: etag,
    cache,
  })
}

export async function updateBranchHeadSafe(
  client: ThinGitHubFetchClient,
  owner: string,
  repo: string,
  branch: string,
  commitSha: string,
  force = false,
): Promise<GitHubHttpResponse<GitRefResponse>> {
  return client.updateRef(owner, repo, `heads/${branch}`, commitSha, force)
}

export async function pushPlannedChangeset(params: {
  client: ThinGitHubFetchClient
  owner: string
  repo: string
  branch: string
  parentCommitSha: string
  baseTreeSha: string
  remoteTree: ReadonlyMap<string, RemoteTreeEntry>
  changeset: Changeset
  message: string
  allowMissingDeletes?: boolean
  forceRefUpdate?: boolean
}): Promise<PushStepResult> {
  const {
    client,
    owner,
    repo,
    branch,
    parentCommitSha,
    baseTreeSha,
    remoteTree,
    changeset,
    message,
    allowMissingDeletes = false,
    forceRefUpdate = false,
  } = params

  const blobShas = new Map<string, string>()
  for (const upsert of changeset.upserts) {
    const res = await client.createBlob(owner, repo, utf8ToBase64(upsert.content), 'base64')
    if (!res.ok) {
      throw new Error(`createBlob failed HTTP ${res.status} for ${upsert.path}`)
    }
    blobShas.set(upsert.path, res.data.sha)
  }

  const plan = planGitTreeMutations({
    changeset,
    remoteTree,
    upsertedBlobShas: blobShas,
    options: { allowMissingDeletes },
  })

  const treeRes = await client.createTree(owner, repo, {
    base_tree: baseTreeSha,
    tree: plan.mutations,
  })
  if (!treeRes.ok) {
    throw new Error(`createTree failed HTTP ${treeRes.status}: ${JSON.stringify(treeRes.data)}`)
  }

  const commitRes = await client.createCommit(owner, repo, {
    message,
    tree: treeRes.data.sha,
    parents: [parentCommitSha],
  })
  if (!commitRes.ok) {
    throw new Error(
      `createCommit failed HTTP ${commitRes.status}: ${JSON.stringify(commitRes.data)}`,
    )
  }

  const refRes = await updateBranchHeadSafe(
    client,
    owner,
    repo,
    branch,
    commitRes.data.sha,
    forceRefUpdate,
  )
  if (!refRes.ok) {
    throw new Error(`updateRef failed HTTP ${refRes.status}: ${JSON.stringify(refRes.data)}`)
  }

  return {
    createTreeStatus: treeRes.status,
    createCommitStatus: commitRes.status,
    updateRefStatus: refRes.status,
    commitSha: commitRes.data.sha,
    treeSha: treeRes.data.sha,
    mutations: plan.mutations,
    skippedMissingDeletes: plan.skippedMissingDeletes,
  }
}

export async function cleanupTempBranch(
  client: ThinGitHubFetchClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<number> {
  const res = await client.deleteRef(owner, repo, `heads/${branch}`)
  return res.status
}

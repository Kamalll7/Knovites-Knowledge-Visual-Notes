/**
 * Mirror lokal bentuk Changeset (`src/domain/tree/types.ts`) tanpa mengimpor `src/`.
 */
export interface FileUpsert {
  path: string
  content: string
}

export interface FileMove {
  from: string
  to: string
}

export interface Changeset {
  upserts: FileUpsert[]
  moves: FileMove[]
  deletes: string[]
}

export interface RemoteTreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
}

export interface GitTreeMutation {
  path: string
  mode: '100644' | '100755' | '040000' | '160000' | '120000'
  type: 'blob'
  sha: string | null
}

export interface PlannerOptions {
  /**
   * Default `false`: planner TIDAK mengirim `sha: null` untuk path yang absen dari tree remote.
   * Opsi `true` hanya dipakai uji mutasi untuk membuktikan respons GitHub saat aturan dilanggar.
   */
  allowMissingDeletes?: boolean
}

export interface PlanResult {
  mutations: GitTreeMutation[]
  skippedMissingDeletes: string[]
  skippedMissingMoveSources: string[]
}

function normalizeMode(mode: string | undefined): GitTreeMutation['mode'] {
  if (mode === '100755') return '100755'
  if (mode === '120000') return '120000'
  return '100644'
}

/**
 * Mengonversi Changeset (`deletes -> moves -> upserts`) terhadap snapshot tree remote
 * menjadi array entry `POST /git/trees` yang deterministik.
 *
 * Aturan:
 * 1. Hanya blob remote yang eksis yang bisa dihapus (`sha: null`), kecuali `allowMissingDeletes`.
 * 2. Semua sumber `moves[i].from` di-snapshot terlebih dahulu agar rename tukar/rantai/case-only
 *    (`a -> b` & `b -> a`, atau `foo.json -> Foo.json`) tidak saling menimpa.
 * 3. `upserts` dijalankan terakhir sehingga menang bila target `path` sama dengan `moves[i].to`.
 */
export function planGitTreeMutations(params: {
  changeset: Changeset
  remoteTree: ReadonlyMap<string, RemoteTreeEntry>
  upsertedBlobShas: ReadonlyMap<string, string>
  options?: PlannerOptions
}): PlanResult {
  const { changeset, remoteTree, upsertedBlobShas, options } = params
  const allowMissingDeletes = options?.allowMissingDeletes ?? false

  const desired = new Map<string, GitTreeMutation>()
  const skippedMissingDeletes: string[] = []
  const skippedMissingMoveSources: string[] = []

  // Snapshot sumber move sebelum mutasi agar swap/subtree/case-only tidak saling timpa
  const moveSources = new Map<string, RemoteTreeEntry>()
  for (const move of changeset.moves) {
    const entry = remoteTree.get(move.from)
    if (entry && entry.type === 'blob') {
      moveSources.set(move.from, entry)
    }
  }

  // 1. deletes
  for (const delPath of changeset.deletes) {
    const remoteEntry = remoteTree.get(delPath)
    if (!remoteEntry) {
      if (allowMissingDeletes) {
        desired.set(delPath, { path: delPath, mode: '100644', type: 'blob', sha: null })
      } else {
        skippedMissingDeletes.push(delPath)
      }
      continue
    }
    if (remoteEntry.type !== 'blob') continue
    desired.set(delPath, {
      path: delPath,
      mode: normalizeMode(remoteEntry.mode),
      type: 'blob',
      sha: null,
    })
  }

  // 2. moves
  const moveTargets = new Set(changeset.moves.map((m) => m.to))
  const upsertTargets = new Set(changeset.upserts.map((u) => u.path))

  for (const move of changeset.moves) {
    const sourceEntry = moveSources.get(move.from)
    if (!sourceEntry) {
      skippedMissingMoveSources.push(move.from)
      continue
    }
    if (move.from === move.to) continue

    desired.set(move.to, {
      path: move.to,
      mode: normalizeMode(sourceEntry.mode),
      type: 'blob',
      sha: sourceEntry.sha,
    })

    // Hapus path sumber hanya jika tidak ditimpa kembali oleh target move/upsert lain
    if (!moveTargets.has(move.from) && !upsertTargets.has(move.from)) {
      desired.set(move.from, {
        path: move.from,
        mode: normalizeMode(sourceEntry.mode),
        type: 'blob',
        sha: null,
      })
    }
  }

  // 3. upserts (menang atas moves.to atau deletes di path yang sama)
  for (const upsert of changeset.upserts) {
    const blobSha = upsertedBlobShas.get(upsert.path)
    if (!blobSha) {
      throw new Error(`Missing uploaded blob SHA for upsert path "${upsert.path}"`)
    }
    desired.set(upsert.path, {
      path: upsert.path,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    })
  }

  const mutations = Array.from(desired.values()).sort((a, b) => a.path.localeCompare(b.path))
  return {
    mutations,
    skippedMissingDeletes,
    skippedMissingMoveSources,
  }
}

import type { NodeJson, NodeStatus, NodeType } from '@/domain/schema'
import {
  deriveNodePath,
  generateOrderBetween,
  resolveUniqueSlug,
  slugify,
  type TreeBuildEntry,
} from '@/domain/tree'
import {
  createSeededTimestamp,
  createSeededUlidGenerator,
  mulberry32,
  pickOne,
} from '@/testing/datasets/prng'

export interface GenerateTreeOptions {
  seed: number
  nodes: number
  imbalance?: number
}

const BRANCH_COLORS = ['#e11d48', '#0284c7', '#059669', '#d97706', '#7c3aed'] as const

const NODE_STATUSES: readonly NodeStatus[] = ['none', 'learning', 'practiced', 'mastered']
const INNER_NODE_TYPES: readonly NodeType[] = [
  'category',
  'concept',
  'technique',
  'challenge',
  'lab',
]

const CURATED_TOPICS: readonly string[] = [
  'Binary Exploitation',
  'Reverse Engineering',
  'Applied Cryptography',
  'Kernel Internals',
  'Browser & JIT Security',
  'Stack Frame Layout',
  'Return-Oriented Programming',
  'Sigreturn-Oriented Programming',
  'Stack Canary Leak',
  'Format String Arbitrary Write',
  'Glibc Heap Tcache Poisoning',
  'Fastbin Double Free',
  'House of Botcake',
  'Unsorted Bin Attack',
  'ELF Dynamic Linking',
  'GOT & PLT Lazy Binding',
  'Control-Flow Graph Recovery',
  'Symbolic Execution with angr',
  'Ghidra P-Code Analysis',
  'SSA Form Lifting',
  'DWARF CFI Unwinding',
  'Opaque Predicates Removal',
  'Control Flow Flattening',
  'VM Handler Devirtualization',
  'AES-GCM Nonce Reuse',
  'CBC Padding Oracle Attack',
  'RSA Small Public Exponent',
  'Wiener Continued Fractions',
  'Coppersmith Short Pad',
  'Lattice Reduction with LLL',
  'Elliptic Curve Invalid Curve',
  'ECDSA Nonce Bias',
  'Diffie-Hellman Subgroup Attack',
  'Linux SLUB Allocator',
  'eBPF Verifier Bounds Tracking',
  'Seccomp BPF Filter Bypass',
  'Race Condition in io_uring',
  'Userfaultfd Race Primitives',
  'V8 TurboFan Type Confusion',
  'WASM Linear Memory Overflow',
  'ASLR Entropy & Leak Analysis',
  'PIE Base Calculation',
  'ret2dlresolve Exploitation',
  'FSOP File Structure Hijack',
  'Safe-Linking XOR Mangling',
  'Pointer Mangling Demystified',
  'PE Import Address Reconstruction',
  'TLS Callbacks & Anti-Debug',
  'Dynamic Binary Instrumentation',
  'Frida Gum Stalker Tracing',
  'QEMU Snapshot Fuzzing',
  'AFL++ Persistent Mode',
  'LibAFL Custom Mutators',
  'Taint Propagation Engines',
  'SMT Z3 Constraint Solving',
  'Merkle-Damgard Length Extension',
  'Bleichenbacher PKCS Padding',
  'Cross-VM Cache Timing',
  'Spectre Variant One Gadgets',
  'Page Table Walk Isolation',
]

const ENVIRONMENTS: readonly string[] = [
  'x86_64',
  'ARM64',
  'RISC-V',
  'MIPS',
  'Linux Kernel',
  'Windows PE',
  'Android ART',
  'iOS XNU',
  'macOS Mach-O',
  'V8 TurboFan',
  'SpiderMonkey',
  'JavaScriptCore',
  'glibc',
  'musl libc',
  'QEMU TCG',
  'UEFI Firmware',
  'eBPF',
  'KVM Hypervisor',
  'WebAssembly',
  'LLVM IR',
  'OpenSSL',
  'CPython',
  'Rust Unsafe',
  'SQLite Engine',
  'Chromium Mojo',
  'OpenSSH',
]

const CONCEPTS: readonly string[] = [
  'Shadow Stack',
  'Heap Feng Shui',
  'Use-After-Free',
  'Type Confusion',
  'Out-of-Bounds Read',
  'Integer Sign Extension',
  'TOCTOU Race',
  'Dirty Creds',
  'SMEP SMAP Bypass',
  'KASLR Leak',
  'Syscall Filtering',
  'Pointer Authentication',
  'Relocation Table',
  'Import Hashing',
  'String Decryption',
  'CFG Recovery',
  'Taint Tracking',
  'Concolic Tracing',
  'Modular Inverse',
  'Montgomery Ladder',
  'PRF PRP Security',
  'HKDF Key Schedule',
  'Fault Injection',
  'Cache Side Channel',
  'Coverage Guided Fuzzing',
  'Grammar Mutator',
  'Sanitizer Instrumentation',
  'JIT Spraying',
  'Seccomp Notify',
  'Slab Aliasing',
  'Arena Contention',
  'Vtable Verification',
  'CFI Shadow Call',
  'Pac Sign Key',
  'Branch Target Buffer',
  'DWARF Expressions',
]

const CONTEXTS: readonly string[] = [
  'Internals',
  'Attack Primitives',
  'Case Study',
  'Hardening Notes',
  'Mitigation Bypass',
  'Walkthrough',
  'Memory Layout',
  'Static Signatures',
  'Dynamic Tracing',
  'Exploit Vector',
]

const TAG_POOL: readonly string[] = [
  'pwn',
  're',
  'crypto',
  'kernel',
  'heap',
  'stack',
  'elf',
  'llvm',
  'fuzzing',
  'z3',
  'ecc',
  'rsa',
  'ebpf',
  'jit',
  'x86_64',
  'arm64',
]

interface MutableParentTracker {
  id: string
  path: string
  depth: number
  branchIdx: number
  childrenCount: number
  childSlugs: string[]
  lastChildOrder: string | null
}

/**
 * Deterministic stream of realistic security & systems titles (never "node-1").
 */
export function createTitleGenerator(rng: () => number): () => string {
  const used = new Set<string>()
  const curatedPool = [...CURATED_TOPICS]
  // Deterministic Fisher-Yates shuffle on curatedPool
  for (let i = curatedPool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = curatedPool[i]!
    curatedPool[i] = curatedPool[j]!
    curatedPool[j] = tmp
  }

  let curatedIdx = 0
  const envCount = ENVIRONMENTS.length
  const conceptCount = CONCEPTS.length
  const ctxCount = CONTEXTS.length
  const totalCombos = envCount * conceptCount * ctxCount
  // Prime stride ensures pseudo-random non-repeating traversal across all combinations
  let comboCursor = Math.floor(rng() * totalCombos)
  const stride = 2621 // coprime to 26 * 36 * 10 = 9360

  return () => {
    while (curatedIdx < curatedPool.length) {
      const candidate = curatedPool[curatedIdx]!
      curatedIdx += 1
      if (!used.has(candidate)) {
        used.add(candidate)
        return candidate
      }
    }

    for (let attempt = 0; attempt < totalCombos; attempt += 1) {
      comboCursor = (comboCursor + stride) % totalCombos
      const e = Math.floor(comboCursor / (conceptCount * ctxCount))
      const c = Math.floor((comboCursor % (conceptCount * ctxCount)) / ctxCount)
      const x = comboCursor % ctxCount
      const candidate = `${ENVIRONMENTS[e]} ${CONCEPTS[c]} ${CONTEXTS[x]}`
      if (!used.has(candidate)) {
        used.add(candidate)
        return candidate
      }
    }

    throw new Error('Exhausted realistic title space')
  }
}

export function pickNodeTags(rng: () => number): string[] {
  const count = 1 + Math.floor(rng() * 3)
  const chosen = new Set<string>()
  while (chosen.size < count) {
    chosen.add(pickOne(rng, TAG_POOL))
  }
  return [...chosen].sort()
}

export function buildGeneratedNodeMeta(params: {
  id: string
  title: string
  order: string
  type: NodeType
  status: NodeStatus
  tags: string[]
  color: string | null
  links?: NodeJson['links']
  createdAt: string
}): NodeJson {
  return {
    schema: 1,
    id: params.id,
    title: params.title,
    type: params.type,
    status: params.status,
    tags: params.tags,
    order: params.order,
    color: params.color,
    links: params.links ?? [],
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  }
}

function chooseWeightedBranch(rng: () => number, branchCount: number, imbalance: number): number {
  if (branchCount <= 1) return 0
  const weights: number[] = []
  let total = 0
  for (let b = 0; b < branchCount; b += 1) {
    const w = Math.pow(1 + imbalance * 7, branchCount - 1 - b)
    weights.push(w)
    total += w
  }
  let target = rng() * total
  for (let b = 0; b < branchCount; b += 1) {
    target -= weights[b]!
    if (target <= 0) return b
  }
  return 0
}

function chooseParentInBranch(
  rng: () => number,
  branchNodes: readonly MutableParentTracker[],
  imbalance: number,
): MutableParentTracker {
  if (branchNodes.length === 1) {
    return branchNodes[0]!
  }

  // Balanced mode: fill shallowest nodes with small fanout first
  if (imbalance <= 0.15) {
    let best = branchNodes[0]!
    for (let i = 1; i < branchNodes.length; i += 1) {
      const candidate = branchNodes[i]!
      if (
        candidate.depth < best.depth ||
        (candidate.depth === best.depth && candidate.childrenCount < best.childrenCount)
      ) {
        best = candidate
      }
    }
    return best
  }

  // Deterministic bounded sampling keeps O(1) cost per node even for 2,000+ nodes
  const sampleCount = Math.min(branchNodes.length, 48)
  const step = branchNodes.length / sampleCount
  const weights: number[] = []
  const candidates: MutableParentTracker[] = []
  let total = 0

  for (let s = 0; s < sampleCount; s += 1) {
    const idx = s === 0 ? 0 : Math.min(branchNodes.length - 1, Math.floor(s * step))
    const node = branchNodes[idx]!
    // Combine preferential attachment on shallow hubs + spine growth on deeper nodes
    const depthBoost = node.branchIdx === 0 ? Math.pow(node.depth, 1 + imbalance * 1.3) : 1
    const hubBonus = node.childrenCount < 10 ? 1 + node.childrenCount * imbalance : 0.4
    const w = depthBoost * hubBonus
    candidates.push(node)
    weights.push(w)
    total += w
  }

  let cursor = rng() * total
  for (let i = 0; i < candidates.length; i += 1) {
    cursor -= weights[i]!
    if (cursor <= 0) return candidates[i]!
  }
  return candidates[candidates.length - 1]!
}

/**
 * Generates a deterministic tree of valid `TreeBuildEntry` objects ready for `buildTree()`.
 */
export function generateTree(options: GenerateTreeOptions): TreeBuildEntry[] {
  const count = Math.max(0, Math.floor(options.nodes))
  if (count === 0) return []

  const imbalance = Math.max(0, Math.min(1, options.imbalance ?? 0.5))
  const rng = mulberry32(options.seed)
  const nextId = createSeededUlidGenerator(options.seed)
  const nextTitle = createTitleGenerator(rng)

  const rootCount = count === 1 ? 1 : count <= 3 ? count : Math.min(count, imbalance >= 0.7 ? 3 : 4)

  const entries: TreeBuildEntry[] = []
  const createdById: string[] = []
  const branchNodes: MutableParentTracker[][] = Array.from({ length: rootCount }, () => [])
  const rootSlugs: string[] = []
  let lastRootOrder: string | null = null

  for (let i = 0; i < count; i += 1) {
    const id = nextId()
    const title = nextTitle()
    const baseSlug = slugify(title)
    const createdAt = createSeededTimestamp(i)
    const tags = pickNodeTags(rng)
    const status = pickOne(rng, NODE_STATUSES)

    if (i < rootCount) {
      const branchIdx = i
      const slug = resolveUniqueSlug(baseSlug, rootSlugs)
      rootSlugs.push(slug)
      const order = generateOrderBetween(lastRootOrder, null)
      lastRootOrder = order
      const path = deriveNodePath(null, slug)

      const node = buildGeneratedNodeMeta({
        id,
        title,
        order,
        type: 'category',
        status,
        tags,
        color: BRANCH_COLORS[branchIdx % BRANCH_COLORS.length]!,
        createdAt,
      })

      entries.push({ path, node, hasCanvas: true })
      createdById.push(id)
      branchNodes[branchIdx]!.push({
        id,
        path,
        depth: 1,
        branchIdx,
        childrenCount: 0,
        childSlugs: [],
        lastChildOrder: null,
      })
      continue
    }

    const branchIdx = chooseWeightedBranch(rng, rootCount, imbalance)
    const parent = chooseParentInBranch(rng, branchNodes[branchIdx]!, imbalance)
    const slug = resolveUniqueSlug(baseSlug, parent.childSlugs)
    parent.childSlugs.push(slug)
    const order = generateOrderBetween(parent.lastChildOrder, null)
    parent.lastChildOrder = order
    parent.childrenCount += 1

    const path = deriveNodePath(parent.path, slug)
    const links: NodeJson['links'] =
      createdById.length > 2 && rng() < 0.08
        ? [{ to: pickOne(rng, createdById), label: 'related technique' }]
        : []

    const node = buildGeneratedNodeMeta({
      id,
      title,
      order,
      type: pickOne(rng, INNER_NODE_TYPES),
      status,
      tags,
      color: null,
      links,
      createdAt,
    })

    entries.push({ path, node, hasCanvas: rng() < 0.35 })
    createdById.push(id)
    branchNodes[branchIdx]!.push({
      id,
      path,
      depth: parent.depth + 1,
      branchIdx,
      childrenCount: 0,
      childSlugs: [],
      lastChildOrder: null,
    })
  }

  return entries
}

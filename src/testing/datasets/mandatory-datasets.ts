import type { KnovitesJson, NodeStatus, NodeType } from '@/domain/schema'
import {
  deriveNodePath,
  generateOrderBetween,
  resolveUniqueSlug,
  slugify,
  type TreeBuildEntry,
} from '@/domain/tree'
import {
  buildGeneratedNodeMeta,
  createTitleGenerator,
  generateTree,
  pickNodeTags,
} from '@/testing/datasets/generate-tree'
import {
  createSeededTimestamp,
  createSeededUlidGenerator,
  mulberry32,
  pickOne,
} from '@/testing/datasets/prng'

export interface NamedMapDataset {
  id: 'unbalanced150' | 'wide60Children' | 'chainDepth12' | 'root20Children' | 'large2000'
  name: string
  manifest: KnovitesJson
  entries: TreeBuildEntry[]
}

const STATUSES: readonly NodeStatus[] = ['none', 'learning', 'practiced', 'mastered']
const LEAF_TYPES: readonly NodeType[] = ['concept', 'technique', 'challenge', 'lab']

function makeManifest(title: string): KnovitesJson {
  return {
    schema: 1,
    title,
    createdAt: createSeededTimestamp(0),
  }
}

/**
 * Mandatory dataset #1: 150 nodes unbalanced tree (`spec-map.md`).
 */
export function createUnbalanced150Dataset(): NamedMapDataset {
  return {
    id: 'unbalanced150',
    name: '150 Nodes Unbalanced',
    manifest: makeManifest('Unbalanced Knowledge Map (150 nodes)'),
    entries: generateTree({ seed: 15001, nodes: 150, imbalance: 0.85 }),
  }
}

/**
 * Mandatory dataset #2: one node with 60 direct children (`spec-map.md`).
 */
export function createWide60ChildrenDataset(): NamedMapDataset {
  const seed = 60001
  const rng = mulberry32(seed)
  const nextId = createSeededUlidGenerator(seed)
  const nextTitle = createTitleGenerator(rng)

  const parentTitle = 'Binary Exploitation Techniques'
  const parentSlug = slugify(parentTitle)
  const parentOrder = generateOrderBetween(null, null)

  const entries: TreeBuildEntry[] = [
    {
      path: parentSlug,
      node: buildGeneratedNodeMeta({
        id: nextId(),
        title: parentTitle,
        order: parentOrder,
        type: 'category',
        status: 'practiced',
        tags: ['pwn', 'techniques'],
        color: '#e11d48',
        createdAt: createSeededTimestamp(0),
      }),
      hasCanvas: false,
    },
  ]

  const childSlugs: string[] = []
  let prevOrder: string | null = null
  for (let i = 0; i < 60; i += 1) {
    const title = nextTitle()
    const slug = resolveUniqueSlug(slugify(title), childSlugs)
    childSlugs.push(slug)
    const order = generateOrderBetween(prevOrder, null)
    prevOrder = order

    entries.push({
      path: deriveNodePath(parentSlug, slug),
      node: buildGeneratedNodeMeta({
        id: nextId(),
        title,
        order,
        type: pickOne(rng, LEAF_TYPES),
        status: pickOne(rng, STATUSES),
        tags: pickNodeTags(rng),
        color: null,
        createdAt: createSeededTimestamp(i + 1),
      }),
      hasCanvas: false,
    })
  }

  return {
    id: 'wide60Children',
    name: 'Single Node with 60 Children',
    manifest: makeManifest('Single Hub (60 children)'),
    entries,
  }
}

const CHAIN_TITLES: readonly string[] = [
  'Systems Security Foundations',
  'Operating System Kernel Architecture',
  'Virtual Memory Management',
  'Multi-Level Page Tables',
  'Kernel Slab Allocator Internals',
  'SLUB Freelist Randomized Pointers',
  'Generic Object Cache Reuse',
  'Use-After-Free Write Primitive',
  'Cross-Cache Page Reclamation',
  'cred Structure Privilege Escalation',
  'Namespace Escape via Capabilities',
  'Full Root Shell Verification',
]

/**
 * Mandatory dataset #3: linear chain of depth 12 (`spec-map.md`).
 */
export function createChainDepth12Dataset(): NamedMapDataset {
  const seed = 12001
  const rng = mulberry32(seed)
  const nextId = createSeededUlidGenerator(seed)

  const entries: TreeBuildEntry[] = []
  let parentPath: string | null = null

  for (let depth = 0; depth < 12; depth += 1) {
    const title = CHAIN_TITLES[depth]!
    const slug = slugify(title)
    const path = deriveNodePath(parentPath, slug)
    const order = generateOrderBetween(null, null)

    entries.push({
      path,
      node: buildGeneratedNodeMeta({
        id: nextId(),
        title,
        order,
        type: depth === 0 ? 'category' : depth === 11 ? 'challenge' : 'concept',
        status: pickOne(rng, STATUSES),
        tags: pickNodeTags(rng),
        color: depth === 0 ? '#0284c7' : null,
        createdAt: createSeededTimestamp(depth),
      }),
      hasCanvas: depth === 11,
    })

    parentPath = path
  }

  return {
    id: 'chainDepth12',
    name: 'Chain of Depth 12',
    manifest: makeManifest('Deep Chain (Depth 12)'),
    entries,
  }
}

/**
 * Mandatory dataset #4: virtual root with 20 top-level children (`spec-map.md`).
 */
export function createRoot20ChildrenDataset(): NamedMapDataset {
  const seed = 2001
  const rng = mulberry32(seed)
  const nextId = createSeededUlidGenerator(seed)
  const nextTitle = createTitleGenerator(rng)

  const entries: TreeBuildEntry[] = []
  const rootSlugs: string[] = []
  let prevOrder: string | null = null

  for (let i = 0; i < 20; i += 1) {
    const title = nextTitle()
    const slug = resolveUniqueSlug(slugify(title), rootSlugs)
    rootSlugs.push(slug)
    const order = generateOrderBetween(prevOrder, null)
    prevOrder = order

    entries.push({
      path: deriveNodePath(null, slug),
      node: buildGeneratedNodeMeta({
        id: nextId(),
        title,
        order,
        type: 'category',
        status: pickOne(rng, STATUSES),
        tags: pickNodeTags(rng),
        color: i % 2 === 0 ? '#059669' : null,
        createdAt: createSeededTimestamp(i),
      }),
      hasCanvas: false,
    })
  }

  return {
    id: 'root20Children',
    name: 'Root with 20 Children',
    manifest: makeManifest('Wide Root (20 children)'),
    entries,
  }
}

/**
 * Mandatory dataset #5: 2,000-node tree for layout performance & viewport budgeting (`spec-map.md`).
 */
export function createLarge2000Dataset(): NamedMapDataset {
  return {
    id: 'large2000',
    name: '2,000-Node Tree',
    manifest: makeManifest('Large Scale Knowledge Tree (2,000 nodes)'),
    entries: generateTree({ seed: 20001, nodes: 2000, imbalance: 0.7 }),
  }
}

export function createMandatoryDatasets(): Record<NamedMapDataset['id'], NamedMapDataset> {
  return {
    unbalanced150: createUnbalanced150Dataset(),
    wide60Children: createWide60ChildrenDataset(),
    chainDepth12: createChainDepth12Dataset(),
    root20Children: createRoot20ChildrenDataset(),
    large2000: createLarge2000Dataset(),
  }
}

export const MANDATORY_MAP_DATASETS: Record<NamedMapDataset['id'], NamedMapDataset> =
  createMandatoryDatasets()

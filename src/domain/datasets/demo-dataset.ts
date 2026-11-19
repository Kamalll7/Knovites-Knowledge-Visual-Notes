import type {
  CanvasJson,
  CanvasTextElement,
  KnovitesJson,
  NodeJson,
  NodeStatus,
  NodeType,
  TipTapDoc,
} from '@/domain/schema'
import {
  deriveNodePath,
  generateOrderBetween,
  resolveUniqueSlug,
  slugify,
  type TreeBuildEntry,
} from '@/domain/tree'
import { createSeededTimestamp, createSeededUlidGenerator } from '@/domain/datasets/prng'

export interface DemoDataset {
  manifest: KnovitesJson
  entries: TreeBuildEntry[]
  canvases: Record<string, CanvasJson>
}

interface DemoSpecNode {
  key: string
  parentKey: string | null
  title: string
  type: NodeType
  status: NodeStatus
  tags: string[]
  color: string | null
  links?: Array<{ targetKey: string; label: string }>
}

const DEMO_SPECS: readonly DemoSpecNode[] = [
  // Level 1: Three root branches (PWN, RE, CRYPTO)
  {
    key: 'pwn',
    parentKey: null,
    title: 'PWN',
    type: 'category',
    status: 'practiced',
    tags: ['pwn', 'binary-exploitation'],
    color: '#e11d48',
  },
  {
    key: 're',
    parentKey: null,
    title: 'RE',
    type: 'category',
    status: 'learning',
    tags: ['re', 'reverse-engineering'],
    color: '#0284c7',
  },
  {
    key: 'crypto',
    parentKey: null,
    title: 'CRYPTO',
    type: 'category',
    status: 'mastered',
    tags: ['crypto', 'math'],
    color: '#059669',
  },

  // Level 2 under PWN (4)
  {
    key: 'pwn-stack',
    parentKey: 'pwn',
    title: 'Stack Exploitation',
    type: 'category',
    status: 'mastered',
    tags: ['pwn', 'stack'],
    color: null,
  },
  {
    key: 'pwn-heap',
    parentKey: 'pwn',
    title: 'Heap Internals',
    type: 'category',
    status: 'practiced',
    tags: ['pwn', 'heap', 'glibc'],
    color: null,
  },
  {
    key: 'pwn-fmt',
    parentKey: 'pwn',
    title: 'Format String Bugs',
    type: 'concept',
    status: 'learning',
    tags: ['pwn', 'format-string'],
    color: null,
  },
  {
    key: 'pwn-kernel',
    parentKey: 'pwn',
    title: 'Kernel PWN',
    type: 'category',
    status: 'none',
    tags: ['pwn', 'kernel', 'linux'],
    color: null,
  },

  // Level 2 under RE (4)
  {
    key: 're-elf',
    parentKey: 're',
    title: 'ELF & PE Internals',
    type: 'concept',
    status: 'mastered',
    tags: ['re', 'elf', 'loader'],
    color: null,
  },
  {
    key: 're-decomp',
    parentKey: 're',
    title: 'Decompilation & Lifting',
    type: 'concept',
    status: 'practiced',
    tags: ['re', 'ghidra', 'ssa'],
    color: null,
  },
  {
    key: 're-anti',
    parentKey: 're',
    title: 'Anti-Analysis & Obfuscation',
    type: 'technique',
    status: 'learning',
    tags: ['re', 'obfuscation'],
    color: null,
  },
  {
    key: 're-symex',
    parentKey: 're',
    title: 'Symbolic Execution',
    type: 'technique',
    status: 'none',
    tags: ['re', 'angr', 'smt'],
    color: null,
  },

  // Level 2 under CRYPTO (3)
  {
    key: 'crypto-sym',
    parentKey: 'crypto',
    title: 'Symmetric Block Ciphers',
    type: 'concept',
    status: 'mastered',
    tags: ['crypto', 'aes', 'modes'],
    color: null,
  },
  {
    key: 'crypto-rsa',
    parentKey: 'crypto',
    title: 'RSA & Number Theory',
    type: 'concept',
    status: 'practiced',
    tags: ['crypto', 'rsa', 'number-theory'],
    color: null,
  },
  {
    key: 'crypto-ecc',
    parentKey: 'crypto',
    title: 'Elliptic Curve Cryptography',
    type: 'concept',
    status: 'learning',
    tags: ['crypto', 'ecc', 'curves'],
    color: null,
  },

  // Level 3 under PWN (10)
  {
    key: 'pwn-ret2win',
    parentKey: 'pwn-stack',
    title: 'Ret2win & Calling Conventions',
    type: 'technique',
    status: 'mastered',
    tags: ['pwn', 'stack', 'x86_64'],
    color: null,
    links: [{ targetKey: 're-elf', label: 'uses ABI & symbol table layout' }],
  },
  {
    key: 'pwn-rop',
    parentKey: 'pwn-stack',
    title: 'Return-Oriented Programming',
    type: 'technique',
    status: 'practiced',
    tags: ['pwn', 'rop', 'gadgets'],
    color: null,
    links: [{ targetKey: 're-got-plt', label: 'resolves libc via GOT/PLT leak' }],
  },
  {
    key: 'pwn-canary',
    parentKey: 'pwn-stack',
    title: 'Stack Canary & PIE Bypass',
    type: 'challenge',
    status: 'learning',
    tags: ['pwn', 'canary', 'aslr'],
    color: null,
    links: [{ targetKey: 'pwn-fmt-read', label: 'leaks cookie via %p' }],
  },
  {
    key: 'pwn-tcache',
    parentKey: 'pwn-heap',
    title: 'Tcache Poisoning',
    type: 'technique',
    status: 'practiced',
    tags: ['pwn', 'heap', 'tcache'],
    color: null,
  },
  {
    key: 'pwn-fastbin',
    parentKey: 'pwn-heap',
    title: 'Fastbin Dup & Double Free',
    type: 'challenge',
    status: 'mastered',
    tags: ['pwn', 'heap', 'fastbin'],
    color: null,
  },
  {
    key: 'pwn-botcake',
    parentKey: 'pwn-heap',
    title: 'House of Botcake',
    type: 'challenge',
    status: 'learning',
    tags: ['pwn', 'heap', 'glibc_2_35'],
    color: null,
  },
  {
    key: 'pwn-fmt-read',
    parentKey: 'pwn-fmt',
    title: 'Arbitrary Read via Format Specifiers',
    type: 'technique',
    status: 'mastered',
    tags: ['pwn', 'format-string', 'leak'],
    color: null,
  },
  {
    key: 'pwn-fmt-got',
    parentKey: 'pwn-fmt',
    title: 'GOT Overwrite with %n',
    type: 'challenge',
    status: 'practiced',
    tags: ['pwn', 'format-string', 'got'],
    color: null,
    links: [{ targetKey: 're-got-plt', label: 'targets writable GOT entry' }],
  },
  {
    key: 'pwn-slub',
    parentKey: 'pwn-kernel',
    title: 'SLUB UAF & msg_msg Spray',
    type: 'technique',
    status: 'learning',
    tags: ['pwn', 'kernel', 'slub'],
    color: null,
  },
  {
    key: 'pwn-smep',
    parentKey: 'pwn-kernel',
    title: 'ret2usr & SMEP Bypass',
    type: 'challenge',
    status: 'none',
    tags: ['pwn', 'kernel', 'smep'],
    color: null,
  },

  // Level 3 under RE (9)
  {
    key: 're-got-plt',
    parentKey: 're-elf',
    title: 'GOT & PLT Lazy Binding',
    type: 'concept',
    status: 'mastered',
    tags: ['re', 'elf', 'dynamic-linker'],
    color: null,
    links: [{ targetKey: 'pwn-rop', label: 'enables ret2libc gadget chains' }],
  },
  {
    key: 're-phdr',
    parentKey: 're-elf',
    title: 'Program Headers & Segments',
    type: 'concept',
    status: 'practiced',
    tags: ['re', 'elf', 'segments'],
    color: null,
  },
  {
    key: 're-dwarf',
    parentKey: 're-elf',
    title: 'DWARF CFI Unwind Tables',
    type: 'concept',
    status: 'learning',
    tags: ['re', 'dwarf', 'unwinding'],
    color: null,
  },
  {
    key: 're-ghidra',
    parentKey: 're-decomp',
    title: 'Ghidra P-Code Analysis',
    type: 'technique',
    status: 'practiced',
    tags: ['re', 'ghidra', 'pcode'],
    color: null,
  },
  {
    key: 're-ssa',
    parentKey: 're-decomp',
    title: 'SSA Form & Dead Store Elimination',
    type: 'concept',
    status: 'learning',
    tags: ['re', 'ssa', 'compiler'],
    color: null,
  },
  {
    key: 're-cff',
    parentKey: 're-anti',
    title: 'Control Flow Flattening',
    type: 'technique',
    status: 'learning',
    tags: ['re', 'obfuscation', 'ollvm'],
    color: null,
    links: [{ targetKey: 're-angr', label: 'deobfuscated using symbolic tracing' }],
  },
  {
    key: 're-ptrace',
    parentKey: 're-anti',
    title: 'ptrace Self-Debugging Detection',
    type: 'challenge',
    status: 'mastered',
    tags: ['re', 'anti-debug', 'linux'],
    color: null,
  },
  {
    key: 're-angr',
    parentKey: 're-symex',
    title: 'Path Explosion Pruning in angr',
    type: 'technique',
    status: 'none',
    tags: ['re', 'angr', 'symbolic'],
    color: null,
    links: [{ targetKey: 're-z3', label: 'discharges path constraints via Z3' }],
  },
  {
    key: 're-z3',
    parentKey: 're-symex',
    title: 'CFG Recovery & Z3 Solvers',
    type: 'concept',
    status: 'learning',
    tags: ['re', 'z3', 'smt'],
    color: null,
    links: [{ targetKey: 'crypto-lll', label: 'pairs with integer lattice solvers' }],
  },

  // Level 3 under CRYPTO (7)
  {
    key: 'crypto-padding',
    parentKey: 'crypto-sym',
    title: 'CBC Padding Oracle Attack',
    type: 'technique',
    status: 'mastered',
    tags: ['crypto', 'cbc', 'oracle'],
    color: null,
  },
  {
    key: 'crypto-gcm',
    parentKey: 'crypto-sym',
    title: 'AES-GCM Nonce Reuse',
    type: 'challenge',
    status: 'practiced',
    tags: ['crypto', 'aes', 'ghash'],
    color: null,
  },
  {
    key: 'crypto-rsa-e3',
    parentKey: 'crypto-rsa',
    title: 'Small Public Exponent Attack',
    type: 'technique',
    status: 'mastered',
    tags: ['crypto', 'rsa', 'integer-root'],
    color: null,
  },
  {
    key: 'crypto-wiener',
    parentKey: 'crypto-rsa',
    title: 'Wiener Continued Fractions',
    type: 'challenge',
    status: 'practiced',
    tags: ['crypto', 'rsa', 'continued-fractions'],
    color: null,
  },
  {
    key: 'crypto-coppersmith',
    parentKey: 'crypto-rsa',
    title: 'Coppersmith Partial Key Exposure',
    type: 'technique',
    status: 'learning',
    tags: ['crypto', 'rsa', 'coppersmith'],
    color: null,
    links: [{ targetKey: 'crypto-lll', label: 'reduces polynomial roots via LLL' }],
  },
  {
    key: 'crypto-invalid-curve',
    parentKey: 'crypto-ecc',
    title: 'Invalid Curve Point Injection',
    type: 'challenge',
    status: 'learning',
    tags: ['crypto', 'ecc', 'pohlig-hellman'],
    color: null,
  },
  {
    key: 'crypto-lll',
    parentKey: 'crypto-ecc',
    title: 'Lattice Reduction with LLL',
    type: 'concept',
    status: 'practiced',
    tags: ['crypto', 'lattice', 'lll'],
    color: null,
    links: [{ targetKey: 'crypto-coppersmith', label: 'solves small modular roots' }],
  },
]

function makeTextBox(params: {
  x: number
  y: number
  w: number
  z: string
  bg?: string | null
  border?: string | null
  updatedAt: string
  content: TipTapDoc
}): CanvasTextElement {
  return {
    type: 'text',
    x: params.x,
    y: params.y,
    w: params.w,
    z: params.z,
    style: {
      bg: params.bg ?? null,
      border: params.border ?? null,
    },
    content: params.content,
    updatedAt: params.updatedAt,
  }
}

function buildDemoCanvases(
  idByKey: ReadonlyMap<string, string>,
  pathByKey: ReadonlyMap<string, string>,
): Record<string, CanvasJson> {
  const ts = createSeededTimestamp(50)
  const reElfId = idByKey.get('re-elf')!
  const reGotPltId = idByKey.get('re-got-plt')!

  const canvases: Record<string, CanvasJson> = {}

  // Canvas 1 (3 text elements): Ret2win & Calling Conventions
  canvases[pathByKey.get('pwn-ret2win')!] = {
    schema: 1,
    elements: {
      e_pwn00001: makeTextBox({
        x: 80,
        y: 60,
        w: 360,
        z: 'a0',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'System V AMD64 ABI & Stack Alignment' }],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Before calling ' },
                { type: 'text', marks: [{ type: 'code' }], text: 'system()' },
                { type: 'text', text: ' on glibc, ensure ' },
                { type: 'text', marks: [{ type: 'bold' }], text: 'RSP is 16-byte aligned' },
                { type: 'text', text: ' prior to the call instruction.' },
              ],
            },
          ],
        },
      }),
      e_pwn00002: makeTextBox({
        x: 480,
        y: 60,
        w: 380,
        z: 'a1',
        bg: '#fef3c7',
        border: '#d97706',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 3 },
              content: [{ type: 'text', text: 'Minimal ret2win Payload' }],
            },
            {
              type: 'codeBlock',
              attrs: { language: 'python' },
              content: [
                {
                  type: 'text',
                  text: 'payload = b"A" * offset + p64(ret_gadget) + p64(elf.sym.win)',
                },
              ],
            },
          ],
        },
      }),
      e_pwn00003: makeTextBox({
        x: 80,
        y: 260,
        w: 360,
        z: 'a2',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Verify NX enabled vs PIE disabled.' }],
                    },
                  ],
                },
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'text', text: 'Review ' },
                        {
                          type: 'text',
                          marks: [{ type: 'link', attrs: { href: `knovites:${reElfId}` } }],
                          text: 'ELF & PE Internals',
                        },
                        { type: 'text', text: ' for symbol resolution.' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    },
  }

  // Canvas 2 (2 text elements): Return-Oriented Programming
  canvases[pathByKey.get('pwn-rop')!] = {
    schema: 1,
    elements: {
      e_rop00001: makeTextBox({
        x: 100,
        y: 80,
        w: 380,
        z: 'a0',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Two-Stage ROP Chain Checklist' }],
            },
            {
              type: 'orderedList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'text', text: 'Leak libc address via ' },
                        {
                          type: 'text',
                          marks: [{ type: 'link', attrs: { href: `knovites:${reGotPltId}` } }],
                          text: 'GOT & PLT Lazy Binding',
                        },
                        { type: 'text', text: '.' },
                      ],
                    },
                  ],
                },
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Return to main / vulnerable loop.' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
      e_rop00002: makeTextBox({
        x: 520,
        y: 80,
        w: 340,
        z: 'a1',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'blockquote',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }],
                      text: 'Prefer ret2csu only when pop rdi; ret or pop rdx gadgets are absent.',
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    },
  }

  // Canvas 3 (3 text elements): Ghidra P-Code Analysis
  canvases[pathByKey.get('re-ghidra')!] = {
    schema: 1,
    elements: {
      e_rev00001: makeTextBox({
        x: 60,
        y: 60,
        w: 340,
        z: 'a0',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'High P-Code vs Raw P-Code' }],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'italic' }], text: 'Raw P-Code' },
                { type: 'text', text: ' models exact CPU flags, while ' },
                { type: 'text', marks: [{ type: 'underline' }], text: 'High P-Code' },
                { type: 'text', text: ' reflects SSA recovery after dead-flag elimination.' },
              ],
            },
          ],
        },
      }),
      e_rev00002: makeTextBox({
        x: 440,
        y: 60,
        w: 360,
        z: 'a1',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'codeBlock',
              attrs: { language: 'c' },
              content: [
                { type: 'text', text: 'uint64_t hash = (var << 5) + var; // COPY / INT_ADD' },
              ],
            },
          ],
        },
      }),
      e_rev00003: makeTextBox({
        x: 60,
        y: 250,
        w: 340,
        z: 'a2',
        bg: '#e0f2fe',
        border: '#0284c7',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Iterate decompiler tokens via ClangTokenGroup.' }],
            },
          ],
        },
      }),
    },
  }

  // Canvas 4 (2 text elements): Small Public Exponent Attack
  canvases[pathByKey.get('crypto-rsa-e3')!] = {
    schema: 1,
    elements: {
      e_cry00001: makeTextBox({
        x: 90,
        y: 70,
        w: 360,
        z: 'a0',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Hastad Broadcast & Cube Root' }],
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'When ' },
                { type: 'text', marks: [{ type: 'code' }], text: 'm^e < N' },
                {
                  type: 'text',
                  text: ' without padding, RSA reduces to an exact integer e-th root.',
                },
              ],
            },
          ],
        },
      }),
      e_cry00002: makeTextBox({
        x: 490,
        y: 70,
        w: 360,
        z: 'a1',
        updatedAt: ts,
        content: {
          type: 'doc',
          content: [
            {
              type: 'codeBlock',
              attrs: { language: 'python' },
              content: [
                {
                  type: 'text',
                  text: 'm, exact = gmpy2.iroot(ciphertext, 3)\nassert exact is True',
                },
              ],
            },
          ],
        },
      }),
    },
  }

  return canvases
}

/**
 * Curated 40-node CTF/Systems demo knowledge base:
 * - 3 root branches (PWN, RE, CRYPTO), 3 levels deep
 * - Mixed node types, statuses, tags, cross-links, and 4 rich text canvases (no images)
 */
export function createDemoDataset(): DemoDataset {
  const nextId = createSeededUlidGenerator(4242)
  const idByKey = new Map<string, string>()
  const pathByKey = new Map<string, string>()
  const childSlugsByParent = new Map<string | null, string[]>()
  const lastOrderByParent = new Map<string | null, string | null>()

  for (const spec of DEMO_SPECS) {
    idByKey.set(spec.key, nextId())
  }

  for (const spec of DEMO_SPECS) {
    const parentSlugs = childSlugsByParent.get(spec.parentKey) ?? []
    const slug = resolveUniqueSlug(slugify(spec.title), parentSlugs)
    parentSlugs.push(slug)
    childSlugsByParent.set(spec.parentKey, parentSlugs)

    const parentPath = spec.parentKey === null ? null : pathByKey.get(spec.parentKey)!
    pathByKey.set(spec.key, deriveNodePath(parentPath, slug))
  }

  const canvases = buildDemoCanvases(idByKey, pathByKey)
  const entries: TreeBuildEntry[] = []

  for (let i = 0; i < DEMO_SPECS.length; i += 1) {
    const spec = DEMO_SPECS[i]!
    const prevOrder = lastOrderByParent.get(spec.parentKey) ?? null
    const order = generateOrderBetween(prevOrder, null)
    lastOrderByParent.set(spec.parentKey, order)

    const createdAt = createSeededTimestamp(i)
    const path = pathByKey.get(spec.key)!
    const links: NodeJson['links'] = (spec.links ?? []).map((link) => ({
      to: idByKey.get(link.targetKey)!,
      label: link.label,
    }))

    const node: NodeJson = {
      schema: 1,
      id: idByKey.get(spec.key)!,
      title: spec.title,
      type: spec.type,
      status: spec.status,
      tags: [...spec.tags],
      order,
      color: spec.color,
      links,
      createdAt,
      updatedAt: createdAt,
    }

    entries.push({
      path,
      node,
      hasCanvas: path in canvases,
    })
  }

  return {
    manifest: {
      schema: 1,
      title: 'CTF & Systems Knowledge Base',
      createdAt: createSeededTimestamp(0),
    },
    entries,
    canvases,
  }
}

export const DEMO_DATASET: DemoDataset = createDemoDataset()

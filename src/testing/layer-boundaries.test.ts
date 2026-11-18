import fs from 'node:fs'
import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const rootDir = path.resolve(import.meta.dirname, '../..')

async function lintSnippet(relativePath: string, code: string) {
  const eslint = new ESLint({ cwd: rootDir })
  const [result] = await eslint.lintText(code, {
    filePath: path.join(rootDir, relativePath),
  })
  return result?.messages.filter((m) => m.severity === 2) ?? []
}

async function withTempFile(relativePath: string, content: string, fn: () => Promise<void>) {
  const fullPath = path.join(rootDir, relativePath)
  fs.writeFileSync(fullPath, content)
  try {
    await fn()
  } finally {
    fs.rmSync(fullPath, { force: true })
  }
}

describe('ESLint layer boundaries and hard rules', () => {
  it('forbids domain/ from importing React, storage, app, or UI layers', async () => {
    const reactErrors = await lintSnippet(
      'src/domain/tree/sample.ts',
      "import { useState } from 'react'\nexport const x = useState\n",
    )
    expect(reactErrors.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true)

    const appErrors = await lintSnippet(
      'src/domain/tree/sample.ts',
      "import { App } from '@/app/App'\nexport const x = App\n",
    )
    expect(appErrors.some((m) => m.ruleId === 'boundaries/dependencies')).toBe(true)

    const uiErrors = await lintSnippet(
      'src/domain/tree/sample.ts',
      "import { Button } from '@/ui/components/button'\nexport const x = Button\n",
    )
    expect(uiErrors.some((m) => m.ruleId === 'boundaries/dependencies')).toBe(true)

    const domErrors = await lintSnippet(
      'src/domain/tree/sample.ts',
      'export const loc = window.location.href\n',
    )
    expect(domErrors.some((m) => m.ruleId === 'no-restricted-globals')).toBe(true)

    const allowedPureGlobals = await lintSnippet(
      'src/domain/tree/pure.ts',
      [
        'export async function pureHelpers(input: { a: number }) {',
        '  const cloned = structuredClone(input)',
        '  const encoded = new TextEncoder().encode(JSON.stringify(cloned))',
        "  const digest = await crypto.subtle.digest('SHA-256', encoded)",
        '  const now = new Date().toISOString()',
        '  return { digest, now }',
        '}',
        '',
      ].join('\n'),
    )
    expect(allowedPureGlobals).toEqual([])

    await withTempFile('src/storage/__boundary_test__.ts', 'export const db = 1\n', async () => {
      const storageErrors = await lintSnippet(
        'src/domain/tree/sample.ts',
        "import { db } from '@/storage/__boundary_test__'\nexport const x = db\n",
      )
      expect(storageErrors.some((m) => m.ruleId === 'boundaries/dependencies')).toBe(true)
    })
  })

  it('forbids cross-feature imports between features/* while allowing intra-feature imports', async () => {
    await withTempFile(
      'src/features/canvas/__boundary_test__.ts',
      'export const canvasVal = 1\n',
      async () => {
        const crossAliasErrors = await lintSnippet(
          'src/features/map/MapView.tsx',
          "import { canvasVal } from '@/features/canvas/__boundary_test__'\nexport const x = canvasVal\n",
        )
        expect(crossAliasErrors.some((m) => m.ruleId === 'boundaries/dependencies')).toBe(true)

        const crossRelativeErrors = await lintSnippet(
          'src/features/map/MapView.tsx',
          "import { canvasVal } from '../canvas/__boundary_test__'\nexport const x = canvasVal\n",
        )
        expect(crossRelativeErrors.some((m) => m.ruleId === 'boundaries/dependencies')).toBe(true)

        const sameFeatureErrors = await lintSnippet(
          'src/features/canvas/CanvasView.tsx',
          "import { canvasVal } from '@/features/canvas/__boundary_test__'\nexport const x = canvasVal\n",
        )
        expect(sameFeatureErrors).toEqual([])
      },
    )
  })

  it('restricts Dexie to storage/ and Octokit to sync/', async () => {
    const dexieInApp = await lintSnippet(
      'src/app/bad.ts',
      "import Dexie from 'dexie'\nexport const d = Dexie\n",
    )
    expect(dexieInApp.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true)

    const dexieInStorage = await lintSnippet(
      'src/storage/db.ts',
      "import Dexie from 'dexie'\nexport const d = Dexie\n",
    )
    expect(dexieInStorage).toEqual([])

    const octokitInFeature = await lintSnippet(
      'src/features/sync-status/bad.ts',
      "import { Octokit } from 'octokit'\nexport const o = Octokit\n",
    )
    expect(octokitInFeature.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true)

    const octokitInSync = await lintSnippet(
      'src/sync/client.ts',
      "import { Octokit } from 'octokit'\nexport const o = Octokit\n",
    )
    expect(octokitInSync).toEqual([])
  })

  it('forbids dangerouslySetInnerHTML, innerHTML, and explicit any', async () => {
    const dangerous = await lintSnippet(
      'src/app/Unsafe.tsx',
      'export function Unsafe() { return <div dangerouslySetInnerHTML={{ __html: "x" }} /> }\n',
    )
    expect(dangerous.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true)

    const innerHtml = await lintSnippet(
      'src/app/unsafe.ts',
      'export function setHtml(el: HTMLElement) { el.innerHTML = "x" }\n',
    )
    expect(innerHtml.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true)

    const explicitAny = await lintSnippet('src/domain/any.ts', 'export const x: any = 1\n')
    expect(explicitAny.some((m) => m.ruleId === '@typescript-eslint/no-explicit-any')).toBe(true)
  })
})

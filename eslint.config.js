import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const DOMAIN_ALLOWED_EXTERNALS = ['zod', 'fractional-indexing']
const DOMAIN_TEST_ALLOWED_EXTERNALS = ['fast-check', 'vitest']

export default defineConfig([
  globalIgnores(['dist', 'dist-ssr', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      boundaries,
    },
    languageOptions: {
      globals: globals.browser,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain', partialMatch: false },
        { type: 'storage', pattern: 'src/storage', partialMatch: false },
        { type: 'sync', pattern: 'src/sync', partialMatch: false },
        { type: 'app', pattern: 'src/app', partialMatch: false },
        {
          type: 'feature',
          pattern: 'src/features/*',
          capture: ['feature'],
          partialMatch: false,
        },
        { type: 'ui', pattern: 'src/ui', partialMatch: false },
        { type: 'i18n', pattern: 'src/i18n', partialMatch: false },
        { type: 'testing', pattern: 'src/testing', partialMatch: false },
      ],
      'boundaries/files': [
        { pattern: 'src/main.tsx', category: 'entry' },
        { pattern: 'src/domain/**/*.test.ts', category: 'domain-test' },
        { pattern: 'src/**/*.{test,spec}.{ts,tsx}', category: 'test' },
      ],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden by security policy.',
        },
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: 'innerHTML is forbidden by security policy.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tiptap-pro/*', '@tiptap/*-pro', '@tiptap/extension-*pro*'],
              message: 'TipTap Pro extensions are forbidden (MIT/open-source only).',
            },
            {
              group: ['dexie', 'dexie-*'],
              message: 'Dexie may only be imported inside src/storage/.',
            },
            {
              group: ['octokit', '@octokit/*'],
              message: 'Octokit may only be imported inside src/sync/.',
            },
          ],
        },
      ],
      'boundaries/dependencies': [
        'error',
        {
          checkAllOrigins: true,
          default: 'disallow',
          policies: [
            // Every internal module can import within its own layer (except cross-feature)
            {
              from: { element: { type: 'domain' } },
              allow: [
                { to: { element: { type: 'domain' } } },
                {
                  to: {
                    module: { origin: 'external', source: DOMAIN_ALLOWED_EXTERNALS },
                  },
                },
              ],
            },
            {
              from: { element: { type: 'domain' }, file: { categories: 'domain-test' } },
              allow: {
                to: {
                  module: { origin: 'external', source: DOMAIN_TEST_ALLOWED_EXTERNALS },
                },
              },
            },
            {
              from: { element: { type: 'storage' } },
              allow: [
                { to: { element: { types: ['storage', 'domain'] } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'sync' } },
              allow: [
                { to: { element: { types: ['sync', 'storage', 'domain'] } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'ui' } },
              allow: [
                { to: { element: { types: ['ui', 'i18n', 'domain'] } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'i18n' } },
              allow: [
                { to: { element: { type: 'i18n' } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'feature' } },
              allow: [
                {
                  to: {
                    element: [
                      {
                        type: 'feature',
                        captured: { feature: '{{ from.element.captured.feature }}' },
                      },
                      { types: ['app', 'domain', 'ui', 'i18n'] },
                    ],
                  },
                },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'app' } },
              allow: [
                {
                  to: {
                    element: {
                      types: ['app', 'domain', 'storage', 'sync', 'feature', 'ui', 'i18n'],
                    },
                  },
                },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { file: { categories: 'entry' } },
              allow: [
                { to: { element: { types: ['app', 'ui'] } } },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            {
              from: { element: { type: 'testing' } },
              allow: [
                {
                  to: {
                    element: {
                      types: [
                        'testing',
                        'domain',
                        'storage',
                        'sync',
                        'app',
                        'feature',
                        'ui',
                        'i18n',
                      ],
                    },
                  },
                },
                { to: { module: { origin: ['external', 'core'] } } },
              ],
            },
            // Test files across src/ may import testing helpers/fixtures and Node core modules
            {
              from: { file: { categories: 'test' } },
              allow: [
                { to: { element: { type: 'testing' } } },
                { to: { module: { origin: 'core' } } },
              ],
            },
            // Non-test files may never import test files
            {
              from: { file: { categories: '!test' } },
              disallow: { to: { file: { categories: 'test' } } },
              message: 'Production files must not import test files.',
            },
          ],
        },
      ],
    },
  },
  // Pure domain layer: no React, DOM, storage, network, or UI libraries
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'location',
        'history',
        'screen',
        'alert',
        'confirm',
        'prompt',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'EventSource',
        'DOMParser',
        'MutationObserver',
        'ResizeObserver',
        'IntersectionObserver',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/domain/ must remain pure (no React).' },
            { name: 'react-dom', message: 'src/domain/ must remain pure (no React DOM).' },
            { name: 'react-router', message: 'src/domain/ must remain pure (no React Router).' },
            {
              name: 'react-router-dom',
              message: 'src/domain/ must remain pure (no React Router).',
            },
            { name: 'zustand', message: 'src/domain/ must remain pure (no Zustand).' },
            { name: 'lucide-react', message: 'src/domain/ must remain pure (no UI icons).' },
            { name: 'framer-motion', message: 'src/domain/ must remain pure (no Framer Motion).' },
          ],
          patterns: [
            {
              group: [
                'react/*',
                'react-dom/*',
                '@xyflow/*',
                '@tiptap/*',
                '@tiptap-pro/*',
                '@testing-library/*',
              ],
              message: 'src/domain/ must remain pure (no UI/DOM/editor libraries).',
            },
            {
              group: ['dexie', 'dexie-*'],
              message: 'Dexie is forbidden in src/domain/ (allowed only in src/storage/).',
            },
            {
              group: ['octokit', '@octokit/*'],
              message: 'Octokit is forbidden in src/domain/ (allowed only in src/sync/).',
            },
          ],
        },
      ],
    },
  },
  // Storage layer: Dexie is allowed here (keep TipTap Pro & Octokit blocked)
  {
    files: ['src/storage/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tiptap-pro/*', '@tiptap/*-pro', '@tiptap/extension-*pro*'],
              message: 'TipTap Pro extensions are forbidden (MIT/open-source only).',
            },
            {
              group: ['octokit', '@octokit/*'],
              message: 'Octokit may only be imported inside src/sync/.',
            },
          ],
        },
      ],
    },
  },
  // Sync layer: Octokit is allowed here (keep TipTap Pro & Dexie blocked)
  {
    files: ['src/sync/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tiptap-pro/*', '@tiptap/*-pro', '@tiptap/extension-*pro*'],
              message: 'TipTap Pro extensions are forbidden (MIT/open-source only).',
            },
            {
              group: ['dexie', 'dexie-*'],
              message: 'Dexie may only be imported inside src/storage/.',
            },
          ],
        },
      ],
    },
  },
  // Node / E2E / Config files
  {
    files: ['e2e/**/*.{ts,tsx}', '*.config.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // shadcn/ui components export helper variants alongside components
  {
    files: ['src/ui/components/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  eslintConfigPrettier,
])

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ThemeContext,
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemePreference,
} from '@/app/theme-context'

const STORAGE_KEY = 'knovites.theme'

function readStoredTheme(defaultTheme: ThemePreference): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'dark' || raw === 'light' || raw === 'system') {
      return raw
    }
  } catch {
    // Ignore storage errors (e.g. restricted browsing mode)
  }
  return defaultTheme
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: ThemePreference
}

export function ThemeProvider({ children, defaultTheme = 'dark' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme(defaultTheme))
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme
  const prevResolvedRef = useRef<ResolvedTheme | null>(null)

  useEffect(() => {
    const root = document.documentElement
    const isSwitching =
      prevResolvedRef.current !== null && prevResolvedRef.current !== resolvedTheme
    prevResolvedRef.current = resolvedTheme

    if (isSwitching) {
      root.classList.add('theme-switching')
    }

    root.classList.remove('dark', 'light')
    root.classList.add(resolvedTheme)
    root.dataset.theme = resolvedTheme

    if (isSwitching) {
      // Flush style calculation so no half-interpolated theme colors appear
      void window.getComputedStyle(root).backgroundColor
      root.classList.remove('theme-switching')
    }
  }, [resolvedTheme])

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore storage errors
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

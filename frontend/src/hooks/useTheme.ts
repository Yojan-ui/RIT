import { useCallback, useState } from 'react'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'sms.theme'
// Matches --page in each theme, for the mobile browser chrome.
const CHROME: Record<Theme, string> = { dark: '#050505', light: '#ffffff' }

// The dark terminal is the default; light is opt-in and remembered per browser.
export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Sets `data-theme` on <html>, which swaps the palette tokens in index.css. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme])
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    applyTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* private mode: the choice just won't persist */
    }
  }, [])
  return [theme, setTheme]
}

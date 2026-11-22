export const THEME_COOKIE = 'roadmap-theme'
export type ThemeChoice = 'light' | 'dark' | 'system'
export const parseTheme = (v: string | undefined | null): ThemeChoice => (v === 'light' || v === 'dark' ? v : 'system')

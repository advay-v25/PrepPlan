'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { parseTheme } from '../lib/theme/theme'
import { THEME_COOKIE, type ThemeChoice } from '../lib/theme/theme'

const OPTIONS: { id: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { id: 'light', label: 'Light theme', Icon: Sun },
  { id: 'system', label: 'Match this device', Icon: Monitor },
  { id: 'dark', label: 'Dark theme', Icon: Moon },
]

/** Saves the choice in a one-year cookie (the server reads it for first paint) and applies it at once. */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>('system')
  // The server already painted the saved theme on <html>; mirror it into the control after hydration.
  useEffect(() => setChoice(parseTheme(document.documentElement.getAttribute('data-theme'))), [])
  const pick = (next: ThemeChoice) => {
    setChoice(next)
    const root = document.documentElement
    if (next === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', next)
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
  }
  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {OPTIONS.map(({ id, label, Icon }) => (
        <button key={id} type="button" aria-label={label} title={label} aria-pressed={choice === id} onClick={() => pick(id)}><Icon size={15} strokeWidth={1.8} /></button>
      ))}
    </div>
  )
}

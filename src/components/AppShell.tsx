'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, MessageCircle } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { slideDrawer } from '../lib/motion'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type DrawerState = 'closed' | 'open' | 'closing'

const DRAWER_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [drawer, setDrawer] = useState<DrawerState>('closed')
  const drawerRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useIsomorphicLayoutEffect(() => {
    if (!drawerRef.current) return
    if (drawer === 'open') slideDrawer(drawerRef.current, 'in', () => drawerRef.current?.focus())
    if (drawer === 'closing')
      slideDrawer(drawerRef.current, 'out', () => {
        setDrawer('closed')
        menuButtonRef.current?.focus()
      })
  }, [drawer])

  const closeDrawer = () => setDrawer((state) => (state === 'open' ? 'closing' : state))

  // Escape-to-close + a lightweight focus trap while the drawer is open.
  useEffect(() => {
    if (drawer !== 'open') return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDrawer()
        return
      }
      if (e.key !== 'Tab') return

      const container = drawerRef.current
      if (!container) return

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (e.shiftKey) {
        if (active === first || active === container) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [drawer])

  return (
    <div className="app-shell">
      <Sidebar />
      <button
        ref={menuButtonRef}
        className="mobile-menu"
        onClick={() => setDrawer('open')}
        aria-label="Open navigation"
      >
        <Menu size={22} />
      </button>
      {drawer !== 'closed' ? (
        <div className="mobile-nav-layer" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="mobile-nav-scrim" onClick={closeDrawer} />
          <div ref={drawerRef} className="mobile-nav-drawer" tabIndex={-1}>
            <Sidebar compact onClose={closeDrawer} />
          </div>
        </div>
      ) : null}
      <div className="app-content">
        {children}
      </div>
      {/* One click to the Coach from anywhere in the app, rather than a section on each page. */}
      {!pathname?.startsWith('/app/coach') && (
        <Link href="/app/coach" className="coach-fab" aria-label="Ask the Coach">
          <MessageCircle size={18} aria-hidden /> <span>Ask Coach</span>
        </Link>
      )}
    </div>
  )
}

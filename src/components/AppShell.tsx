'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, CalendarDays, ClipboardCheck, Home, Menu, MessageCircle } from 'lucide-react'
import { isNavigationItemActive, PRIMARY_NAVIGATION } from '../lib/routing/registry'
import { Sidebar } from './Sidebar'
import { slideDrawer } from '../lib/motion'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const TABS = [['home', Home], ['calendar', CalendarDays], ['curriculum', BookOpen], ['tests', ClipboardCheck]] as const

type DrawerState = 'closed' | 'open' | 'closing'

const DRAWER_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function AppShell({ children, displayName }: { children: React.ReactNode; displayName?: string | null }) {
  const pathname = usePathname()
  // A live paper (/app/tests/<attempt id>) is a focus surface: no floating launcher, and room for the menu button above the heading.
  const focus = /^\/app\/tests\/[0-9a-f]{8}-[0-9a-f-]{27}\/?$/i.test(pathname ?? '')
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
    <div className={`app-shell${focus ? ' app-shell--focus' : ''}`}>
      <Sidebar displayName={displayName} />
      {/* A live paper keeps the old corner button (no tab bar on a focus surface); everywhere else the tab bar carries navigation. */}
      {focus ? (
        <button type="button" ref={menuButtonRef} className="mobile-menu" onClick={() => setDrawer('open')} aria-label="Open navigation"><Menu size={22} /></button>
      ) : (
        <nav className="tabbar" aria-label="Main">
          {TABS.map(([id, Icon]) => {
            const item = PRIMARY_NAVIGATION.find(n => n.id === id)!
            const active = isNavigationItemActive(pathname ?? '', item)
            return <Link key={id} href={item.href} className={`tabbar__item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={e => { if (active) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) } }}><Icon size={22} strokeWidth={1.8} aria-hidden /><span>{item.label}</span></Link>
          })}
          <button type="button" ref={menuButtonRef} className="tabbar__item" onClick={() => setDrawer('open')} aria-label="Open navigation"><Menu size={22} strokeWidth={1.8} aria-hidden /><span>More</span></button>
        </nav>
      )}
      {drawer !== 'closed' ? (
        <div className="mobile-nav-layer" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="mobile-nav-scrim" onClick={closeDrawer} />
          <div ref={drawerRef} className="mobile-nav-drawer" tabIndex={-1}>
            <Sidebar compact displayName={displayName} onClose={closeDrawer} />
          </div>
        </div>
      ) : null}
      <div className="app-content" key={pathname}>
        {children}
      </div>
      {/* One click to the Coach from anywhere in the app, rather than a section on each page. */}
      {!pathname?.startsWith('/app/coach') && pathname !== '/app' && !pathname?.startsWith('/app/calendar') && !focus && (
        <Link href="/app/coach" className="coach-fab" aria-label="Ask the Coach">
          <MessageCircle size={18} aria-hidden /> <span>Ask Coach</span>
        </Link>
      )}
    </div>
  )
}

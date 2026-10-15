'use client'

import { BookOpen, CalendarDays, ClipboardCheck, Home, LogOut, MessageCircle, PanelLeftClose, Settings } from 'lucide-react'
import { createClient } from '../lib/supabase/client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  isNavigationItemActive,
  PRIMARY_NAVIGATION,
  ROUTES,
  type PrimaryNavigationId,
} from '../lib/routing/registry'

const NAVIGATION_ICONS: Record<PrimaryNavigationId, typeof Home> = {
  home: Home,
  calendar: CalendarDays,
  curriculum: BookOpen,
  tests: ClipboardCheck,
  coach: MessageCircle,
  settings: Settings,
}

const MAIN_NAVIGATION = PRIMARY_NAVIGATION.filter((item) => item.placement === 'main')
const SETTINGS_NAVIGATION = PRIMARY_NAVIGATION.find((item) => item.id === 'settings')!

if (!SETTINGS_NAVIGATION) throw new Error('Settings must be present in primary navigation')

type SidebarProps = {
  compact?: boolean
  onClose?: () => void
}

export function Sidebar({ compact = false, onClose }: SidebarProps) {
  const [name, setName] = useState('Your account')
  useEffect(() => {
    let active = true
    // There is no display-name column on profiles — the only place a name
    // exists is auth metadata, set at signup (email) or by the provider
    // (Google). This used to read a `context.name` field that lived in the
    // pre-rebuild onboarding blob table, which nothing writes to any more, so
    // the sidebar always showed the "Your account" fallback for every user.
    createClient().auth.getUser().then(({ data }) => {
      if (!active) return
      const fullName = data.user?.user_metadata?.full_name || data.user?.user_metadata?.name
      if (typeof fullName === 'string' && fullName.trim()) setName(fullName.trim())
    }).catch(() => {})
    return () => { active = false }
  }, [])
  const pathname = usePathname()
  
  const signOut = async () => { 
    await createClient().auth.signOut(); 
    window.location.assign('/login') 
  }
  
  return (
    <aside className={`sidebar ${compact ? 'sidebar--compact' : ''}`} aria-label="Primary navigation">
      <div className="brand-row">
        <Link href={ROUTES.app.root} className="brand" aria-label="Roadmap home" onClick={() => onClose?.()}>
          <span className="brand-mark"><span /></span>
          <span>Roadmap</span>
        </Link>
        {onClose ? <button className="icon-button mobile-close" onClick={onClose} aria-label="Close navigation"><PanelLeftClose size={20} /></button> : null}
      </div>
      <nav className="nav-list">
        {MAIN_NAVIGATION.map((item) => {
          const Icon = NAVIGATION_ICONS[item.id]
          const isActive = isNavigationItemActive(pathname, item)
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`nav-item ${isActive ? 'is-active' : ''}`}
              onClick={() => onClose?.()}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={20} strokeWidth={1.7} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="sidebar-footer">
        <Link href={ROUTES.app.settings} className="profile-row" onClick={() => onClose?.()} aria-label="Open account settings">
          <span className="avatar">{name.trim().charAt(0).toUpperCase() || 'C'}</span>
          <span><strong>{name}</strong><small>Level I Candidate</small></span>
        </Link>
        <Link
          href={SETTINGS_NAVIGATION.href}
          className={`nav-item ${isNavigationItemActive(pathname, SETTINGS_NAVIGATION) ? 'is-active' : ''}`}
          onClick={() => onClose?.()}
          aria-current={isNavigationItemActive(pathname, SETTINGS_NAVIGATION) ? 'page' : undefined}
        >
          <Settings size={20} strokeWidth={1.7} />
          <span>{SETTINGS_NAVIGATION.label}</span>
        </Link>
        <button className="nav-item sign-out-button" onClick={signOut}><LogOut size={20} strokeWidth={1.7} /><span>Sign out</span></button>
      </div>
    </aside>
  )
}

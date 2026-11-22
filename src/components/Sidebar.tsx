'use client'

import { BookOpen, CalendarDays, ClipboardCheck, Home, LogOut, MessageCircle, PanelLeftClose, Settings } from 'lucide-react'
import { ThemeSwitch } from './ThemeSwitch'
import { signOutThisDevice } from '../lib/auth/signOutThisDevice'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
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
  displayName?: string | null
}

export function Sidebar({ compact = false, onClose, displayName }: SidebarProps) {
  const name = displayName?.trim() || 'Your account'
  const pathname = usePathname()
  const [signingOut,setSigningOut] = useState(false)
  const [signOutFailure,setSignOutFailure] = useState<{ message:string; sessionUnavailable:boolean } | null>(null)
  const signInRef = useRef<HTMLAnchorElement>(null)
  useEffect(()=>{if(signOutFailure?.sessionUnavailable)signInRef.current?.focus()},[signOutFailure])
  const signOut = async () => {
    if(signingOut)return
    setSigningOut(true); setSignOutFailure(null)
    const result=await signOutThisDevice()
    if(!result.ok){setSignOutFailure(result);setSigningOut(false);return}
    window.location.assign('/login')
  }

  return (
    <aside className={`sidebar ${compact ? 'sidebar--compact' : ''}`} aria-label="Primary navigation">
      <div className="brand-row">
        <Link href={ROUTES.app.root} className="brand" aria-label="PrepPlan home" onClick={() => onClose?.()}>
          <span className="brand-mark" aria-hidden="true" />
          <span>PrepPlan</span>
        </Link>
        {onClose ? <button type="button" className="icon-button mobile-close" onClick={onClose} aria-label="Close navigation"><PanelLeftClose size={20} /></button> : null}
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
        <ThemeSwitch />
        <Link href={ROUTES.app.settings} className="profile-row" onClick={() => onClose?.()} aria-label="Open account settings">
          <span className="avatar">{name.trim().charAt(0).toUpperCase() || 'C'}</span>
          <span><strong title={name}>{name}</strong><small>Level I Candidate</small></span>
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
        {signOutFailure && <p className="fine-print" role="alert">{signOutFailure.message}</p>}
        {signOutFailure?.sessionUnavailable ? <Link ref={signInRef} href="/login?next=%2Faccount" className="nav-item">Sign in again</Link> : <button type="button" className="nav-item sign-out-button" onClick={signOut} disabled={signingOut} aria-label={signingOut ? 'Signing out…' : 'Sign out of this device'} title="Sign out of this device"><LogOut size={18} strokeWidth={1.7} /><span>{signingOut ? 'Signing out…' : 'Sign out'}</span></button>}
      </div>
    </aside>
  )
}

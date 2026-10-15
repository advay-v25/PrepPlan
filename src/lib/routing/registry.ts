/**
 * Canonical route registry.
 *
 * Product navigation must use these paths instead of maintaining independent
 * string lists. Legacy redirect routes deliberately do not belong here: the
 * registry describes where a user should be sent now, not every URL the app
 * has ever exposed.
 */

export const ROUTES = {
  marketing: {
    home: '/',
    login: '/login',
    signup: '/signup',
    privacy: '/privacy',
    terms: '/terms',
  },
  onboarding: {
    root: '/onboarding',
    exam: '/onboarding/exam',
    route: '/onboarding/route',
    position: '/onboarding/position',
    week: '/onboarding/week',
    plan: '/onboarding/plan',
  },
  app: {
    root: '/app',
    calendar: '/app/calendar',
    curriculum: '/app/curriculum',
    tests: '/app/tests',
    coach: '/app/coach',
    settings: '/app/settings',
    logLearning: '/app/log',
  }
} as const

export type PrimaryNavigationId =
  | 'home'
  | 'calendar'
  | 'curriculum'
  | 'tests'
  | 'coach'
  | 'settings'

export type PrimaryNavigationItem = {
  id: PrimaryNavigationId
  label: string
  href: string
  placement: 'main' | 'utility'
  exact?: boolean
}

/** The six and only six student-facing primary destinations. */
export const PRIMARY_NAVIGATION: readonly PrimaryNavigationItem[] = [
  { id: 'home', label: 'Home', href: ROUTES.app.root, placement: 'main', exact: true },
  { id: 'calendar', label: 'Calendar', href: ROUTES.app.calendar, placement: 'main' },
  { id: 'curriculum', label: 'Curriculum', href: ROUTES.app.curriculum, placement: 'main' },
  { id: 'tests', label: 'Tests', href: ROUTES.app.tests, placement: 'main' },
  { id: 'coach', label: 'Coach', href: ROUTES.app.coach, placement: 'main' },
  { id: 'settings', label: 'Settings', href: ROUTES.app.settings, placement: 'utility' },
] as const

export function isNavigationItemActive(
  pathname: string,
  item: Pick<PrimaryNavigationItem, 'href' | 'exact'>
): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/**
 * Checks if a path is an authenticated app route.
 */
export function isAppRoute(path: string): boolean {
  return path === ROUTES.app.root || path.startsWith(`${ROUTES.app.root}/`)
}

/**
 * Checks if a path is part of the onboarding flow.
 */
export function isOnboardingRoute(path: string): boolean {
  return path === ROUTES.onboarding.root || path.startsWith(`${ROUTES.onboarding.root}/`)
}

/** Where a completed student may be sent back to after editing a setup section. Nothing else is honoured. */
const RETURN_ALLOWLIST: readonly string[] = [ROUTES.app.settings]

export function safeReturnTo(value: string | null | undefined): string | null {
  return value && RETURN_ALLOWLIST.includes(value) ? value : null
}

/** A link into an onboarding step, optionally in edit mode. Pages and links use this, never raw strings. */
export function onboardingHref(step: 'exam' | 'route' | 'position' | 'week' | 'plan', returnTo?: string): string {
  const base = ROUTES.onboarding[step]
  const safe = safeReturnTo(returnTo)
  return safe ? `${base}?returnTo=${encodeURIComponent(safe)}` : base
}

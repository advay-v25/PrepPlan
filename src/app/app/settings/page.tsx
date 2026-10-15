import { onboardingHref, ROUTES } from '../../../lib/routing/registry'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, CheckCircle2, Clock, GraduationCap, Target } from 'lucide-react'
import { createClient } from '../../../lib/supabase/server'
import { readCanonicalState } from '../../../lib/onboarding/service'
import { ROUTE_OPTIONS } from '../../../lib/onboarding/steps'
import { capacityRange, minutesBetween, weekdayName } from '../../../lib/planning/weekday'
import type { Weekday } from '../../../lib/planning/studyWeek'
import { resolvePulseDay } from '../../../lib/planning/pulse/weekBoundary'
import { Card } from '../../../components/ui/Card'
import { Notice } from '../../../components/ui/Notice'
import { Badge } from '../../../components/ui/Badge'
import { AccountActions } from '../../../components/settings/AccountActions'
import { ClassesCompletedToggle } from '../../../components/settings/ClassesCompletedToggle'

export const dynamic = 'force-dynamic'

/**
 * Where every onboarding answer stays editable.
 *
 * "Every answer is editable forever" needs somewhere to live. This page was a
 * single line of JSX pointing back at /onboarding, which is a large part of why
 * that one route ended up meaning four different things.
 */
export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/settings')

  const state = await readCanonicalState(user.id)
  const p = (state.profile ?? {}) as Record<string, any>
  const route = ROUTE_OPTIONS.find(r => r.value === p.prep_mode)

  const availableSlots = state.availability
  const totalMinutes = availableSlots.reduce((sum: number, a: any) => {
    if (!a.start_time || !a.end_time) return sum
    return sum + Math.max(0, minutesBetween(String(a.start_time).slice(0, 5), String(a.end_time).slice(0, 5)))
  }, 0)
  const range = capacityRange(totalMinutes)
  
  const { data: commitments } = await supabase.from('calendar_commitments').select('*').eq('user_id', user.id).eq('status', 'active')
  const classCount = (commitments ?? []).filter((c: any) => c.kind === 'class').length
  const otherCount = (commitments ?? []).filter((c: any) => c.kind !== 'class').length
  const classWeekdays = (commitments ?? [])
    .filter((c: any) => c.kind === 'class')
    .flatMap((c: any) => (c.weekdays ?? []) as Weekday[])
  const closingDay = resolvePulseDay(classWeekdays)
  
  const started = state.coverage.length
  const sections = [
    {
      icon: Target, title: 'Your exam',
      value: p.exam_sitting && p.exam_year
        ? `${String(p.exam_sitting).replace(/^./, (c: string) => c.toUpperCase())} ${p.exam_year}`
        : 'Not chosen yet',
      badge: p.exam_sitting && p.exam_year
        ? (p.registered ? { label: 'registered', tone: 'success' as const } : { label: 'not registered yet', tone: 'neutral' as const })
        : null,
      detail: 'Changing this rebuilds your roadmap phases around the new date.',
      href: onboardingHref('exam', ROUTES.app.settings),
    },
    {
      icon: GraduationCap, title: 'How you study',
      value: route ? route.label : 'Not chosen yet',
      badge: null,
      detail: classCount
        ? `${classCount} weekly class slot${classCount === 1 ? '' : 's'}. Your classes lead the order of topics.`
        : 'Roadmap decides the order of topics.',
      href: onboardingHref('route', ROUTES.app.settings),
    },
    {
      icon: CheckCircle2, title: 'Where you are',
      value: started > 0 ? `${started} modules marked as started or done` : 'Starting fresh',
      badge: null,
      detail: 'Only a diagnostic can mark something verified. This is context for planning.',
      href: onboardingHref('position', ROUTES.app.settings),
    },
    {
      icon: Clock, title: 'Your week',
      value: availableSlots.length > 0
        ? `${availableSlots.length} slots — roughly ${range.lowHours}–${range.highHours} hours`
        : 'Not set',
      badge: null,
      detail: otherCount
        ? `${otherCount} fixed commitment${otherCount === 1 ? '' : 's'} that study is never scheduled over.`
        : 'Study work is placed inside these windows and nowhere else.',
      href: onboardingHref('week', ROUTES.app.settings),
    },
  ]

  return (
    <div className="page-content settings-page">
      <header className="page-header">
        <div>
          <h1>Your setup</h1>
          <p>
            Everything you told Roadmap, editable as life changes. Nothing here decides access or assigns you
            a number of study hours.
          </p>
        </div>
      </header>

      {p.onboarding_status !== 'complete' && (
        <Notice tone="info">
          Your setup is not finished. <Link href="/onboarding">Pick up where you left off</Link> — or change
          any single section below.
        </Notice>
      )}

      <div className="settings-sections">
        {sections.map(section => {
          const Icon = section.icon
          return (
            <Card key={section.title} className="settings-section">
              <Icon size={18} aria-hidden />
              <div>
                <h2>{section.title}</h2>
                <p className="settings-section__value">
                  {section.value}
                  {section.badge && <Badge tone={section.badge.tone} className="settings-section__badge">{section.badge.label}</Badge>}
                </p>
                <p className="fine-print">{section.detail}</p>
              </div>
              <Link href={section.href} className="secondary-button">Change</Link>
            </Card>
          )
        })}
      </div>

      {(p.prep_mode === 'instructor_led' || p.prep_mode === 'hybrid') && (
        <Card className="settings-section settings-section--standalone">
          <GraduationCap size={18} aria-hidden />
          <div>
            <h2>Classes finished?</h2>
            <ClassesCompletedToggle classesCompletedAt={p.classes_completed_at ?? null} />
          </div>
        </Card>
      )}

      <section className="settings-account">
        <h2>Account</h2>
        <p className="fine-print">Password recovery is available through your account email.</p>
        <Link href="/forgot-password" className="text-button block mb-4">Reset your password</Link>
        <AccountActions />
      </section>
    </div>
  )
}

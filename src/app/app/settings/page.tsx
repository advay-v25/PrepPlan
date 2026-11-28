import { onboardingHref, ROUTES } from '../../../lib/routing/registry'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, CheckCircle2, Clock, GraduationCap, Target } from 'lucide-react'
import { createClient } from '../../../lib/supabase/server'
import { readCanonicalState } from '../../../lib/onboarding/service'
import { ROUTE_OPTIONS } from '../../../lib/onboarding/steps'
import { Card } from '../../../components/ui/Card'
import { Notice } from '../../../components/ui/Notice'
import { Badge } from '../../../components/ui/Badge'
import { ReminderPrefs } from '../../../components/settings/ReminderPrefs'
import { SupportLink } from '../../../components/legal/SupportLink'
import { AccountActions } from '../../../components/settings/AccountActions'
import { needsPassword } from '../../../lib/auth/passwordState'
import { CalendarExport } from '../../../components/calendar/CalendarExport'
import { DisplayNameForm } from '../../../components/settings/DisplayNameForm'
import { ClassesCompletedToggle } from '../../../components/settings/ClassesCompletedToggle'
import { listAppointments, type AppointmentSummary } from '../../../lib/planning/checkpointService'
import { MOCK_KIND_LABEL } from '../../../lib/curriculum/entryContext'
import { addDays, todayInZone } from '../../../lib/planning/studyWeek'

export const metadata = { title: 'Settings' }

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
  const localToday = todayInZone(p.timezone || 'UTC')
  const route = ROUTE_OPTIONS.find(r => r.value === p.prep_mode)

  const availableSlots = state.availability
  // A failed read is "unavailable", never "none".
  const mocksRead = await listAppointments(user.id).then(r => ({ ok: true as const, rows: r.filter(a => a.status === 'planned') })).catch(() => ({ ok: false as const, rows: [] as AppointmentSummary[] }))
  const mockSchedule = mocksRead.rows
  const commitmentsRead = await supabase.from('calendar_commitments').select('*').eq('user_id', user.id).eq('status', 'active')
  const commitments = commitmentsRead.error ? null : commitmentsRead.data
  const classCount = (commitments ?? []).filter((c: any) => c.kind === 'class').length
  const otherCount = (commitments ?? []).filter((c: any) => c.kind !== 'class').length

  // `state.coverage` is TOPIC exposure the student reported (self-report), not modules and not evidence.
  const reportedTopics = state.coverage.length
  const sections = [
    {
      icon: Target, title: 'Exam date', action: 'Edit exam date',
      value: p.exam_sitting && p.exam_year
        ? `${String(p.exam_sitting).replace(/^./, (c: string) => c.toUpperCase())} ${p.exam_year}`
        : 'Not chosen yet',
      badge: p.exam_sitting && p.exam_year
        ? (p.registered ? { label: 'registered', tone: 'success' as const } : { label: 'not registered yet', tone: 'neutral' as const })
        : null,
      detail: `${p.registered && p.exam_date ? `Booked for ${p.exam_date}. ` : p.exam_sitting ? 'Target month only, no booked date yet. ' : ''}Changing this rebuilds your roadmap phases around the new date.`,
      href: onboardingHref('exam', ROUTES.app.settings),
      examHref: '/app/exam',
    },
    {
      icon: GraduationCap, title: 'Study style and classes', action: 'Edit study style',
      value: route ? route.label : 'Not chosen yet',
      badge: null,
      detail: classCount
        ? `${classCount} weekly class slot${classCount === 1 ? '' : 's'}. Changing the class schedule can change when your next review happens and what comes next.`
        : commitments === null ? 'Your classes could not be loaded right now; reload to try again.' : 'Adding classes can change the study order and review dates for future weeks.',
      href: onboardingHref('route', ROUTES.app.settings),
    },
    {
      icon: CheckCircle2, title: 'Starting point', action: 'Edit starting point',
      value: reportedTopics > 0 ? `${reportedTopics} topic${reportedTopics === 1 ? '' : 's'} you reported as covered or in progress` : 'Nothing reported yet',
      badge: null,
      detail: p.mock_date
        ? `Self-report: it orders your plan and never counts as evidence; only a scored paper does. This is context for planning. Your next mock is on ${p.mock_date}; your whole mock schedule (it can hold several) lives in Calendar, and this is the same schedule.`
        : 'Self-report: it orders your plan and never counts as evidence; only a scored paper does.',
      href: onboardingHref('position', ROUTES.app.settings),
    },
    {
      icon: Clock, title: 'Study time', action: 'Edit study time',
      value: availableSlots.length > 0 ? `${availableSlots.length} study window${availableSlots.length === 1 ? '' : 's'}${p.max_session_minutes ? ` · sittings up to ${p.max_session_minutes} min` : ''}` : 'Not set',
      badge: null,
      detail: commitments === null
        ? 'Your fixed commitments could not be loaded right now. They are not gone; reload to try again.'
        : `Windows are when work MAY be placed, not a weekly target. ${otherCount ? `${otherCount} fixed commitment${otherCount === 1 ? '' : 's'} that study is never scheduled over.` : 'Study work is placed inside these windows and nowhere else.'} Changing them does not move accepted work; Calendar shows what needs a reviewed adjustment.`,
      href: onboardingHref('week', ROUTES.app.settings),
      roadmapHref: '/app/curriculum?view=roadmap',
    },
  ]

  return (
    <main className="page-content settings-page">
      <header className="page-header">
        <div>
          <h1>Your setup</h1>
          <p>
            Everything you told PrepPlan. Change it any time.
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
                {section.roadmapHref && <Link className="text-button" href={section.roadmapHref}>See how your time shapes the roadmap</Link>}
                {section.examHref && <Link className="text-button" href={section.examHref}>Exam status and retake</Link>}
              </div>
              <Link href={section.href} className="secondary-button">{section.action}</Link>
            </Card>
          )
        })}
      </div>

      <Card className="settings-section settings-section--standalone" data-reminders>
        <Clock size={18} aria-hidden />
        <div><h2>Reminders</h2><ReminderPrefs /></div>
      </Card>

      {!mocksRead.ok && <Notice tone="info">Your mock schedule could not be loaded right now. It is not gone; reload to try again.</Notice>}
      {mockSchedule.length > 0 && (
        <Card className="settings-section settings-section--standalone" data-mock-schedule>
          <CheckCircle2 size={18} aria-hidden />
          <div>
            <h2>Your mocks and rehearsals</h2>
            <p className="fine-print">This is the same schedule Calendar, Home, Tests and your roadmap use. Open one to edit, move or cancel it.</p>
            <ul>{mockSchedule.map(a => <li key={a.id} data-appointment={a.id}><Link href={a.href}>{a.title}</Link> — {a.date}{a.startTime ? ` ${a.startTime}` : ''} ({MOCK_KIND_LABEL[a.kind]}){a.designated ? ' · counts for its week' : ''}</li>)}</ul>
          </div>
          <Link href="/app/calendar#checkpoint" className="secondary-button">Open schedule</Link>
        </Card>
      )}

      {(p.prep_mode === 'instructor_led' || p.prep_mode === 'hybrid') && (
        <Card className="settings-section settings-section--standalone">
          <GraduationCap size={18} aria-hidden />
          <div>
            <h2>Classes finished?</h2>
            <ClassesCompletedToggle classesCompletedAt={p.classes_completed_at ?? null} />
          </div>
        </Card>
      )}

      <Card className="settings-section settings-section--standalone" data-calendar-export-card>
        <CalendarDays size={18} aria-hidden />
        <div><h2>Download your calendar</h2><CalendarExport initialFrom={localToday} initialTo={addDays(localToday,34)} /></div>
      </Card>

      <section className="settings-account">
        <h2>Account</h2>
        <DisplayNameForm initial={p.display_name ?? ''} />
        <p className="fine-print">Email: {user.email} (changed through sign-in, not here).</p>
        <p className="fine-print">Password recovery is available through your account email.</p>
        <Link href="/forgot-password" className="text-button block mb-4">{needsPassword(user) ? 'Add a password by email' : 'Reset your password'}</Link>
        <AccountActions email={user.email ?? ''} />
        <p className="fine-print" data-support>Help, privacy questions or a problem with your account: <SupportLink subject="PrepPlan support" />. See the <Link href="/privacy">privacy</Link> and <Link href="/terms">terms</Link> drafts.</p>
      </section>
    </main>
  )
}

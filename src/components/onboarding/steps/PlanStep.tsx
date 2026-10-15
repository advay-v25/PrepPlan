'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Pencil } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Notice } from '../../ui/Notice'
import { onboardingHref } from '../../../lib/routing/registry'
import { STARTING_STAGES } from '../../../lib/onboarding/steps'
import { ROUTE_OPTIONS } from '../../../lib/onboarding/steps'
import { weekdayName, weekdayShort } from '../../../lib/planning/weekday'
import type { OnboardingState, WindowInfo } from '../OnboardingShell'

type Task = { id: string; title: string; duration_minutes: number; task_type: string; local_date: string; placement: string }
type SkippedModule = { moduleId: string; name: string; purpose: 'diagnostic' | 'revisionary'; available: number; required: number }
type PaperInfo = { kind: 'paper' | 'none'; reason: 'no_scope' | 'insufficient_bank' | 'below_minimum_paper' | null; skipped: SkippedModule[] }
type Preview = { draftId: string; revision: number; tasks: Task[]; paper: PaperInfo; cycle: { start: string; end: string }; closingDay: number; classLed: boolean }

/** Why no paper this week, in the student's terms — grounded in the actual reason the planner gave, not a guess. */
function paperExplanation(paper: PaperInfo | undefined): string {
  if (!paper || paper.kind === 'paper') return ''
  if (paper.reason === 'no_scope') return 'Nothing new or revisited is placed yet this week, so there is nothing for a paper to check.'
  if (paper.reason === 'insufficient_bank' && paper.skipped.length > 0) {
    const worst = paper.skipped[0]
    return `The question bank does not yet have enough reviewed questions for this week's material — ${worst.name} needs ${worst.required}, and ${worst.available} ${worst.available === 1 ? 'is' : 'are'} ready.`
  }
  if (paper.reason === 'below_minimum_paper') return "This week's material clears the bank check but is too small to make a worthwhile paper on its own."
  return 'The question bank does not yet support a paper for this week\'s material.'
}

const HOURS = (t: unknown) => String(t ?? '').slice(0, 5)
const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const daysBetween = (a: string, b: string) => {
  const out: string[] = []
  for (let d = new Date(`${a}T00:00:00Z`); d <= new Date(`${b}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10))
  return out
}
const dateLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

function Row({ label, value, hint, step }: { label: string; value: React.ReactNode; hint?: string; step: 'exam' | 'route' | 'position' | 'week' }) {
  return (
    <Card padding="tight" className="ob-review__row">
      <span><small>{label}</small><strong>{value}</strong>{hint && <em className="ob-review__hint">{hint}</em>}</span>
      <Link className="text-button" href={onboardingHref(step)} aria-label={`Edit ${label.toLowerCase()}`}><Pencil size={13} aria-hidden /> Edit</Link>
    </Card>
  )
}

/**
 * Review, then start. Shows what Roadmap assumed, the cycle it derived, and the actual first week, and says
 * plainly that week one is a calibration week. An empty week is explained, never silently accepted.
 */
export function PlanStep({
  state, windows, onChange,
}: {
  state: OnboardingState
  windows: WindowInfo[]
  onChange: (payload: Record<string, unknown>, continueAllowed?: boolean, reason?: string | null) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/onboarding/plan/preview', { method: 'POST' })
        const data = await res.json()
        if (!data.ok) throw new Error(data.message || data.error || 'Could not build the preview')
        if (cancelled) return
        setPreview(data.data)
        onChange({ draftId: data.data.draftId, expectedRevision: data.data.revision }, true)
      } catch (err: any) {
        if (cancelled) return
        setError(err.message)
        onChange({}, false, 'Could not build the preview')
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [onChange])

  const p = state.profile
  const sitting = windows.find(w => w.id === p?.exam_window_id)
  const route = ROUTE_OPTIONS.find(r => r.value === p?.prep_mode)
  const stage = STARTING_STAGES.find(s => s.value === p?.stage)
  const marked = (state.coverage ?? []).length
  const mode = p?.week_availability_mode as string | null | undefined
  const noWindows = (state.availability ?? []).length === 0

  const classSlots = useMemo(() => (state.commitments ?? [])
    .filter(c => c.kind === 'class' && (c as any).recurrence !== 'none')
    .map(c => ({ label: String(c.label || 'Class'), weekdays: (c.weekdays as number[]) ?? [], start: HOURS(c.start_time), end: HOURS(c.end_time) })), [state.commitments])

  if (loading) {
    return (
      <div className="ob-section ob-loading" role="status">
        <Loader2 className="animate-spin" size={28} aria-hidden />
        <p>Building your first week…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="ob-section">
        <Notice tone="danger" role="alert">{error}</Notice>
        <p className="fine-print">Your answers are saved. Try again, or edit a step above.</p>
        <button className="secondary-button" onClick={() => window.location.reload()}>Try again</button>
      </div>
    )
  }

  const days = preview ? daysBetween(preview.cycle.start, preview.cycle.end) : []
  const tasks = preview?.tasks ?? []
  const byDay = (d: string) => tasks.filter(t => t.local_date === d)
  const unplaced = tasks.filter(t => !t.local_date || !days.includes(t.local_date))
  const registered = !!p?.registered

  return (
    <div className="ob-section">
      <Notice tone="info">Week one is a calibration week. It is built from your estimates, and your first paper replaces them with evidence.</Notice>

      <div className="ob-review mt-6">
        <Row step="exam" label="Exam" value={<>{sitting ? `${sitting.sitting.replace(/^./, c => c.toUpperCase())} ${sitting.year}` : 'Not chosen'}{registered && p?.exam_date ? ` · booked ${dateLabel(String(p.exam_date))}` : ' · target month'}</>} />
        <Row step="route" label="Preparation" value={<>{route?.label ?? '—'}{state.hasClasses ? ` · ${classSlots.map(c => `${c.weekdays.map(weekdayShort).join('/')} ${c.start}–${c.end}`).join(', ')}` : ''}</>} />
        <Row step="position" label="Starting point" value={<>{stage?.label ?? '—'}{marked ? ` · ${marked} topic${marked === 1 ? '' : 's'} marked` : ''}</>} hint="Your estimate. Tests will update this." />
        <Row step="week" label="Study windows" value={
          mode && mode !== 'windows' ? (mode === 'varies' ? 'Changes every week' : 'Cannot schedule this week')
            : `${(state.availability ?? []).length} window${(state.availability ?? []).length === 1 ? '' : 's'} · sittings up to ${p?.max_session_minutes} min`} />
      </div>

      {preview && (
        <p className="ob-derived">
          Your first cycle runs <strong>{dateLabel(preview.cycle.start)}</strong> to <strong>{dateLabel(preview.cycle.end)}</strong>, with the paper on{' '}
          <strong>{weekdayName(preview.closingDay as never)}</strong>{preview.classLed ? ', before your next class' : ''}.
          {!preview.classLed && state.profile?.class_pattern === 'variable' ? ' This is provisional until you add your next class in Calendar.' : ''}
        </p>
      )}

      <h2 className="ob-subhead mt-8">Your first week</h2>
      {tasks.length === 0 ? (
        <Notice tone="warn">
          {noWindows
            ? <>No study is scheduled yet because you have not given Roadmap any study windows. Finish setup and Calendar will open with one next step: add this week’s availability. <Link href={onboardingHref('week')}>Add windows now</Link></>
            : <>Nothing fits this week’s windows yet. Widen a window, or finish setup and adjust in Calendar. <Link href={onboardingHref('week')}>Edit windows</Link></>}
        </Notice>
      ) : (
        <ol className="ob-weekpreview">
          {days.map(d => {
            const classToday = classSlots.filter(c => c.weekdays.includes(dayOf(d)))
            const list = byDay(d)
            return (
              <li key={d} className="ob-weekpreview__day">
                <strong>{dateLabel(d)}{d === preview?.cycle.end ? ' · paper day' : ''}</strong>
                {classToday.map((c, i) => <span key={`c${i}`} className="ob-block ob-block--class">Class {c.start}–{c.end}</span>)}
                {list.map(t => <span key={t.id} className={`ob-block ob-block--${t.task_type === 'diagnostic' ? 'paper' : 'study'}`}>{t.title} · {t.duration_minutes} min</span>)}
                {d === preview?.cycle.end && !list.some(t => t.task_type === 'diagnostic') && (
                  <span className="fine-print">No paper is scheduled yet. {paperExplanation(preview?.paper)}</span>
                )}
                {classToday.length + list.length === 0 && d !== preview?.cycle.end && <span className="fine-print">Nothing planned</span>}
              </li>
            )
          })}
        </ol>
      )}
      {unplaced.length > 0 && <p className="fine-print">{unplaced.length} task{unplaced.length === 1 ? '' : 's'} belong to this week but have no day yet. Calendar keeps them unplaced rather than guessing a time.</p>}
    </div>
  )
}

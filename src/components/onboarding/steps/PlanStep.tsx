'use client'

import { formatStudyDate } from '../../../lib/format/date'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Pencil, RefreshCw } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Notice } from '../../ui/Notice'
import { Button } from '../../ui/Button'
import { onboardingHref, ROUTES } from '../../../lib/routing/registry'
import { STARTING_STAGES, ROUTE_OPTIONS } from '../../../lib/onboarding/steps'
import { nextClassFrom } from '../../../lib/onboarding/classDisplay'
import { groupSittings } from '../../../lib/onboarding/sittingGroups'
import { ASSESSMENT_AVAILABILITY_HREF, ASSESSMENT_STAGE_LABEL, PAPER_UNAVAILABLE_BANK, PAPER_UNAVAILABLE_THIN, stageFromPlannedPaper } from '../../../lib/tests/assessmentStage'
import { weekdayName, weekdayShort } from '../../../lib/planning/weekday'
import type { OnboardingState, WindowInfo } from '../OnboardingShell'

type Task = { id: string; title: string; duration_minutes: number; task_type: string; local_date: string; placement: string }
type SkippedModule = { moduleId: string; name: string; purpose: 'diagnostic' | 'revisionary'; available: number; required: number }
type PaperInfo = { kind: 'paper' | 'none'; reason: 'no_scope' | 'insufficient_bank' | 'below_minimum_paper' | 'mock_chosen' | null; skipped: SkippedModule[] }
type Preview = { draftId: string; revision: number; tasks: Task[]; paper: PaperInfo; cycle: { start: string; end: string }; closingDay: number; classLed: boolean; initialCycle: { advanced: boolean; reason: string; note: string | null } | null }

/** The reason there is no paper this week, in the student's terms, grounded in what the planner actually decided. */
function paperExplanation(paper: PaperInfo | undefined): string {
  if (!paper || paper.kind === 'paper') return ''
  if (paper.reason === 'no_scope') return 'Nothing is placed yet, so the week ends with a checkpoint. Calendar can add a paper once you have finished and confirmed some work.'
  if (paper.reason === 'insufficient_bank' && paper.skipped.length > 0) {
    const worst = paper.skipped[0]
    return `${PAPER_UNAVAILABLE_BANK} ${worst.name} needs ${worst.required} checked questions and ${worst.available} ${worst.available === 1 ? 'is' : 'are'} ready. You can still plan and study it.`
  }
  if (paper.reason === 'below_minimum_paper') return PAPER_UNAVAILABLE_THIN
  if (paper.reason === 'mock_chosen') return 'Your mock stands in for this week’s paper.'
  return PAPER_UNAVAILABLE_BANK
}

const HOURS = (t: unknown) => String(t ?? '').slice(0, 5)
const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const daysBetween = (a: string, b: string) => {
  const out: string[] = []
  for (let d = new Date(`${a}T00:00:00Z`); d <= new Date(`${b}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10))
  return out
}
const dateLabel = (iso: string) => formatStudyDate(iso, 'short')
const cap = (s: string) => s.replace(/^./, c => c.toUpperCase())

/** Technical failures never reach the student: a preview that cannot be built says what is true and what to do. */
const FRIENDLY = 'We could not prepare your first week just now. Your answers are saved. Rebuild the preview to try again.'

function Row({ label, value, hint, step }: { label: string; value: React.ReactNode; hint?: React.ReactNode; step: 'exam' | 'route' | 'position' | 'week' }) {
  return (
    <Card padding="tight" className="ob-review__row">
      <span><small>{label}</small><strong>{value}</strong>{hint && <em className="ob-review__hint">{hint}</em>}</span>
      {/* returnTo brings an edit straight back here, instead of walking forward through the remaining steps. */}
      <Link className="text-button" href={onboardingHref(step, ROUTES.onboarding.plan)} aria-label={`Edit ${label.toLowerCase()}`}><Pencil size={13} aria-hidden /> Edit</Link>
    </Card>
  )
}

/**
 * Review, then start. Shows what Roadmap assumed, the cycle it derived, and the actual first week, and says
 * plainly that week one is a calibration week. An empty week is explained, never silently accepted.
 *
 * The shell only lets the student accept while this reports a ready draft: building, failed and invalidated
 * previews all switch acceptance off and offer Rebuild preview instead.
 */
export function PlanStep({
  state, windows, onChange, rebuildKey, invalid, onRebuild,
}: {
  state: OnboardingState
  windows: WindowInfo[]
  onChange: (payload: Record<string, unknown>, continueAllowed?: boolean, reason?: string | null) => void
  rebuildKey: number
  invalid: boolean
  onRebuild: () => void
}) {
  const [status, setStatus] = useState<'building' | 'ready' | 'failed'>('building')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('building'); setError('')
    onChange({}, false, 'Preparing your first week…')
    ;(async () => {
      try {
        const res = await fetch('/api/onboarding/plan/preview', { method: 'POST' })
        const data = await res.json()
        if (!data.ok) throw new Error(FRIENDLY)
        if (cancelled) return
        setPreview(data.data); setStatus('ready')
        onChange({ draftId: data.data.draftId, expectedRevision: data.data.revision }, true)
      } catch {
        if (cancelled) return
        setError(FRIENDLY); setStatus('failed')
        onChange({}, false, 'Rebuild the preview to continue')
      }
    })()
    return () => { cancelled = true }
  }, [onChange, rebuildKey, retry])

  const p = state.profile
  const sitting = windows.find(w => w.id === p?.exam_window_id)
  const route = ROUTE_OPTIONS.find(r => r.value === p?.prep_mode)
  const stage = STARTING_STAGES.find(s => s.value === p?.stage)
  const marked = (state.coverage ?? []).length
  const revisit = (state.entry?.uncertainty ?? []).filter(u => u.level !== 'none').length
  const mock = state.entry?.mock ?? null
  const mode = p?.week_availability_mode as string | null | undefined
  const noWindows = (state.availability ?? []).length === 0
  const registered = !!p?.registered

  const recurring = useMemo(() => (state.commitments ?? [])
    .filter(c => c.kind === 'class' && (c as any).recurrence !== 'none')
    .map(c => ({ label: String(c.label || 'Class'), weekdays: (c.weekdays as number[]) ?? [], start: HOURS(c.start_time), end: HOURS(c.end_time) })), [state.commitments])
  const oneOff = useMemo(() => nextClassFrom(state), [state])
  const variable = p?.class_pattern === 'variable'
  const days = preview ? daysBetween(preview.cycle.start, preview.cycle.end) : []
  const tasks = preview?.tasks ?? []

  const classSummary = recurring.length > 0
    ? recurring.map(c => `${c.weekdays.map(weekdayShort).join('/')} ${c.start}–${c.end}`).join(', ')
    : null
  // Whether the saved classes decided the first cycle, in the student's terms.
  const classHint = !state.hasClasses && !oneOff ? null
    : recurring.length > 0 ? 'Your weekly classes set the length of your cycle; the paper sits before the next class.'
    : oneOff && preview ? (preview.classLed ? 'This class sets the end of your first cycle: the paper is placed the day before it.' : 'This class is saved but did not set the first cycle, so the first cycle is a provisional Monday to Sunday week.')
    : null

  const assessment = stageFromPlannedPaper(preview?.paper)
  const grouped = useMemo(() => groupSittings(tasks), [tasks])

  if (status === 'building') {
    return (
      <div className="ob-section ob-loading" role="status">
        <Loader2 className="animate-spin" size={28} aria-hidden />
        <p>Building your first week…</p>
      </div>
    )
  }

  const rebuildButton = (
    <Button variant="secondary" onClick={invalid ? onRebuild : () => setRetry(n => n + 1)}>
      <RefreshCw size={15} aria-hidden /> Rebuild preview
    </Button>
  )
  if (status === 'failed') {
    return (
      <div className="ob-section">
        <Notice tone="danger" role="alert">{error}</Notice>
        <p className="fine-print">Nothing has been started. You can also edit a step from the list on the left.</p>
        {rebuildButton}
      </div>
    )
  }

  return (
    <div className="ob-section">
      {invalid && (
        <Notice tone="warn" role="alert">
          This preview can no longer be accepted: your setup changed after it was prepared. Rebuild it to see your current plan; your saved answers are kept.
          <div className="mt-4">{rebuildButton}</div>
        </Notice>
      )}
      <Notice tone="info">Week one is a calibration week. It is built from your estimates. Your coverage stays an estimate until a paper or other evidence confirms it.</Notice>

      <div className="ob-review mt-6">
        <Row step="exam" label="Exam" value={registered && p?.exam_date
          ? <>Booked {dateLabel(String(p.exam_date))} {String(p.exam_date).slice(0, 4)}<small> · {sitting ? `${cap(sitting.sitting)} ${sitting.year}` : 'sitting not chosen'}</small></>
          : <>{sitting ? `${cap(sitting.sitting)} ${sitting.year}` : 'Not chosen'}<small> · target month, not booked</small></>} />
        <Row step="route" label="Preparation" value={<>{route?.label ?? '—'}{classSummary ? ` · ${classSummary}` : ''}</>}
          hint={<>
            {oneOff && <span className="block">Next class: {dateLabel(oneOff.date)}, {oneOff.startTime}–{oneOff.endTime}{oneOff.label ? ` (${oneOff.label})` : ''}</span>}
            {classHint && <span className="block">{classHint}</span>}
            {variable && !oneOff && <span className="block">No next class yet, so the first cycle is a provisional Monday to Sunday week. After setup, use <Link className="prose-link" href={`${ROUTES.app.calendar}?action=add-next-class`}>Add next class in Calendar</Link> to anchor it to your classes.</span>}
          </>} />
        <Row step="position" label="Starting point" value={<>{stage?.label ?? '—'}{marked ? ` · ${marked} topic${marked === 1 ? '' : 's'} marked` : ''}{revisit ? ` · ${revisit} to revisit` : ''}{mock ? ` · mock ${dateLabel(String(mock.date))}` : ''}</>} hint="Your estimate. Tests will update this." />
        <Row step="week" label="Study windows" value={
          mode && mode !== 'windows' ? (mode === 'varies' ? 'Changes every week' : 'None given yet')
            : `${(state.availability ?? []).length} window${(state.availability ?? []).length === 1 ? '' : 's'} · sittings up to ${p?.max_session_minutes} min`}
          hint={noWindows ? `A ${p?.max_session_minutes ?? 90}-minute sitting length is used until you add windows, so work can still be split sensibly later.` : undefined} />
      </div>

      {preview?.initialCycle?.note && <Notice tone="info" role="status">{preview.initialCycle.note}</Notice>}
      {preview && (
        <p className="ob-derived">
          Your first cycle runs <strong>{dateLabel(preview.cycle.start)}</strong> to <strong>{dateLabel(preview.cycle.end)}</strong>, closing on{' '}
          <strong>{weekdayName(preview.closingDay as never)}</strong>{preview.classLed ? ', before your next class' : ''}.
          {!preview.classLed && p?.class_pattern === 'variable' ? ' This is provisional until you add your next class in Calendar.' : ''}
        </p>
      )}

      <Card padding="tight" className="ob-assessment" role="status">
        <small>{ASSESSMENT_STAGE_LABEL[assessment]}</small>
        <p>
          {assessment === 'scheduled_paper' && <>A paper is scheduled for {preview ? dateLabel(preview.cycle.end) : 'the last day'}. It tests only the work you finish and confirm that week, and it does not replace your estimates by itself.</>}
          {assessment !== 'scheduled_paper' && paperExplanation(preview?.paper)}
          {assessment === 'unavailable_coverage' && <> <Link className="prose-link" href={ASSESSMENT_AVAILABILITY_HREF}>View assessment availability</Link> · <Link className="prose-link" href={`${ROUTES.app.calendar}`}>Plan around it in Calendar</Link></>}
        </p>
      </Card>

      <h2 className="ob-subhead mt-8">Your first week</h2>
      {tasks.length === 0 ? (
        <Notice tone="warn">
          {noWindows
            ? <>No study is scheduled because you have not given Roadmap any study windows. That is a valid way to finish setup: Calendar will open with this week accepted and empty, and one clear step to add availability. <Link className="prose-link" href={onboardingHref('week', ROUTES.onboarding.plan)}>Add windows now</Link></>
            : <>Nothing fits this week’s windows yet. Widen a window, or finish setup and adjust in Calendar. <Link className="prose-link" href={onboardingHref('week', ROUTES.onboarding.plan)}>Edit windows</Link></>}
        </Notice>
      ) : (
        <ol className="ob-weekpreview">
          {days.map(d => {
            const classToday = recurring.filter(c => c.weekdays.includes(dayOf(d)))
            const list = grouped.filter(g => g.date === d)
            const hasPaper = tasks.some(t => t.local_date === d && t.task_type === 'diagnostic')
            return (
              <li key={d} className="ob-weekpreview__day">
                <strong>{dateLabel(d)}{d === preview?.cycle.end ? ` · ${assessment === 'scheduled_paper' ? 'paper day' : 'checkpoint day'}` : ''}</strong>
                {classToday.map((c, i) => <span key={`c${i}`} className="ob-block ob-block--class">Class {c.start}–{c.end}</span>)}
                {oneOff && oneOff.date === d && <span className="ob-block ob-block--class">Class {oneOff.startTime}–{oneOff.endTime}</span>}
                {list.map(g => g.items.length === 1
                  ? <span key={g.key} className={`ob-block ob-block--${g.paper ? 'paper' : 'study'}`}>{g.title} · {g.minutes} min</span>
                  : (
                    <details key={g.key} className="ob-block ob-block--study">
                      <summary>{g.title} · {g.items.length} sittings · {g.minutes} min</summary>
                      <ul className="fine-print">{g.items.map(t => <li key={t.id}>{t.title} · {t.duration_minutes} min</li>)}</ul>
                    </details>
                  ))}
                {d === preview?.cycle.end && !hasPaper && <span className="fine-print">No paper is scheduled yet. {paperExplanation(preview?.paper)}</span>}
                {classToday.length + list.length === 0 && !(oneOff && oneOff.date === d) && d !== preview?.cycle.end && <span className="fine-print">Nothing planned</span>}
              </li>
            )
          })}
        </ol>
      )}
      {preview && tasks.some(t => !t.local_date || !days.includes(t.local_date)) && (
        <p className="fine-print">{tasks.filter(t => !t.local_date || !days.includes(t.local_date)).length} task(s) belong to this week but have no day yet. Calendar keeps them unplaced rather than guessing a time.</p>
      )}
    </div>
  )
}

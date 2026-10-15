'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, TrendingDown, TrendingUp } from 'lucide-react'
import { STEPS, STEP_META, nextStep, previousStep, type Step } from '../../lib/onboarding/steps'
import { ROUTES, onboardingHref } from '../../lib/routing/registry'
import { weekdayName } from '../../lib/planning/weekday'
import type { Weekday } from '../../lib/planning/studyWeek'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { Card } from '../ui/Card'

type PlanImpact = {
  cycleChanged: boolean
  before: { start: string; end: string; paperDay: Weekday }
  after: { start: string; end: string; paperDay: Weekday }
  capacityDeltaMinutes: number
  overflowDays: { date: string; scheduledMinutes: number; newCapacityMinutes: number }[]
}

/** Whether an impact is worth a whole screen, or the edit changed nothing this matters for. */
function isNotable(impact: PlanImpact | null | undefined): impact is PlanImpact {
  return !!impact && (impact.cycleChanged || impact.capacityDeltaMinutes !== 0 || impact.overflowDays.length > 0)
}
import { ExamStep } from './steps/ExamStep'
import { RouteStep } from './steps/RouteStep'
import { PositionStep } from './steps/PositionStep'
import { WeekStep } from './steps/WeekStep'
import { PlanStep } from './steps/PlanStep'

export type { OnboardingState } from '../../lib/onboarding/state'
import type { OnboardingState } from '../../lib/onboarding/state'

export type TopicInfo = { id: string; name: string; weightMin: number; weightMax: number; summary: string }
export type WindowInfo = { id: string; year: number; sitting: string; opens: string | null; confirmed: boolean }

/**
 * The frame every onboarding screen sits in.
 *
 * Each step owns its own payload and posts it to `/api/onboarding/[step]`, which
 * writes rows. The shell only handles navigation and the shared chrome, so no
 * single component carries all six screens' state — which is what made the old
 * flow impossible to link into.
 */
export function OnboardingShell({
  step, state, windows, topics, returnTo = null,
}: {
  step: Step
  returnTo?: string | null
  state: OnboardingState
  windows: WindowInfo[]
  topics: TopicInfo[]
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  const [canContinue, setCanContinue] = useState(true)
  const [continueReason, setContinueReason] = useState<string | null>(null)
  // Set only when an edit's impact is worth showing before returning to Settings; holds where to go once
  // the student has seen it, so the impact screen never gets in the way of a first-time setup.
  const [impact, setImpact] = useState<{ data: PlanImpact; goTo: string } | null>(null)

  const handleStepChange = useCallback((newPayload: Record<string, unknown>, continueAllowed = true, reason: string | null = null) => {
    setPayload(newPayload)
    setCanContinue(continueAllowed)
    setContinueReason(reason)
  }, [])

  const railRef = useRef<HTMLOListElement>(null)
  const meta = STEP_META[step]
  const back = previousStep(step)
  const forward = nextStep(step)
  const editing = !!returnTo
  const isComplete = state.profile?.onboarding_status === 'complete'

  // On a narrow screen the rail becomes a horizontal strip, and the current step
  // can sit entirely off the right edge — a progress indicator that cannot show
  // where you are. Centre it whenever the strip actually overflows.
  useEffect(() => {
    const rail = railRef.current
    const current = rail?.querySelector<HTMLElement>('.ob-step.is-current')
    if (!rail || !current) return
    const strip = rail.parentElement
    if (!strip || strip.scrollWidth <= strip.clientWidth) return
    const stripBox = strip.getBoundingClientRect()
    const stepBox = current.getBoundingClientRect()
    strip.scrollLeft += (stepBox.left - stripBox.left) - (strip.clientWidth - stepBox.width) / 2
  }, [step])

  async function save(andGo: string | null) {
    setSaving(true)
    setError('')
    try {
      const url = step === 'plan' ? '/api/onboarding/plan/confirm' : `/api/onboarding/${step}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.message || data.error || 'Could not save that'); setSaving(false); return }
      // In edit mode a save that measurably changes the days ahead is shown once, here, before returning to
      // Settings — never silently, and never by rewriting anything: the save already happened exactly as it
      // would have without this check.
      if (editing && andGo && isNotable(data.impact)) { setImpact({ data: data.impact, goTo: andGo }); setSaving(false); return }
      if (andGo) router.push(andGo)
      else router.refresh()
    } catch {
      setError('Network error — nothing was saved')
      setSaving(false)
    }
  }

  const StepBody = {
    exam: <ExamStep state={state} windows={windows} onChange={handleStepChange} />,
    route: <RouteStep state={state} onChange={handleStepChange} />,
    position: <PositionStep state={state} topics={topics} onChange={handleStepChange} />,
    week: <WeekStep state={state} onChange={handleStepChange} />,
    plan: <PlanStep state={state} windows={windows} onChange={handleStepChange} />,
  }[step]

  return (
    <div className="ob-shell">
      <aside className="ob-rail" aria-label="Setup progress">
        <div className="ob-brand">
          <span className="brand-mark"><span /></span> Roadmap
        </div>

        <ol className="ob-steps" ref={railRef}>
          {STEPS.map(s => {
            const m = STEP_META[s]
            const done = s === 'plan' ? false : Boolean(state.completed[s as Exclude<Step, 'plan'>])
            const current = s === step
            return (
              <li key={s}>
                <Link
                  href={onboardingHref(s, returnTo ?? undefined)}
                  className={`ob-step ${current ? 'is-current' : ''} ${done ? 'is-done' : ''}`}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className="ob-step__dot" aria-hidden>
                    {done && !current ? <Check size={12} /> : m.index}
                  </span>
                  {m.nav}
                </Link>
              </li>
            )
          })}
        </ol>

        <p className="ob-rail__note">
          {isComplete
            ? 'Every answer here stays editable. Changes apply the next time a week is planned.'
            : 'Please complete your setup to enter the app. You can adjust the details later in Settings.'}
        </p>
      </aside>

      <main className="ob-main">
        <div className="ob-body">
          <header className="ob-head">
            <p className="eyebrow">{editing ? 'Editing your setup' : `Step ${meta.index} of ${STEPS.length}`}</p>
            <h1>{impact ? 'How this changes the days ahead' : meta.title}</h1>
            <p className="ob-blurb">{impact ? 'Nothing has been rescheduled yet. This is what your change means for the plan you already have.' : meta.blurb}</p>
          </header>

          {impact ? (
            <div className="ob-section">
              {impact.data.cycleChanged && (
                <Card padding="tight" className="ob-impact-row">
                  <strong>Your study week moves</strong>
                  <p className="fine-print">
                    {impact.data.before.start} → {impact.data.before.end} (paper {weekdayName(impact.data.before.paperDay)}) becomes{' '}
                    {impact.data.after.start} → {impact.data.after.end} (paper {weekdayName(impact.data.after.paperDay)}).
                  </p>
                </Card>
              )}
              {impact.data.capacityDeltaMinutes !== 0 && (
                <Card padding="tight" className="ob-impact-row">
                  {impact.data.capacityDeltaMinutes > 0 ? <TrendingUp size={17} aria-hidden /> : <TrendingDown size={17} aria-hidden />}
                  <span>
                    <strong>{impact.data.capacityDeltaMinutes > 0 ? 'More' : 'Less'} study time ahead</strong>
                    <p className="fine-print">
                      About {Math.abs(Math.round(impact.data.capacityDeltaMinutes))} minutes {impact.data.capacityDeltaMinutes > 0 ? 'more' : 'less'} available
                      between now and this week’s paper, across the days remaining.
                    </p>
                  </span>
                </Card>
              )}
              {impact.data.overflowDays.length > 0 && (
                <Card padding="tight" className="ob-impact-row ob-impact-row--warn">
                  <strong>{impact.data.overflowDays.length} day{impact.data.overflowDays.length === 1 ? '' : 's'} no longer fit{impact.data.overflowDays.length === 1 ? 's' : ''} what is already planned</strong>
                  <ul className="fine-print">
                    {impact.data.overflowDays.map(d => (
                      <li key={d.date}>{d.date}: {d.scheduledMinutes} min already scheduled, {d.newCapacityMinutes} min now available</li>
                    ))}
                  </ul>
                  <p className="fine-print">Nothing has moved. Open Calendar to redistribute or trim these days.</p>
                </Card>
              )}
              <Button className="ob-actions__next mt-6" onClick={() => router.push(impact.goTo)}>
                Continue to Settings <ArrowRight size={16} aria-hidden />
              </Button>
            </div>
          ) : StepBody}

          {error && <Notice tone="danger" role="alert">{error}</Notice>}

          {!impact && <div className="ob-actions">
            {back
              ? <Button variant="text" onClick={() => router.push(onboardingHref(back, returnTo ?? undefined))}>
                  <ArrowLeft size={15} aria-hidden /> Back
                </Button>
              : <span />}

            <div className="ob-actions__right">
              {!canContinue && continueReason && (
                <span className="ob-actions__reason" aria-live="polite">
                  {continueReason}
                </span>
              )}
              <Button
                className="ob-actions__next"
                onClick={() => save(step === 'plan' ? ROUTES.app.calendar : editing ? returnTo : forward ? onboardingHref(forward) : ROUTES.app.calendar)}
                loading={saving}
                disabled={!canContinue}
                aria-disabled={!canContinue}
              >
                {step === 'plan' ? 'Accept and open Calendar' : editing ? 'Save' : 'Continue'}
                {step !== 'plan' && <ArrowRight size={16} aria-hidden />}
              </Button>
            </div>
          </div>}
        </div>
      </main>
    </div>
  )
}

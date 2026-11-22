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
export type ReadingInfo = { id: string; topicId: string; name: string }
export type WindowInfo = { id: string; year: number; sitting: string; opens: string | null; closes: string | null; confirmed: boolean }

/**
 * The frame every onboarding screen sits in.
 *
 * Each step owns its own payload and posts it to `/api/onboarding/[step]`, which
 * writes rows. The shell only handles navigation and the shared chrome, so no
 * single component carries all six screens' state — which is what made the old
 * flow impossible to link into.
 */
export function OnboardingShell({
  step, state, windows, topics, readings = [], returnTo = null,
}: {
  step: Step
  returnTo?: string | null
  state: OnboardingState
  windows: WindowInfo[]
  topics: TopicInfo[]
  readings?: ReadingInfo[]
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  // Review is not acceptable until a ready draft reports itself (building, failed and invalidated all keep it off).
  const [canContinue, setCanContinue] = useState(step !== 'plan')
  const [previewKey, setPreviewKey] = useState(0)
  const [invalid, setInvalid] = useState(false)
  const [continueReason, setContinueReason] = useState<string | null>(null)
  // Set only when an edit's impact is worth showing before returning to Settings; holds where to go once
  // the student has seen it, so the impact screen never gets in the way of a first-time setup.
  const [impact, setImpact] = useState<{ data: PlanImpact; goTo: string } | null>(null)
  const [savedUnavailable, setSavedUnavailable] = useState<{ version: number | null; goTo: string } | null>(null)

  const handleStepChange = useCallback((newPayload: Record<string, unknown>, continueAllowed = true, reason: string | null = null) => {
    setPayload(newPayload)
    setCanContinue(continueAllowed)
    setContinueReason(reason)
    if (continueAllowed) { setError(''); setInvalid(false) } // a new ready preview retires the error that belonged to the old one
  }, [])

  const rebuild = useCallback(() => { setError(''); setInvalid(false); setPreviewKey(k => k + 1) }, [])

  const railRef = useRef<HTMLOListElement>(null)
  const meta = STEP_META[step]
  const back = previousStep(step)
  const forward = nextStep(step)
  const editing = !!returnTo
  const isComplete = state.profile?.onboarding_status === 'complete'

  // On a narrow screen the rail becomes a horizontal strip, and the current step
  // can sit entirely off the right edge — a progress indicator that cannot show
  // where you are. Centre it inside the steps list whenever it overflows, keeping
  // the brand logo pinned on the left without being scrolled or clipped.
  useEffect(() => {
    const strip = railRef.current
    const current = strip?.querySelector<HTMLElement>('.ob-step.is-current')
    if (!strip || !current) return
    if (strip.scrollWidth <= strip.clientWidth) return
    const stripBox = strip.getBoundingClientRect()
    const stepBox = current.getBoundingClientRect()
    strip.scrollLeft += (stepBox.left - stripBox.left) - (strip.clientWidth - stepBox.width) / 2
  }, [step])

  async function save(andGo: string | null) {
    if (saving || savedUnavailable) return
    if (step === 'plan' && (!payload?.draftId || typeof payload.expectedRevision !== 'number')) return
    setSaving(true)
    setError('')
    try {
      const url = step === 'plan' ? '/api/onboarding/plan/confirm' : `/api/onboarding/${step}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // An edit by a completed student carries the setup version the editor read, so a stale overlapping edit is refused instead of silently overwriting.
        body: JSON.stringify(editing && step !== 'plan' && typeof (state.profile as any)?.onboarding_context_version === 'number' ? { ...(payload ?? {}), expectedVersion: (state.profile as any).onboarding_context_version } : (payload ?? {})),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.code === 'setup_changed' ? 'Your setup was changed in another tab or device after you opened this. Nothing was saved and your edits are still here. Reload to see the latest, then save again.' : (data.message || data.error || 'Could not save that')); setSaving(false)
        if (step === 'plan') { setInvalid(true); handleStepChange({}, false, 'Rebuild the preview to continue') }
        return
      }
      // In edit mode a save that measurably changes the days ahead is shown once, here, before returning to
      // Settings — never silently, and never by rewriting anything: the save already happened exactly as it
      // would have without this check.
      if (data.impact?.unavailable || data.followUpUnavailable) {
        setSavedUnavailable({ version: data.version ?? null, goTo: andGo ?? '/app/settings' })
        setSaving(false)
        return
      }
      if (editing && andGo && isNotable(data.impact)) { setImpact({ data: data.impact, goTo: andGo }); setSaving(false); return }
      if (andGo) router.push(andGo)
      else router.refresh()
    } catch {
      setError('The connection dropped, so it is not confirmed whether this saved. Reload to check: if your change is there it saved; if not, your edits here are kept and saving again is safe.')
      setSaving(false)
    }
  }

  const StepBody = {
    exam: <ExamStep state={state} windows={windows} onChange={handleStepChange} />,
    route: <RouteStep state={state} onChange={handleStepChange} />,
    position: <PositionStep state={state} topics={topics} readings={readings} onChange={handleStepChange} />,
    week: <WeekStep state={state} onChange={handleStepChange} />,
    plan: <PlanStep state={state} windows={windows} onChange={handleStepChange} rebuildKey={previewKey} invalid={invalid} onRebuild={rebuild} />,
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
                  prefetch={false}
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
            <h1>{savedUnavailable ? 'Your changes are saved' : impact ? 'How this changes the days ahead' : meta.title}</h1>
            <p className="ob-blurb">{savedUnavailable ? 'Your setup saved successfully. Nothing in your accepted week has been moved.' : impact ? 'Nothing has been rescheduled yet. This is what your change means for the plan you already have.' : meta.blurb}</p>
          </header>

          {savedUnavailable ? (
            <section className="ob-section">
              <Notice tone="warn" role="status">Saved{savedUnavailable.version !== null ? ` as setup version ${savedUnavailable.version}` : ''}. The plan impact could not be read just now. Open Calendar to review the current week; the earlier before-and-after comparison is unavailable.</Notice>
              <Link href="/app/calendar" className="primary-button">Review my week</Link>
              <Button variant="text" onClick={() => window.location.reload()}>Reload saved setup</Button>
              <Button variant="text" onClick={() => router.push(savedUnavailable.goTo)}>Continue</Button>
            </section>
          ) : impact ? (
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
                Continue <ArrowRight size={16} aria-hidden />
              </Button>
            </div>
          ) : <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{StepBody}</fieldset>}

          {error && !(step === 'plan' && invalid) && <Notice tone="danger" role="alert">{error}</Notice>}

          {!impact && !savedUnavailable && <div className="ob-actions">
            {back
              ? <Button variant="text" disabled={saving} onClick={() => router.push(onboardingHref(back, returnTo ?? undefined))}>
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
                {step === 'plan' ? 'Accept and open Calendar' : editing ? (returnTo === ROUTES.onboarding.plan ? 'Save and return to review' : 'Save') : 'Continue'}
                {step !== 'plan' && <ArrowRight size={16} aria-hidden />}
              </Button>
            </div>
          </div>}
        </div>
      </main>
    </div>
  )
}

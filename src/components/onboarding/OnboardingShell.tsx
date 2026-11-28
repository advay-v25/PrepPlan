'use client'

import { useHydrated } from '../ui/WhenReady'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, TrendingDown, TrendingUp } from 'lucide-react'
import gsap from 'gsap'
import { calm, enter } from '../flow/motion'
import { LivePlan } from './LivePlan'
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
  step, state, today, windows, topics, readings = [], returnTo = null,
}: {
  step: Step
  returnTo?: string | null
  state: OnboardingState
  today: string
  windows: WindowInfo[]
  topics: TopicInfo[]
  readings?: ReadingInfo[]
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const ready = useHydrated()   // server-rendered answers cannot take input until React holds them
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  // Review is not acceptable until a ready draft reports itself (building, failed and invalidated all keep it off).
  const [canContinue, setCanContinue] = useState(step !== 'plan')
  const [previewKey, setPreviewKey] = useState(0)
  const [invalid, setInvalid] = useState(false)
  const [accepted, setAccepted] = useState(false)   // another confirmation of the first week already went through
  const [invalidReason, setInvalidReason] = useState<string | null>(null)   // why the server refused the preview, in its words
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

  const page = useRef<HTMLDivElement>(null)
  const meta = STEP_META[step]
  const back = previousStep(step)
  const forward = nextStep(step)
  const editing = !!returnTo

  // Each screen arrives the same way: the heading, then its sections, one after another. The plan screen animates its own preview once it is built.
  useLayoutEffect(() => {
    const root = page.current
    if (!root) return
    enter(root.querySelectorAll(step === 'plan' ? '.fl-head > *' : '.fl-head > *, .fl-content .ob-section > *'))
    if (!calm()) gsap.fromTo(root.querySelectorAll('.fl-prog li.is-current .fl-prog__fill'), { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power3.out' })
  }, [step, impact, savedUnavailable])

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
        if (step === 'plan' && data.code === 'ALREADY_ACCEPTED') setAccepted(true)
        // An unknown outcome keeps this draft acceptable: repeating the same confirmation is the safe retry.
        else if (step === 'plan' && data.code !== 'UNCONFIRMED') { setInvalidReason(data.error || null); setInvalid(true); handleStepChange({}, false, 'Rebuild the preview to continue') }
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
      setError(step === 'plan' ? 'The connection dropped, so it is not confirmed whether your plan saved. Press Accept again: if it already saved, you will not get a second copy.'
        : 'The connection dropped, so it is not confirmed whether this saved. Reload to check: if your change is there it saved; if not, your edits here are kept and saving again is safe.')
      setSaving(false)
    }
  }

  const StepBody = {
    exam: <ExamStep state={state} windows={windows} onChange={handleStepChange} />,
    route: <RouteStep state={state} onChange={handleStepChange} />,
    position: <PositionStep state={state} today={today} topics={topics} readings={readings} onChange={handleStepChange} />,
    week: <WeekStep state={state} onChange={handleStepChange} />,
    plan: <PlanStep state={state} windows={windows} onChange={handleStepChange} rebuildKey={previewKey} invalid={invalid} invalidReason={invalidReason} onRebuild={rebuild} />,
  }[step]

  return (
    <div className="fl" data-step={step} ref={page}>
      <header className="fl-top">
        <span className="fl-brand"><span className="brand-mark" aria-hidden="true" /> PrepPlan</span>
        <nav aria-label="Setup progress">
          <ol className="fl-prog">
            {STEPS.map(s => {
              const m = STEP_META[s]
              const done = s === 'plan' ? false : Boolean(state.completed[s as Exclude<Step, 'plan'>])
              const current = s === step
              // A step is reachable once every step before it is saved (always, when editing a finished setup).
              const reachable = editing || current || done || STEPS.slice(0, STEPS.indexOf(s)).every(x => x === 'plan' || state.completed[x as Exclude<Step, 'plan'>])
              const name = `Step ${m.index} of ${STEPS.length}: ${m.nav}${current ? ', current' : done ? ', saved' : reachable ? '' : ', not available yet'}`
              const inner = (<>
                <span className="fl-prog__bar" aria-hidden><i className="fl-prog__fill" /></span>
                <span className="fl-prog__label">{done && !current ? <Check size={12} aria-hidden /> : null}{m.nav}</span>
              </>)
              return (
                <li key={s} className={`${current ? 'is-current' : ''} ${done ? 'is-done' : ''}`}>
                  {reachable
                    ? <Link href={onboardingHref(s, returnTo ?? undefined)} prefetch={false} aria-label={name} aria-current={current ? 'step' : undefined}>{inner}</Link>
                    : <span className="fl-prog__locked" role="img" aria-label={name}>{inner}</span>}
                </li>
              )
            })}
          </ol>
        </nav>
        <span className="fl-count">{editing ? 'Editing' : `${meta.index} / ${STEPS.length}`}</span>
      </header>

      <main className="fl-main">
        <div className="fl-body">
          <header className="fl-head">
            <h1>{savedUnavailable ? 'Your changes are saved' : impact ? 'What this changes' : meta.title}</h1>
            {savedUnavailable ? <p className="fl-blurb">Nothing in your accepted week has moved</p> : impact ? <p className="fl-blurb">Nothing has been rescheduled yet</p> : meta.blurb ? <p className="fl-blurb">{meta.blurb}</p> : null}
          </header>

          <div className="fl-content">
            {savedUnavailable ? (
              <section className="ob-section">
                <Notice tone="warn" role="status">Saved{savedUnavailable.version !== null ? ` as version ${savedUnavailable.version}` : ''}. The effect on your plan could not be read just now. Open Calendar to check the current week.</Notice>
                <div className="fl-row">
                  <Link href="/app/calendar" className="primary-button">Review my week</Link>
                  <Button variant="text" onClick={() => window.location.reload()}>Reload saved setup</Button>
                  <Button variant="text" onClick={() => router.push(savedUnavailable.goTo)}>Continue</Button>
                </div>
              </section>
            ) : impact ? (
              <div className="ob-section">
                {impact.data.cycleChanged && (
                  <div className="ob-impact-row">
                    <strong>Your study week moves</strong>
                    <p className="fine-print">
                      {impact.data.before.start} → {impact.data.before.end} (paper {weekdayName(impact.data.before.paperDay)}) becomes{' '}
                      {impact.data.after.start} → {impact.data.after.end} (paper {weekdayName(impact.data.after.paperDay)})
                    </p>
                  </div>
                )}
                {impact.data.capacityDeltaMinutes !== 0 && (
                  <div className="ob-impact-row">
                    {impact.data.capacityDeltaMinutes > 0 ? <TrendingUp size={17} aria-hidden /> : <TrendingDown size={17} aria-hidden />}
                    <span>
                      <strong>{impact.data.capacityDeltaMinutes > 0 ? 'More' : 'Less'} study time ahead</strong>
                      <p className="fine-print">About {Math.abs(Math.round(impact.data.capacityDeltaMinutes))} minutes {impact.data.capacityDeltaMinutes > 0 ? 'more' : 'less'} before this week’s paper</p>
                    </span>
                  </div>
                )}
                {impact.data.overflowDays.length > 0 && (
                  <div className="ob-impact-row ob-impact-row--warn">
                    <strong>{impact.data.overflowDays.length} day{impact.data.overflowDays.length === 1 ? '' : 's'} no longer fit{impact.data.overflowDays.length === 1 ? 's' : ''} what is planned</strong>
                    <ul className="fine-print">
                      {impact.data.overflowDays.map(d => (
                        <li key={d.date}>{d.date}: {d.scheduledMinutes} min planned, {d.newCapacityMinutes} min available</li>
                      ))}
                    </ul>
                    <p className="fine-print">Nothing has moved. Open Calendar to trim these days.</p>
                  </div>
                )}
                <Button className="ob-actions__next" onClick={() => router.push(impact.goTo)}>
                  Continue <ArrowRight size={16} aria-hidden />
                </Button>
              </div>
            ) : <fieldset disabled={saving || !ready} className="fl-fieldset">{StepBody}</fieldset>}

            {error && !(step === 'plan' && invalid) && <Notice tone={accepted ? 'info' : 'danger'} role="alert">{error}{accepted && <> <Link className="prose-link" href={ROUTES.app.calendar}>Open Calendar</Link></>}</Notice>}
          </div>

          {!impact && !savedUnavailable && <div className="fl-actions">
            {back
              ? <Button variant="text" disabled={saving} onClick={() => router.push(onboardingHref(back, returnTo ?? undefined))}>
                  <ArrowLeft size={15} aria-hidden /> Back
                </Button>
              : <span />}

            <div className="fl-actions__right">
              {!canContinue && continueReason && (
                <span className="fl-actions__reason" aria-live="polite">{continueReason}</span>
              )}
              <Button
                className="ob-actions__next"
                onClick={() => save(step === 'plan' ? ROUTES.app.calendar : editing ? returnTo : forward ? onboardingHref(forward) : ROUTES.app.calendar)}
                loading={saving}
                disabled={!canContinue || !ready}
                aria-disabled={!canContinue || !ready}
              >
                {step === 'plan' ? 'Accept and open Calendar' : editing ? (returnTo === ROUTES.onboarding.plan ? 'Save and return to review' : 'Save') : 'Continue'}
                {step !== 'plan' && <ArrowRight size={16} aria-hidden />}
              </Button>
            </div>
          </div>}
        </div>
        {step !== 'plan' && !impact && !savedUnavailable && <LivePlan step={step} state={state} windows={windows} draft={payload} />}
      </main>
    </div>
  )
}

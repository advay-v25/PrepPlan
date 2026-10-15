'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { DISPLAY_ORDER, weekdayShort, weekdayName } from '../../../lib/planning/weekday'
import { findTimeProblem, type AvailabilityMode } from '../../../lib/onboarding/schema'
import { Button, IconButton } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import type { OnboardingState } from '../OnboardingShell'

const SESSION_LENGTHS = [20, 30, 45, 60, 90]

type Win = { id: string; weekday: number; startTime: string; endTime: string }
type Fixed = { id: string; label: string; weekdays: number[]; startTime: string; endTime: string }

/** Quick starting points. They only add windows; the grid below stays fully editable. */
const PRESETS: { id: string; label: string; days: number[]; start: string; end: string }[] = [
  { id: 'am', label: 'Weekday mornings', days: [1, 2, 3, 4, 5], start: '06:30', end: '09:00' },
  { id: 'pm', label: 'Weekday evenings', days: [1, 2, 3, 4, 5], start: '18:30', end: '21:30' },
  { id: 'we', label: 'Weekends', days: [6, 0], start: '09:00', end: '13:00' },
]

const hhmm = (v: unknown, f: string) => (v ? String(v).slice(0, 5) : f)

/**
 * One question: when may Roadmap schedule study? Time outside the chosen windows is treated as unavailable,
 * so nothing else about the student's week has to be described. Classes from the previous step are blocked
 * automatically. Saying "my schedule changes" or "I cannot schedule this week" is a valid answer: it records
 * the situation and Calendar raises a setup item instead of inventing a plan.
 */
export function WeekStep({
  state, onChange,
}: {
  state: OnboardingState
  onChange: (payload: Record<string, unknown>, continueAllowed?: boolean, reason?: string | null) => void
}) {
  const savedMode = (state.profile?.week_availability_mode as AvailabilityMode | null) ?? null
  const [mode, setMode] = useState<AvailabilityMode | null>(savedMode)
  const [windows, setWindows] = useState<Win[]>(() =>
    (state.availability ?? []).map(w => ({ id: crypto.randomUUID(), weekday: Number(w.weekday), startTime: hhmm(w.start_time, '18:00'), endTime: hhmm(w.end_time, '21:00') })))
  const [fixed, setFixed] = useState<Fixed[]>(() =>
    (state.commitments ?? []).filter(c => c.source === 'onboarding' && c.kind !== 'class').map(c => ({
      id: crypto.randomUUID(), label: c.label || '', weekdays: (c.weekdays as number[]) || [],
      startTime: hhmm(c.start_time, '09:00'), endTime: hhmm(c.end_time, '17:00'),
    })))
  const [maxSession, setMaxSession] = useState<number | null>(state.profile?.max_session_minutes ?? null)

  const classes = (state.commitments ?? []).filter(c => c.kind === 'class' && (c as any).recurrence !== 'none')
  const usingWindows = mode === 'windows' || mode === null

  const problem = useMemo(() => {
    if (!usingWindows) return null
    return findTimeProblem(windows.map(w => ({ weekday: w.weekday, start: w.startTime, end: w.endTime })), 'study window')
      ?? findTimeProblem(fixed.flatMap(f => f.weekdays.map(weekday => ({ weekday, start: f.startTime, end: f.endTime }))), 'commitment')
  }, [windows, fixed, usingWindows])

  useEffect(() => {
    const effective: AvailabilityMode = mode ?? 'windows'
    let canContinue = true
    let reason: string | null = null
    if (effective === 'windows' && windows.length === 0) { canContinue = false; reason = 'Choose at least one time for study, or say your schedule cannot be set yet.' }
    else if (problem) { canContinue = false; reason = problem }
    else if (maxSession === null) { canContinue = false; reason = 'Choose your longest comfortable sitting.' }
    onChange({
      availabilityMode: effective,
      windows: effective === 'windows' ? windows.map(w => ({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime })) : [],
      commitments: fixed.filter(f => f.weekdays.length).map(f => ({ label: f.label.trim(), kind: 'other', weekdays: f.weekdays, startTime: f.startTime, endTime: f.endTime })),
      maxSessionMinutes: maxSession ?? undefined,
    }, canContinue, reason)
  }, [mode, windows, fixed, maxSession, problem, onChange])

  const has = (p: (typeof PRESETS)[number]) => p.days.every(d => windows.some(w => w.weekday === d && w.startTime === p.start && w.endTime === p.end))
  function togglePreset(p: (typeof PRESETS)[number]) {
    setMode('windows')
    setWindows(prev => has(p)
      ? prev.filter(w => !(p.days.includes(w.weekday) && w.startTime === p.start && w.endTime === p.end))
      : [...prev, ...p.days.filter(d => !prev.some(w => w.weekday === d && w.startTime === p.start && w.endTime === p.end))
          .map(d => ({ id: crypto.randomUUID(), weekday: d, startTime: p.start, endTime: p.end }))])
  }
  function chooseUnavailable(m: 'varies' | 'none_this_week') {
    setMode(mode === m ? null : m)
    setWindows([])
  }

  return (
    <div className="ob-section">
      <section>
        <h2 className="ob-subhead">Quick start</h2>
        <div className="ob-tilegrid ob-tilegrid--3">
          {PRESETS.map(p => (
            <button key={p.id} type="button" className={`ob-tile ob-tile--compact ${usingWindows && has(p) ? 'is-selected' : ''}`}
              aria-pressed={usingWindows && has(p)} onClick={() => togglePreset(p)}>
              <strong>{p.label}</strong><small>{p.start}–{p.end}</small>
            </button>
          ))}
        </div>
      </section>

      {usingWindows && (
        <section className="mt-8">
          <h2 className="ob-subhead">Your study windows</h2>
          <div className="ob-weekgrid">
            {DISPLAY_ORDER.map(d => {
              const list = windows.filter(w => w.weekday === d)
              return (
                <div key={d} className="ob-weekgrid__day">
                  <strong title={weekdayName(d)}>{weekdayShort(d)}</strong>
                  <div className="ob-weekgrid__slots">
                    {list.length === 0 && <span className="fine-print">Not available</span>}
                    {list.map(w => (
                      <div key={w.id} className="ob-window-row">
                        <input type="time" className="ob-input" value={w.startTime} aria-label={`${weekdayName(d)} start`}
                          onChange={e => setWindows(p => p.map(x => x.id === w.id ? { ...x, startTime: e.target.value } : x))} />
                        <span>to</span>
                        <input type="time" className="ob-input" value={w.endTime} aria-label={`${weekdayName(d)} end`}
                          onChange={e => setWindows(p => p.map(x => x.id === w.id ? { ...x, endTime: e.target.value } : x))} />
                        <IconButton label={`Remove ${weekdayName(d)} window`} onClick={() => setWindows(p => p.filter(x => x.id !== w.id))}><X size={15} /></IconButton>
                      </div>
                    ))}
                    <Button variant="text" onClick={() => { setMode('windows'); setWindows(p => [...p, { id: crypto.randomUUID(), weekday: d, startTime: '18:00', endTime: '21:00' }]) }}>
                      <Plus size={14} aria-hidden /> Add
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          {problem && <Notice tone="warn" role="alert" className="mt-4">{problem}</Notice>}
          {classes.length > 0 && (
            <p className="fine-print mt-4">Your classes from the last step are blocked automatically. Roadmap never schedules study over them.</p>
          )}
        </section>
      )}

      {!usingWindows && (
        <Notice tone="info" className="mt-6">
          {mode === 'varies'
            ? 'Understood. Roadmap will ask for your availability at the start of each week, and will not invent study times before then.'
            : 'Understood. You can finish setup now. Calendar will open with one next step: add this week’s availability.'}
        </Notice>
      )}

      <section className="mt-8">
        <h2 className="ob-subhead">Longest comfortable sitting</h2>
        <div className="ob-tilegrid ob-tilegrid--5">
          {SESSION_LENGTHS.map(m => (
            <button key={m} type="button" className={`ob-tile ob-tile--compact ${maxSession === m ? 'is-selected' : ''}`}
              aria-pressed={maxSession === m} onClick={() => setMaxSession(m)}>
              <strong>{m} min</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="ob-alt">
          <span className="fine-print">Cannot set this yet?</span>
          <Button variant="text" onClick={() => chooseUnavailable('varies')} aria-pressed={mode === 'varies'}>My schedule changes every week</Button>
          <Button variant="text" onClick={() => chooseUnavailable('none_this_week')} aria-pressed={mode === 'none_this_week'}>I cannot schedule study this week</Button>
        </div>
        {usingWindows && (
          <details className="ob-fixed">
            <summary className="text-button">Show a fixed commitment on my Calendar (optional)</summary>
            <p className="fine-print">Not needed for planning: time outside your study windows is already unavailable.</p>
            {fixed.map(f => (
              <div key={f.id} className="ob-class-row">
                <input className="ob-input" value={f.label} maxLength={80} placeholder="What is it? (optional)" aria-label="Commitment name (optional)"
                  onChange={e => setFixed(p => p.map(x => x.id === f.id ? { ...x, label: e.target.value } : x))} />
                <div className="ob-class-row__days" role="group" aria-label="Days">
                  {DISPLAY_ORDER.map(d => (
                    <button key={d} type="button" className={`ob-day-toggle ${f.weekdays.includes(d) ? 'is-active' : ''}`} aria-pressed={f.weekdays.includes(d)}
                      onClick={() => setFixed(p => p.map(x => x.id !== f.id ? x : { ...x, weekdays: x.weekdays.includes(d) ? x.weekdays.filter(y => y !== d) : [...x.weekdays, d] }))}>{weekdayShort(d)}</button>
                  ))}
                </div>
                <div className="ob-class-row__times">
                  <input type="time" className="ob-input" value={f.startTime} aria-label="Start" onChange={e => setFixed(p => p.map(x => x.id === f.id ? { ...x, startTime: e.target.value } : x))} />
                  <span>to</span>
                  <input type="time" className="ob-input" value={f.endTime} aria-label="End" onChange={e => setFixed(p => p.map(x => x.id === f.id ? { ...x, endTime: e.target.value } : x))} />
                </div>
                <IconButton label="Remove commitment" onClick={() => setFixed(p => p.filter(x => x.id !== f.id))}><X size={16} /></IconButton>
              </div>
            ))}
            <Button variant="text" onClick={() => setFixed(p => [...p, { id: crypto.randomUUID(), label: '', weekdays: [], startTime: '09:00', endTime: '17:00' }])}>
              <Plus size={14} aria-hidden /> Add a commitment
            </Button>
          </details>
        )}
      </section>
    </div>
  )
}

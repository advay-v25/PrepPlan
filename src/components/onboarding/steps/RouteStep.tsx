'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { ROUTE_OPTIONS, CLASS_PATTERN_OPTIONS, type PrepRoute, type ClassPattern } from '../../../lib/onboarding/steps'
import { findTimeProblem } from '../../../lib/onboarding/schema'
import { DISPLAY_ORDER, weekdayShort, weekdayName } from '../../../lib/planning/weekday'
import { resolvePulseDay } from '../../../lib/planning/pulse/weekBoundary'
import type { Weekday } from '../../../lib/planning/studyWeek'
import { Button, IconButton } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import type { OnboardingState } from '../OnboardingShell'

type DraftClass = { id: string; label: string; weekdays: number[]; startTime: string; endTime: string; endsOn: string }
type NextClass = { label: string; date: string; startTime: string; endTime: string }

const hhmm = (v: unknown, fallback: string) => (v ? String(v).slice(0, 5) : fallback)

/** A stored one-off class back into the student's own timezone, for editing. */
function nextClassFrom(state: OnboardingState): NextClass | null {
  const row = (state.commitments ?? []).find(c => c.kind === 'class' && c.source === 'onboarding' && (c as any).recurrence === 'none')
  if (!row || !(row as any).starts_at || !(row as any).ends_at) return null
  const tz = state.profile?.timezone || 'UTC'
  const part = (iso: string) => {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const p = Object.fromEntries(f.formatToParts(new Date(iso)).map(x => [x.type, x.value]))
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
  }
  const a = part((row as any).starts_at), b = part((row as any).ends_at)
  return { label: String(row.label ?? ''), date: a.date, startTime: a.time, endTime: b.time }
}

/**
 * How the student is preparing, and (for live classes) when the classes are.
 *
 * Nothing is preselected. The cycle and paper day are derived and shown straight away, so the student
 * sees what their class times cause. Variable classes never claim to define a cycle before a real class is
 * known: without one, the first cycle is a provisional Monday-Sunday week.
 */
export function RouteStep({
  state, onChange,
}: {
  state: OnboardingState
  onChange: (payload: Record<string, unknown>, canContinue?: boolean, reason?: string | null) => void
}) {
  const existing: DraftClass[] = (state.commitments ?? [])
    .filter(c => c.kind === 'class' && c.source === 'onboarding' && (c as any).recurrence !== 'none')
    .map(c => ({
      id: crypto.randomUUID(), label: c.label && c.label !== 'Class' ? c.label : '', weekdays: (c.weekdays as number[]) || [],
      startTime: hhmm(c.start_time, '18:00'), endTime: hhmm(c.end_time, '20:00'), endsOn: c.ends_on || '',
    }))

  const [prepMode, setPrepMode] = useState<PrepRoute | null>((state.profile?.prep_mode as PrepRoute) ?? null)
  const [classPattern, setClassPattern] = useState<ClassPattern | null>(
    state.profile?.class_pattern && state.profile.class_pattern !== 'none' ? (state.profile.class_pattern as ClassPattern) : null)
  const [classes, setClasses] = useState<DraftClass[]>(existing)
  const [next, setNext] = useState<NextClass | null>(() => nextClassFrom(state))

  const ledByClasses = prepMode === 'instructor_led' || prepMode === 'hybrid'
  const wantsWeekly = ledByClasses && (classPattern === 'fixed' || classPattern === 'mixed')
  const wantsNext = ledByClasses && classPattern === 'variable'

  const problem = useMemo(() => {
    if (!wantsWeekly) return null
    if (classes.some(c => c.weekdays.length === 0)) return 'Choose the days for each class.'
    return findTimeProblem(classes.flatMap(c => c.weekdays.map(weekday => ({ weekday, start: c.startTime, end: c.endTime }))), 'class')
  }, [classes, wantsWeekly])
  const nextProblem = wantsNext && next
    ? (!next.date ? 'Choose the date of that class.' : next.endTime <= next.startTime ? 'The class must end after it starts.' : null)
    : null

  useEffect(() => {
    let canContinue = !!prepMode
    let reason: string | null = prepMode ? null : 'Choose how you are preparing.'
    if (canContinue && ledByClasses && !classPattern) { canContinue = false; reason = 'Choose how your classes are scheduled.' }
    if (canContinue && wantsWeekly && classes.length === 0) { canContinue = false; reason = 'Add at least one weekly class.' }
    if (canContinue && problem) { canContinue = false; reason = problem }
    if (canContinue && nextProblem) { canContinue = false; reason = nextProblem }

    onChange({
      prepMode: prepMode ?? undefined,
      classPattern: ledByClasses ? classPattern ?? undefined : 'none',
      recurringClasses: wantsWeekly ? classes.map(c => ({
        label: c.label.trim(), weekdays: c.weekdays, startTime: c.startTime, endTime: c.endTime, endsOn: c.endsOn || null,
      })) : [],
      nextClass: wantsNext && next ? { label: next.label.trim(), date: next.date, startTime: next.startTime, endTime: next.endTime } : null,
    }, canContinue, reason)
  }, [prepMode, classPattern, classes, next, ledByClasses, wantsWeekly, wantsNext, problem, nextProblem, onChange])

  // What the schedule causes, computed with the same function the calendar engine uses.
  const weekdaysInUse = wantsWeekly ? classes.flatMap(c => c.weekdays) as Weekday[] : []
  const derived = weekdaysInUse.length > 0 ? resolvePulseDay(weekdaysInUse) : null

  function toggleWeekday(id: string, day: number) {
    setClasses(prev => prev.map(c => c.id !== id ? c : { ...c, weekdays: c.weekdays.includes(day) ? c.weekdays.filter(d => d !== day) : [...c.weekdays, day] }))
  }

  return (
    <div className="ob-section">
      <div className="ob-routegrid">
        {ROUTE_OPTIONS.map(o => (
          <button key={o.value} type="button" className={`ob-route ${prepMode === o.value ? 'is-selected' : ''}`}
            aria-pressed={prepMode === o.value}
            onClick={() => { setPrepMode(o.value); if (!o.anchors) { setClassPattern(null); setClasses([]); setNext(null) } }}>
            <strong>{o.label}</strong>
            <small>{o.detail}</small>
          </button>
        ))}
      </div>

      {ledByClasses && (
        <section className="mt-8">
          <h2 className="ob-subhead">When are your classes?</h2>
          <div className="ob-tilegrid ob-tilegrid--3">
            {CLASS_PATTERN_OPTIONS.map(o => (
              <button key={o.value} type="button" className={`ob-tile ob-tile--compact ${classPattern === o.value ? 'is-selected' : ''}`}
                aria-pressed={classPattern === o.value} onClick={() => setClassPattern(o.value)}>
                <strong>{o.label}</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      {wantsWeekly && (
        <section className="mt-8">
          <h2 className="ob-subhead">{classPattern === 'mixed' ? 'Your fixed weekly classes' : 'Your weekly classes'}</h2>
          {classPattern === 'mixed' && <p className="fine-print">Add only the ones that repeat. One-off classes are added later in Calendar.</p>}
          <div className="ob-classes">
            {classes.map(c => (
              <div key={c.id} className="ob-class-row">
                <div className="ob-class-row__days" role="group" aria-label="Days">
                  {DISPLAY_ORDER.map(d => (
                    <button key={d} type="button" className={`ob-day-toggle ${c.weekdays.includes(d) ? 'is-active' : ''}`}
                      onClick={() => toggleWeekday(c.id, d)} aria-pressed={c.weekdays.includes(d)}>{weekdayShort(d)}</button>
                  ))}
                </div>
                <div className="ob-class-row__times">
                  <input type="time" className="ob-input" value={c.startTime} aria-label="Start time"
                    onChange={e => setClasses(p => p.map(x => x.id === c.id ? { ...x, startTime: e.target.value } : x))} />
                  <span>to</span>
                  <input type="time" className="ob-input" value={c.endTime} aria-label="End time"
                    onChange={e => setClasses(p => p.map(x => x.id === c.id ? { ...x, endTime: e.target.value } : x))} />
                </div>
                <details className="ob-class-row__more">
                  <summary>Name or end date (optional)</summary>
                  <input className="ob-input" value={c.label} maxLength={80} placeholder="Provider or class name" aria-label="Class name (optional)"
                    onChange={e => setClasses(p => p.map(x => x.id === c.id ? { ...x, label: e.target.value } : x))} />
                  <input type="date" className="ob-input" value={c.endsOn} aria-label="Last class date (optional)"
                    onChange={e => setClasses(p => p.map(x => x.id === c.id ? { ...x, endsOn: e.target.value } : x))} />
                </details>
                <IconButton label="Remove class" onClick={() => setClasses(p => p.filter(x => x.id !== c.id))}><X size={16} /></IconButton>
              </div>
            ))}
          </div>
          <Button variant="text" onClick={() => setClasses(p => [...p, { id: crypto.randomUUID(), label: '', weekdays: [], startTime: '18:00', endTime: '20:00', endsOn: '' }])} className="mt-4">
            <Plus size={16} aria-hidden /> Add a class
          </Button>
          {problem && <Notice tone="warn" role="alert" className="mt-4">{problem}</Notice>}
        </section>
      )}

      {wantsNext && (
        <section className="mt-8">
          <h2 className="ob-subhead">Your next known class</h2>
          {next ? (
            <div className="ob-class-row">
              <input type="date" className="ob-input" value={next.date} aria-label="Date of your next class"
                onChange={e => setNext({ ...next, date: e.target.value })} />
              <div className="ob-class-row__times">
                <input type="time" className="ob-input" value={next.startTime} aria-label="Start time" onChange={e => setNext({ ...next, startTime: e.target.value })} />
                <span>to</span>
                <input type="time" className="ob-input" value={next.endTime} aria-label="End time" onChange={e => setNext({ ...next, endTime: e.target.value })} />
              </div>
              <IconButton label="Remove this class" onClick={() => setNext(null)}><X size={16} /></IconButton>
            </div>
          ) : (
            <Button variant="text" onClick={() => setNext({ label: '', date: '', startTime: '18:00', endTime: '20:00' })}>
              <Plus size={16} aria-hidden /> Add my next known class
            </Button>
          )}
          {nextProblem && <Notice tone="warn" role="alert" className="mt-4">{nextProblem}</Notice>}
          {!next && (
            <Notice tone="info" className="mt-4">
              No class yet is fine. Your first cycle will be a provisional Monday to Sunday week, and Calendar will ask for your next class before it builds around your classes.
            </Notice>
          )}
        </section>
      )}

      {prepMode && (
        <p className="ob-derived" aria-live="polite">
          {derived !== null
            ? <>Your study week runs from your first class through <strong>{weekdayName(derived)}</strong>, with your paper before the next class.</>
            : wantsNext && next
              ? <>Your cycle will follow your classes once Calendar has the next one after this.</>
              : ledByClasses
                ? <>Provisional: Monday to Saturday study with a paper on <strong>Sunday</strong> until your classes are known.</>
                : <>Monday to Saturday study with a paper on <strong>Sunday</strong>.</>}
        </p>
      )}
    </div>
  )
}

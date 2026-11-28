'use client'

import { CalendarDays, Compass, GraduationCap, Route } from 'lucide-react'
import { ROUTE_OPTIONS, STARTING_STAGES, type Step } from '../../lib/onboarding/steps'
import { DISPLAY_ORDER, weekdayShort } from '../../lib/planning/weekday'
import { WeekRibbon, hours, type RibbonDay } from '../flow/WeekRibbon'
import type { OnboardingState, WindowInfo } from './OnboardingShell'

const hhmm = (v: unknown, f: string) => (v ? String(v).slice(0, 5) : f)
const cap = (s: string) => s.replace(/^./, c => c.toUpperCase())

type Win = { weekday: number; start: string; end: string }

/**
 * The plan as it stands, beside the question. It reads what is saved and lets the screen being answered override it live,
 * so a choice shows up here the moment it is made.
 */
export function LivePlan({ step, state, windows, draft }: { step: Step; state: OnboardingState; windows: WindowInfo[]; draft: Record<string, unknown> | null }) {
  const p = state.profile
  const live = (key: string) => (draft && key in draft ? draft[key] : undefined)

  const sitting = windows.find(w => w.id === ((step === 'exam' ? live('examWindowId') : undefined) ?? p?.exam_window_id))
  const route = ROUTE_OPTIONS.find(r => r.value === ((step === 'route' ? live('prepMode') : undefined) ?? p?.prep_mode))
  const stage = STARTING_STAGES.find(s => s.value === ((step === 'position' ? live('stage') : undefined) ?? p?.stage))

  const saved: Win[] = (state.availability ?? []).map(w => ({ weekday: Number(w.weekday), start: hhmm(w.start_time, '18:00'), end: hhmm(w.end_time, '21:00') }))
  const typed = step === 'week' ? (live('windows') as { weekday: number; startTime: string; endTime: string }[] | undefined) : undefined
  const study: Win[] = typed ? typed.map(w => ({ weekday: w.weekday, start: w.startTime, end: w.endTime })) : saved

  const classRows = step === 'route' && Array.isArray(live('recurringClasses'))
    ? (live('recurringClasses') as { weekdays: number[]; startTime: string; endTime: string }[]).flatMap(c => c.weekdays.map(weekday => ({ weekday, start: c.startTime, end: c.endTime })))
    : (state.commitments ?? []).filter(c => c.kind === 'class' && (c as { recurrence?: string }).recurrence !== 'none')
        .flatMap(c => ((c.weekdays as number[]) ?? []).map(weekday => ({ weekday, start: hhmm(c.start_time, '18:00'), end: hhmm(c.end_time, '20:00') })))

  const days: RibbonDay[] = DISPLAY_ORDER.map(d => ({
    label: weekdayShort(d),
    blocks: [
      ...classRows.filter(c => c.weekday === d).map(c => ({ start: hours(c.start), end: hours(c.end), tone: 'class' as const })),
      ...study.filter(w => w.weekday === d).map(w => ({ start: hours(w.start), end: hours(w.end), tone: 'study' as const })),
    ],
  }))
  const empty = study.length === 0 && classRows.length === 0

  const items = [
    { Icon: GraduationCap, label: 'Exam', value: sitting ? `${cap(sitting.sitting)} ${sitting.year}` : null },
    { Icon: Route, label: 'Study style', value: route?.label ?? null },
    { Icon: Compass, label: 'Starting point', value: stage?.label ?? null },
  ]

  return (
    <aside className="fl-live" aria-label="Your plan so far">
      <p className="fl-live__title"><CalendarDays size={15} aria-hidden /> Your plan</p>
      <ul className="fl-live__list">
        {items.map(({ Icon, label, value }) => (
          <li key={label} className={value ? 'is-set' : ''}>
            <Icon size={16} aria-hidden /><span>{label}</span><strong>{value ?? '—'}</strong>
          </li>
        ))}
      </ul>
      <div className="fl-live__week">
        <WeekRibbon days={days} label={empty ? 'Your week, with no study times yet' : 'Your week with the study times and classes chosen so far'} />
        {empty ? <p>Your week fills in as you choose</p> : (
          <p className="fl-legend"><span><i className="fl-dot fl-dot--study" />Study</span>{classRows.length ? <span><i className="fl-dot fl-dot--class" />Class</span> : null}</p>
        )}
      </div>
    </aside>
  )
}

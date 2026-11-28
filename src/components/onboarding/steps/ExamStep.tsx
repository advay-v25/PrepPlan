'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Notice } from '../../ui/Notice'
import { bookedDateProblem } from '../../../lib/onboarding/examWindows'
import { todayInZone } from '../../../lib/planning/studyWeek'
import type { OnboardingState, WindowInfo } from '../OnboardingShell'

const SITTING_ORDER = ['february', 'may', 'august', 'november']
const cap = (s: string) => s.replace(/^./, c => c.toUpperCase())

function formatWindow(opens: string | null) {
  if (!opens) return ''
  const [y, m, d] = opens.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

/**
 * The exam target: one of the sittings the active curriculum supports.
 *
 * Unregistered candidates plan against the sitting they pick. An exact date exists only for a booked exam,
 * and must fall in that sitting. The timezone is detected silently and never shown as a question.
 */
export function ExamStep({
  state, windows, onChange,
}: {
  state: OnboardingState
  windows: WindowInfo[]
  onChange: (payload: Record<string, unknown>, canContinue?: boolean, reason?: string | null) => void
}) {
  const [selected, setSelected] = useState<string | null>(state.profile?.exam_window_id ?? null)
  const [registered, setRegistered] = useState<'yes' | 'not_yet'>(state.profile?.registered ? 'yes' : 'not_yet')
  const [examDate, setExamDate] = useState<string>(state.profile?.exam_date ?? '')
  const timezone = state.profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const sitting = windows.find(w => w.id === selected) ?? null
  const today = todayInZone(timezone)
  const dateProblem = examDate && sitting ? bookedDateProblem({ window_opens: sitting.opens, window_closes: sitting.closes, sitting: sitting.sitting, year: sitting.year }, examDate, today) : null
  const dateInSitting = !!examDate && !dateProblem
  const openNow = (w: WindowInfo) => !!w.opens && w.opens.slice(0, 10) <= today

  // Switching to "not yet" drops the exact date, in the UI and (server-side) in what is stored.
  function chooseRegistered(value: 'yes' | 'not_yet') {
    setRegistered(value)
    if (value === 'not_yet') setExamDate('')
  }

  useEffect(() => {
    let canContinue = !!selected
    let reason: string | null = selected ? null : 'Choose the sitting you are aiming for.'
    if (selected && registered === 'yes') {
      if (!examDate) { canContinue = false; reason = 'Enter your exact booked exam date.' }
      else if (dateProblem) { canContinue = false; reason = dateProblem }
    }
    onChange({
      examWindowId: selected, registered: registered === 'yes', timezone,
      examDate: registered === 'yes' ? (examDate || null) : null,
    }, canContinue, reason)
  }, [selected, registered, examDate, timezone, dateProblem, onChange])

  const sorted = [...windows].sort((a, b) => SITTING_ORDER.indexOf(a.sitting) - SITTING_ORDER.indexOf(b.sitting))
  const year = sorted[0]?.year

  return (
    <div className="ob-section">
      <section aria-label={year ? `${year} exam months` : 'Exam months'}>
        <div className="fl-cards fl-cards--4">
          {sorted.map(w => (
            <button key={w.id} type="button" className={`fl-card ${selected === w.id ? 'is-selected' : ''}`}
              aria-pressed={selected === w.id} onClick={() => setSelected(w.id)}>
              <strong>{cap(w.sitting)}</strong>
              <small>{openNow(w) ? 'Open now' : `From ${formatWindow(w.opens)}`}</small>
              <span className="fl-card__check" aria-hidden><Check size={13} /></span>
            </button>
          ))}
        </div>
        {sitting && registered === 'not_yet' && (
          <p className="fl-result">PrepPlan plans towards {cap(sitting.sitting)}. You can add your exact date later in Settings.</p>
        )}
      </section>

      <section>
        <h2 className="fl-label">Have you booked a date?</h2>
        <div className="fl-segment" role="group" aria-label="Have you booked a date?">
          {([['yes', 'Yes, I have a date'], ['not_yet', 'Not yet']] as const).map(([value, label]) => (
            <button key={value} type="button" className={registered === value ? 'is-selected' : ''}
              aria-pressed={registered === value} onClick={() => chooseRegistered(value)}>{label}</button>
          ))}
        </div>
      </section>

      {registered === 'yes' && (
        <section>
          <h2 className="fl-label">Exam date</h2>
          <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} className="ob-input fl-date"
            required aria-label="Exact booked exam date" aria-invalid={!!examDate && !dateInSitting}
            min={sitting?.opens?.slice(0, 7) ? (`${sitting.opens.slice(0, 7)}-01` > today ? `${sitting.opens.slice(0, 7)}-01` : today) : today} />
          {dateProblem && <Notice tone="warn" role="alert" className="mt-4">{dateProblem}</Notice>}
        </section>
      )}

      {windows.length === 0 && (
        <Notice tone="warn">No 2027 sittings are available yet, so setup cannot continue. This is on our side, not yours.</Notice>
      )}
    </div>
  )
}

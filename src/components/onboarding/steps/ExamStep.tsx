'use client'

import { useEffect, useState } from 'react'
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
      <section>
        {year && <h2 className="ob-subhead">{year}</h2>}
        <div className="ob-tilegrid ob-tilegrid--4">
          {sorted.map(w => (
            <button key={w.id} type="button" className={`ob-tile ${selected === w.id ? 'is-selected' : ''}`}
              aria-pressed={selected === w.id} onClick={() => setSelected(w.id)}>
              <strong>{cap(w.sitting)}</strong>
              <small>{openNow(w) ? 'open now' : `from ${formatWindow(w.opens)}`}</small>
              {!w.confirmed && <em className="ob-tile__flag">indicative</em>}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="ob-subhead">Have you registered?</h2>
        <div className="ob-tilegrid ob-tilegrid--2">
          {([['yes', 'Yes, I have a date'], ['not_yet', 'Not yet']] as const).map(([value, label]) => (
            <button key={value} type="button" className={`ob-tile ob-tile--compact ${registered === value ? 'is-selected' : ''}`}
              aria-pressed={registered === value} onClick={() => chooseRegistered(value)}>
              <strong>{label}</strong>
            </button>
          ))}
        </div>
        <p className="fine-print">{registered === 'yes' ? 'Your booked date is saved as your exam date. The sitting is only the month you aimed for.' : 'The sitting is your target month, not a booked date. Add the exact date once you register, in Settings.'}</p>
      </section>

      {registered === 'yes' && (
        <section>
          <h2 className="ob-subhead">Your booked exam date</h2>
          <div className="ob-field">
            <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} className="ob-input"
              required aria-label="Exact booked exam date" aria-invalid={!!examDate && !dateInSitting}
              min={sitting?.opens?.slice(0, 7) ? (`${sitting.opens.slice(0, 7)}-01` > today ? `${sitting.opens.slice(0, 7)}-01` : today) : today} />
          </div>
          {dateProblem && <Notice tone="warn" role="alert" className="mt-4">{dateProblem}</Notice>}
        </section>
      )}

      {windows.length === 0 && (
        <Notice tone="warn">No 2027 sittings are available yet, so setup cannot continue. This is a data problem, not something you did.</Notice>
      )}
    </div>
  )
}

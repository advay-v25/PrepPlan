import { formatStudyDate } from '../../lib/format/date'
import Link from 'next/link'
import { MOCK_KIND_LABEL } from '../../lib/curriculum/entryContext'
import type { AppointmentSummary } from '../../lib/planning/checkpointService'
import type { RehearsalDecision } from '../../lib/rehearsal/service'
import { RehearsalAction } from './RehearsalAction'

const day = (d: string) => formatStudyDate(d, 'short')

/**
 * Tests: the student's mock schedule, the shared capability decision, rehearsals and results. Every row links to the exact appointment;
 * the capability text comes from the same decision Calendar and Coach read, with session-specific reasons when it cannot be built.
 */
export function MockSchedule({ appointments, capability }: { appointments: AppointmentSummary[]; capability: RehearsalDecision }) {
  const planned = appointments.filter(a => a.status === 'planned')
  const past = appointments.filter(a => a.status !== 'planned')
  const capable = capability.state === 'start'
  return (
    <section id="mock-h" className="mock-schedule" aria-labelledby="mock-heading">
      <h2 id="mock-heading">Your mocks and rehearsals</h2>
      <p className="muted">A full rehearsal is two linked timed sessions of 90 questions (135 minutes each), from questions held back from every other paper. Reserving it starts no clock. External mocks are yours to plan and report; what you type is your own report, never question evidence.</p>
      <div data-capability={capable ? 'ready' : 'unavailable'} className="notice" role="note">
        {capable ? <span><strong>A full rehearsal can be built.</strong> {capability.reasons[0]}</span> : (
          <div>
            <p><strong>A full rehearsal cannot be built yet.</strong> There are not enough reviewed, held-back questions for both sessions. You can still plan an external mock or keep preparing: <Link className="prose-link" href="/app/calendar#checkpoint">plan a mock in Calendar</Link>.</p>
            {capability.reasons.length > 0 && <details><summary>Why, in detail</summary><ul>{capability.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>}
          </div>
        )}
      </div>
      <p data-testid="tests-record-past-mock">Taken a mock outside PrepPlan? <Link className="prose-link" href="/app/calendar/mock-report">Record a mock already taken</Link>: no booking is needed, and it is kept as your own report, not a test result.</p>
      {planned.length === 0 && <p>No mock is planned. <Link className="prose-link" href="/app/calendar#checkpoint">Plan a rehearsal or an external mock</Link>.</p>}
      <ul className="mock-schedule__list" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {planned.map(a => (
          <li key={a.id} data-appointment={a.id} data-kind={a.kind}>
            <strong>{a.title}</strong> · {day(a.date)}{a.startTime ? ` ${a.startTime}` : ' (date only)'} · {MOCK_KIND_LABEL[a.kind]} {a.designated && <span className="badge">Counts for its week</span>}{' '}
            <Link className="text-button" href={a.href}>Open in Calendar</Link>
            {a.kind === 'internal_rehearsal' && (a.rehearsal
              ? <p>{a.rehearsal.primary ? <Link className="primary-button" href={a.rehearsal.primary.href}>{a.rehearsal.primary.label}</Link> : <Link className="secondary-button" href={`/app/tests/rehearsal/${a.rehearsal.id}`}>Open the rehearsal</Link>}</p>
              : <RehearsalAction appointmentId={a.id} compact />)}
            {a.kind !== 'internal_rehearsal' && <p className="fine-print">Taken outside PrepPlan. Record what happened in Calendar when it is done.</p>}
          </li>
        ))}
      </ul>
      {past.length > 0 && (
        <details><summary>Earlier mocks and rehearsals</summary>
          <ul>{past.map(a => <li key={a.id}>{a.title} · {day(a.date)} · {a.status === 'completed' ? 'finished' : a.status === 'missed' ? 'not taken' : a.status}{a.rehearsal?.stage === 'complete' && <> · <Link className="prose-link" href={`/app/tests/rehearsal/${a.rehearsal.id}`}>combined result</Link></>}</li>)}</ul>
        </details>
      )}
    </section>
  )
}

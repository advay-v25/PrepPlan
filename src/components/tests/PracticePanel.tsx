'use client'

import { useMemo, useState } from 'react'
import { PreflightStart } from './PreflightStart'
import { AdaptivePractice } from './AdaptivePractice'

export type PracticeCatalog = {
  subjects: { id: string; name: string; completed: boolean; readings: { id: string; no: number; title: string; completed: boolean }[] }[]
  /** Outcomes per reading, for an optional narrower scope. */
  outcomes: Record<string, { id: string; title: string }[]>
}
type Mode = 'reading' | 'subject' | 'baseline' | 'practice' | 'adaptive'

const MODES: { id: Mode; label: string; help: string }[] = [
  { id: 'reading', label: 'Reading check', help: 'Tests the part of one reading you have completed. It can create evidence.' },
  { id: 'subject', label: 'Subject check', help: 'Samples across what you have completed in one subject. It can create evidence.' },
  { id: 'baseline', label: 'Baseline', help: 'Tests a reading or subject whether or not you have completed it, to see where you start. You opt in below.' },
  { id: 'adaptive', label: 'Adaptive practice', help: 'Sets of five questions on one reading, untimed, up to 10 or 20 in all. Practice only: each set adjusts the next, and it never changes your understanding signal.' },
  { id: 'practice', label: 'Timed practice', help: 'A short timed set on one reading. Practice only: it never changes your understanding signal or closes a repair.' },
]

/**
 * One selection flow: purpose → scope → review (read-only) → explicit start. The initial reading / outcome come from a validated
 * Curriculum link; they select an UNSTARTED preview and never grant baseline permission.
 */
export function PracticePanel({ catalog, initial }: { catalog: PracticeCatalog; initial: { readingId: string | null; losId: string | null; mode?: 'adaptive' | null } }) {
  const initialReading = initial.readingId ? catalog.subjects.flatMap(s => s.readings.map(r => ({ ...r, subjectId: s.id }))).find(r => r.id === initial.readingId) ?? null : null
  // An outcome-specific link opens timed practice: it is the only check that honours one outcome. A reading check covers the whole completed part.
  const [mode, setMode] = useState<Mode>(initial.mode === 'adaptive' && initialReading ? 'adaptive' : initialReading ? (initial.losId ? 'practice' : initialReading.completed ? 'reading' : 'baseline') : 'reading')
  const [subjectId, setSubjectId] = useState(initialReading?.subjectId ?? catalog.subjects.find(s => s.readings.some(r => r.completed))?.id ?? catalog.subjects[0]?.id ?? '')
  const [readingId, setReadingId] = useState(initialReading?.id ?? '')
  const [losId, setLosId] = useState(initialReading && initial.losId ? initial.losId : '')
  const [optIn, setOptIn] = useState(false)
  const [cap, setCap] = useState<10 | 20>(10)

  const subject = catalog.subjects.find(s => s.id === subjectId)
  const needsCompleted = mode === 'reading' || mode === 'subject'
  const readings = useMemo(() => (subject?.readings ?? []).filter(r => mode === 'baseline' || mode === 'practice' || mode === 'adaptive' || r.completed), [subject, mode])
  const readingOk = readingId && readings.some(r => r.id === readingId)
  const outcomes = readingOk ? catalog.outcomes[readingId] ?? [] : []

  let body: Record<string, unknown> | null = null
  let why: string | null = null
  if (mode === 'subject') {
    if (!subject?.completed) why = 'Nothing in this subject is completed yet. Choose a baseline to test it anyway, or finish some reading first.'
    else body = { kind: 'subject', subjectId }
  } else if (!readingOk) why = needsCompleted && readings.length === 0 ? 'No reading in this subject is completed yet.' : 'Choose a reading.'
  else if (mode === 'reading') body = { kind: 'reading', readingId }
  else if (mode === 'adaptive') body = { kind: 'practice', mode: 'adaptive', readingId, cap, ...(losId ? { outcomeIds: [losId] } : {}) }
  else if (mode === 'practice') body = { kind: 'practice', readingId, ...(losId ? { outcomeIds: [losId] } : {}) }
  else if (mode === 'baseline') { if (!optIn) why = 'Tick the box to confirm you want to be tested on this without having completed it.'; else body = { kind: 'reading', readingId, baseline: true } }
  if (mode === 'baseline' && !readingId && optIn) body = { kind: 'subject', subjectId, baseline: true }
  if (mode === 'baseline' && !readingId && !optIn) why = 'Tick the box to confirm you want to be tested on this without having completed it.'

  return (
    <section className="practice-panel" aria-labelledby="practice-h">
      <h2 id="practice-h">Choose a check</h2>
      <fieldset className="practice-panel__modes">
        <legend className="visually-hidden">Type of check</legend>
        {MODES.map(m => (
          <label key={m.id} className={mode === m.id ? 'is-selected' : ''}>
            <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => { setMode(m.id); setOptIn(false) }} />
            <span><strong>{m.label}</strong><small>{m.help}</small></span>
          </label>
        ))}
      </fieldset>

      <div className="practice-panel__scope">
        <label>Subject
          <select value={subjectId} onChange={e => { setSubjectId(e.target.value); setReadingId(''); setLosId('') }}>
            {catalog.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {mode !== 'subject' && (
          <label>Reading
            <select value={readingId} onChange={e => { setReadingId(e.target.value); setLosId('') }}>
              <option value="">{mode === 'baseline' ? 'Whole subject' : 'Choose a reading'}</option>
              {readings.map(r => <option key={r.id} value={r.id}>{r.no}. {r.title}{!r.completed && mode !== 'practice' ? ' (not completed)' : ''}</option>)}
            </select>
          </label>
        )}
        {(mode === 'practice' || mode === 'adaptive') && outcomes.length > 0 && (
          <label>Narrow to one outcome <span className="muted">(optional)</span>
            <select value={losId} onChange={e => setLosId(e.target.value)}>
              <option value="">The whole reading</option>
              {outcomes.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </label>
        )}
      </div>

      {mode === 'reading' && losId && <p className="muted" role="note">A reading check covers the whole completed part of the reading, not one outcome. To focus on a single outcome, choose timed practice.</p>}
      {mode === 'baseline' && (
        <label className="practice-panel__optin"><input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} /> I want to be tested on this even though I have not completed it.</label>
      )}

      {mode === 'adaptive' && (
        <fieldset className="practice-panel__modes"><legend>Total questions</legend>
          {[10, 20].map(n => <label key={n} className={cap === n ? 'is-selected' : ''}><input type="radio" name="cap" checked={cap === n} onChange={() => setCap(n as 10 | 20)} /><span><strong>{n} questions</strong><small>{n / 5} sets of five{n === 10 ? ' (default)' : ''}</small></span></label>)}
        </fieldset>
      )}
      {body && mode === 'adaptive'
        ? <AdaptivePractice key={JSON.stringify(body)} readingId={readingId} outcomeIds={losId ? [losId] : undefined} cap={cap} />
        : body
        ? <PreflightStart key={JSON.stringify(body)} body={body} reviewLabel="Review this check" startLabel="Start" />
        : <p className="muted" role="status">{why}</p>}
    </section>
  )
}

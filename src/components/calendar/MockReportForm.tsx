'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DIFFICULTIES, type Difficulty, type MockReport, type Scale } from '../../lib/mocks/report'

type Subject = { id: string; name: string }
const SCALES: { value: Scale; label: string }[] = [
  { value: 'percent', label: 'Percentage' }, { value: 'marks', label: 'Marks out of a total' }, { value: 'percentile', label: 'Percentile' }, { value: 'unknown', label: 'Not sure' },
]

/**
 * Record a mock already taken: no booking is created and nothing is required except the date, whether it was full or partial, and something to work from.
 * One request key per form instance, so a double click, a reload-and-resubmit or a lost response saves ONE report; the key is replaced only after a
 * success or when the student changes what they are sending.
 */
export function MockReportForm({ subjects, today, initial, legacy }: { subjects: Subject[]; today: string; initial?: MockReport | null; legacy?: { id: string; text: string } | null }) {
  const router = useRouter()
  const key = useRef(crypto.randomUUID())
  const [takenOn, setTakenOn] = useState(initial?.takenOn ?? '')
  const [scope, setScope] = useState<'full' | 'partial'>(initial?.scope ?? 'full')
  const [provider, setProvider] = useState(initial?.provider ?? '')
  const [scale, setScale] = useState<Scale>(initial?.scale ?? 'percent')
  const [score, setScore] = useState(initial?.score != null ? String(initial.score) : '')
  const [scoreMax, setScoreMax] = useState(initial?.scoreMax != null ? String(initial.scoreMax) : '')
  const [topics, setTopics] = useState<Record<string, string>>(Object.fromEntries((initial?.topics ?? []).map(t => [t.topicId, String(t.value)])))
  const [diff, setDiff] = useState<Set<Difficulty>>(new Set(initial?.difficulties ?? []))
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fresh = () => { key.current = crypto.randomUUID() }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return
    setBusy(true); setError(null)
    const input = {
      takenOn, scope, provider: provider || null, scale, score: score === '' ? null : Number(score), scoreMax: scale === 'marks' && scoreMax !== '' ? Number(scoreMax) : null,
      topics: Object.entries(topics).filter(([, v]) => v !== '').map(([topicId, v]) => ({ topicId, value: Number(v), scale: scale === 'marks' ? 'unknown' : scale })),
      difficulties: [...diff], notes: notes || null, legacyOutcomeId: legacy?.id ?? initial?.legacyOutcomeId ?? null,
    }
    try {
      const res = await fetch('/api/mock-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(initial ? { action: 'edit', key: key.current, reportId: initial.id, expectedVersion: initial.version, input } : { action: 'create', key: key.current, input }) })
      const data = await res.json().catch(() => ({}))
      if (data.ok) { router.push(data.nextUrl ?? '/app/calendar'); return }
      setError(data.error ?? 'Could not save. Nothing was changed. You can try again.')
      if (res.status === 400 || res.status === 409) fresh()   // a refused request is over; a corrected one is a new request
    } catch { setError('The save may not have reached the server. Press Save again: if it already went through you will get the same report, not a second one.') }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={save} className="class-log" aria-label="Record a mock already taken" noValidate>
      {legacy && <p className="note" data-testid="legacy-original">Your original note, kept as written: “{legacy.text}”. Add structured details below if you like; nothing is read out of it for you.</p>}
      <fieldset>
        <legend>The mock</legend>
        <label>Date taken <input type="date" value={takenOn} max={today} onChange={e => { setTakenOn(e.target.value); fresh() }} required /></label>
        <div role="radiogroup" aria-label="How much of an exam was it">
          <label><input type="radio" name="scope" checked={scope === 'full'} onChange={() => setScope('full')} /> A full mock</label>{' '}
          <label><input type="radio" name="scope" checked={scope === 'partial'} onChange={() => setScope('partial')} /> Only part of an exam</label>
        </div>
        <label>Provider or name <small className="muted">(optional)</small> <input type="text" value={provider} maxLength={80} onChange={e => setProvider(e.target.value)} /></label>
      </fieldset>
      <fieldset>
        <legend>Overall result <small className="muted">(optional if you add something below)</small></legend>
        <label>Result type <select value={scale} onChange={e => { setScale(e.target.value as Scale); fresh() }}>{SCALES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label>{scale === 'marks' ? 'Marks you scored' : scale === 'percentile' ? 'Percentile' : scale === 'percent' ? 'Percentage' : 'Score'} <input type="number" inputMode="decimal" min="0" max={scale === 'percent' || scale === 'percentile' ? 100 : undefined} step="any" value={score} onChange={e => setScore(e.target.value)} /></label>
        {scale === 'marks' && <label>Total marks <input type="number" inputMode="decimal" min="1" step="any" value={scoreMax} onChange={e => setScoreMax(e.target.value)} /></label>}
        <p className="muted">Different result types are never compared with each other.</p>
      </fieldset>
      <details>
        <summary>Subject results <small className="muted">(optional; they do not have to add up to the overall result)</small></summary>
        {scale === 'marks' || scale === 'unknown'
          ? <p className="muted">Subject results here are recorded as numbers whose type is not stated.</p> : null}
        <ul className="class-log__list">
          {subjects.map(s => <li key={s.id}><label>{s.name} <input type="number" inputMode="decimal" min="0" step="any" value={topics[s.id] ?? ''} onChange={e => setTopics({ ...topics, [s.id]: e.target.value })} aria-label={`${s.name} result`} /></label></li>)}
        </ul>
      </details>
      <fieldset>
        <legend>What went wrong <small className="muted">(optional)</small></legend>
        {(Object.keys(DIFFICULTIES) as Difficulty[]).map(d => (
          <label key={d} style={{ display: 'block' }}><input type="checkbox" checked={diff.has(d)} onChange={e => { const n = new Set(diff); e.target.checked ? n.add(d) : n.delete(d); setDiff(n) }} /> {DIFFICULTIES[d]}</label>
        ))}
        <label>Notes <small className="muted">(optional, your own words)</small> <textarea value={notes} maxLength={500} rows={3} onChange={e => setNotes(e.target.value)} /></label>
      </fieldset>
      {error && <p role="alert" className="review-error">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Save this mock'}</button>
      <p className="muted">Saving records what you report. It does not add a booking, change your week or count as a test result.</p>
    </form>
  )
}

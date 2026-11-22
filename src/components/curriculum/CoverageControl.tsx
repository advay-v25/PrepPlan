'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const OPTIONS = [{ v: 'not_started', label: 'Not covered yet' }, { v: 'partly', label: 'Partly covered' }, { v: 'covered', label: 'Covered' }] as const
type Value = (typeof OPTIONS)[number]['v']

/**
 * What the student REPORTS having covered of ONE reading (canonical id, with its subject). A report, not timed study, not a test result and not understanding:
 * it never changes what the tests show and never reschedules accepted work. A failed save keeps the student's choice on screen with Retry; a reading whose coverage
 * a test or diagnostic already owns is shown as protected and cannot be overwritten here.
 */
export function CoverageControl({ readingId, topicId, label, current, protectedBy }: { readingId: string; topicId: string; label: string; current: Value; protectedBy: string | null }) {
  const router = useRouter()
  const [saved, setSaved] = useState<Value>(current), [chosen, setChosen] = useState<Value>(current)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)

  async function save(v: Value) {
    setChosen(v); setBusy(true); setError(null)
    try {
      const res = await fetch('/api/curriculum/coverage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: [{ readingId, topicId, state: v }] }) })
      const b = await res.json().catch(() => null)
      if (res.ok && b?.ok) { setSaved(v); router.refresh() }
      else setError(res.status === 409 && b?.code === 'VERIFIED_COVERAGE_PROTECTED' ? 'Your answers already verified this reading, so a report cannot replace it. Nothing was saved.' : (b?.error ?? 'That was not saved. Nothing changed.'))
    } catch { setError('Could not reach the server. That was not saved.') }
    setBusy(false)
  }

  return (
    <div className="coverage-control" role="radiogroup" aria-label={`What have you covered of ${label}?`}>
      {OPTIONS.map(o => (
        <label key={o.v} className={chosen === o.v ? 'is-on' : ''}>
          <input type="radio" name={`coverage-${readingId}`} checked={chosen === o.v} disabled={busy || protectedBy !== null} onChange={() => save(o.v)} /> {o.label}
        </label>
      ))}
      {protectedBy && <p className="muted">{protectedBy}</p>}
      {error && <p role="alert" className="review-error">{error} <button type="button" className="text-button" onClick={() => save(chosen)}>Try again</button>{chosen !== saved && <> <button type="button" className="text-button" onClick={() => { setChosen(saved); setError(null) }}>Keep what was saved</button></>}</p>}
      <p className="fine-print">Your own report. Only tests show understanding; nothing already planned changes.</p>
    </div>
  )
}

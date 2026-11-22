'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AssessmentDecision } from '../../lib/tests/assessmentDecision'
import { StartButton } from './StartButton'

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; decision: AssessmentDecision } | { kind: 'error'; message: string }

/**
 * Review first, then start. "Review" calls the read-only preflight (it reserves nothing, uses no freshness and starts no clock);
 * the only thing that creates a paper is the explicit Start button, which re-checks everything on the server. The selection stays
 * on screen whatever the outcome, so a refusal never costs the student their choice.
 */
export function PreflightStart({ body, reviewLabel = 'Review and start', startLabel = 'Start', className = 'primary-button', disabled }: {
  body: Record<string, unknown>; reviewLabel?: string; startLabel?: string; className?: string; disabled?: boolean
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  async function review() {
    setPhase({ kind: 'loading' })
    try {
      const res = await fetch('/api/tests/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.ok) setPhase({ kind: 'ready', decision: data.decision as AssessmentDecision })
      else setPhase({ kind: 'error', message: data.error ?? 'Could not check this paper.' })
    } catch {
      setPhase({ kind: 'error', message: 'Connection lost. Nothing was started. Try again.' })
    }
  }
  const d = phase.kind === 'ready' ? phase.decision : null
  return (
    <div className="preflight" data-preflight={phase.kind}>
      <button type="button" className={className} disabled={disabled || phase.kind === 'loading'} aria-expanded={phase.kind === 'ready'} onClick={review}>
        {phase.kind === 'loading' ? 'Checking…' : phase.kind === 'ready' ? 'Check again' : reviewLabel}
      </button>
      {phase.kind === 'error' && (
        <p role="alert" className="review-error">{phase.message} <button type="button" className="text-button" onClick={review}>Retry</button></p>
      )}
      {d && (
        <div className="preflight__result" role="status" aria-live="polite">
          <p><strong>{d.purposeLabel || 'Your check'}</strong></p>
          {d.state === 'start' && (
            <>
              <p>{d.deliverable < d.requested ? `${d.deliverable} of ${d.requested} planned questions can be served` : `${d.deliverable} questions`} · about {d.minutes} minutes{d.timed ? ' on a timer' : ', no timer'} · at most {d.ceiling}.</p>
              {d.readings.length > 0 && <p className="muted">{d.readings.map(r => `${r.name}: ${r.delivered}${r.delivered < r.wanted ? ` of ${r.wanted}` : ''}`).join(' · ')}</p>}
              {d.pending.capacityTotal > 0 && <p className="muted">{d.pending.capacityTotal} confirmed outcome{d.pending.capacityTotal === 1 ? '' : 's'} will not be asked in this part.{d.furtherPaper ? ` ${d.furtherPaper.tradeoff}` : ''}</p>}
              {d.pending.bank.length > 0 && <p className="muted">Not enough reviewed questions yet for {d.pending.bank.map(b => b.name).join('; ')}. Those stay untested; nothing unrelated fills them.</p>}
              {d.difficulty && (
                <>
                  <p>{d.difficulty.explanation}</p>
                  <details><summary>Why this mix</summary>
                    <p className="muted">{d.difficulty.target.foundation} foundation · {d.difficulty.target.standard} standard · {d.difficulty.target.difficult} difficult planned{d.difficulty.actual ? `; ${d.difficulty.actual.foundation} · ${d.difficulty.actual.standard} · ${d.difficulty.actual.difficult} available as reviewed levels${d.difficulty.actual.unclassified ? `, ${d.difficulty.actual.unclassified} not yet level-reviewed` : ''}` : ''}.</p>
                    <ul>{d.difficulty.readings.map(r => <li key={r.readingId}><strong>{r.name}</strong>: {r.label}{r.basis === 'reading' ? ' (broader reading context)' : ''}. {r.reasons.join(' ')}</li>)}</ul>
                    <p className="muted">A rules-based setting, not an exam-difficulty distribution or a measure of ability. Scores from papers with different mixes are not directly comparable.</p>
                  </details>
                </>
              )}
              <p className="muted">Starting reserves these questions. Reviewing did not.</p>
              <StartButton label={startLabel} body={{ ...body, ...(d.difficulty ? { expectedDecision: d.difficulty.evidenceRevision } : {}) }} />
            </>
          )}
          {d.state === 'resume' && d.attemptId && <p><Link className="primary-button" href={`/app/tests/${d.attemptId}`}>Resume your paper</Link></p>}
          {d.state !== 'start' && d.state !== 'resume' && (
            <>
              <p>{d.message ?? 'This cannot start right now.'}</p>
              {d.reasons.length > 0 && <ul>{d.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}</ul>}
              {d.next && <p><Link className="secondary-button" href={d.next.href}>{d.next.label}</Link></p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

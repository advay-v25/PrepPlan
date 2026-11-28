'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import type { AdaptiveStepView, AdaptiveTier } from '../../lib/tests/adaptiveItemPractice'

export type AdaptiveRunPayload = {
  id: string
  readingId: string
  readingName: string
  outcomeIds: string[]
  policyVersion: string
  status: 'active' | 'finished_shortage' | 'completed' | 'stopped'
  targetTier: AdaptiveTier
  targetLabel: 'Easy' | 'Medium' | 'Hard'
  shortageTier: AdaptiveTier | null
  shortageReason: string | null
  revision: number
  steps: AdaptiveStepView[]
  activeStep: AdaptiveStepView | null
}

/**
 * Item-by-item adaptive practice runner (`adaptive-item.1`).
 * Commits one answer at a time, reveals feedback only after commitment,
 * preserves sequence on refresh/retry, and handles explicit tier shortage.
 */
export function AdaptiveItemRunner({ initialRun }: { initialRun: AdaptiveRunPayload }) {
  const [run, setRun] = useState<AdaptiveRunPayload>(initialRun)
  const [selected, setSelected] = useState<number | null>(null)
  const [lastCommittedSeq, setLastCommittedSeq] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<{ seq: number; selectedOptionIndex: number | null; omitted: boolean; requestKey: string } | null>(null)

  const committedSteps = run.steps.filter(s => s.committedOutcome !== null)
  const lastFeedbackStep = lastCommittedSeq ? committedSteps.find(s => s.seq === lastCommittedSeq) ?? null : null
  const active = run.activeStep

  async function submitChoice(omitted?: boolean) {
    if (!active || busy) return
    if (!pending.current) {
      if (omitted === undefined || (!omitted && selected === null)) return
      pending.current = { seq: active.seq, selectedOptionIndex: omitted ? null : selected, omitted, requestKey: crypto.randomUUID() }
    }
    const submission = pending.current
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tests/adaptive-item/${run.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', ...submission }),
      })
      const d = await res.json()
      if (!res.ok || !d.ok) {
        setError(d.message ?? 'Could not commit answer. Retry your submission.')
        if (d.run) setRun(d.run)
        if (['ALREADY_SCORED', 'RUN_CLOSED', 'KEY_CONFLICT', 'NOT_FOUND'].includes(String(d.code).toUpperCase())) {
          const latest = await fetch(`/api/tests/adaptive-item/${run.id}`, { cache: 'no-store' })
          const current = await latest.json()
          if (latest.ok && current.run) {
            setRun(current.run)
            setSelected(null)
            pending.current = null
          }
        }
        return
      }
      if (d.run) setRun(d.run)
      setLastCommittedSeq(submission.seq)
      setSelected(null)
      pending.current = null
    } catch {
      setError('Connection lost. Retrying uses the same submission key.')
    } finally {
      setBusy(false)
    }
  }

  async function stopRun() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tests/adaptive-item/${run.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', expectedRevision: run.revision }),
      })
      const d = await res.json()
      if (d.run) setRun(d.run)
      if (!res.ok || !d.ok) setError(d.message ?? 'Could not end run.')
    } catch {
      setError('Connection lost. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const labels = ['A', 'B', 'C']
  return (
    <main className="page-shell" aria-labelledby="adaptive-item-h">
      <header className="page-header">
        <p className="eyebrow">Practice only · {run.policyVersion} · Does not affect understanding signal</p>
        <h1 id="adaptive-item-h">{run.readingName}</h1>
        <p className="muted">
          Status: <strong>{run.status}</strong> · Current tier: <strong>{run.targetLabel}</strong> · Completed: {committedSteps.length}
        </p>
      </header>

      {error && (
        <div role="alert" className="review-error" style={{ marginBottom: '1rem' }}>
          {error}{' '}
          {active && pending.current && (
            <button type="button" className="text-button" disabled={busy} onClick={() => submitChoice()}>
              Retry
            </button>
          )}
        </div>
      )}

      {lastFeedbackStep && (
        <section aria-label="Last committed feedback" className="card" style={{ marginBottom: '1.25rem', padding: '1rem' }}>
          <p>
            <strong>Question {lastFeedbackStep.seq} ({lastFeedbackStep.tierLabel}):</strong>{' '}
            {lastFeedbackStep.committedOutcome === 'correct'
              ? 'Correct'
              : lastFeedbackStep.committedOutcome === 'incorrect'
                ? 'Incorrect'
                : lastFeedbackStep.committedOutcome}
          </p>
          {lastFeedbackStep.selectedOptionIndex !== null && lastFeedbackStep.perOptionFeedback && (
            <p>{lastFeedbackStep.perOptionFeedback[String(lastFeedbackStep.selectedOptionIndex)]}</p>
          )}
          {lastFeedbackStep.keyIndex !== undefined && (
            <p className="muted">Key: <strong>{labels[lastFeedbackStep.keyIndex]}</strong>{lastFeedbackStep.solution ? ` — ${lastFeedbackStep.solution}` : ''}</p>
          )}
        </section>
      )}

      {run.status === 'active' && active ? (
        <section aria-label={`Question ${active.seq}`} className="card" style={{ padding: '1.25rem' }}>
          <p className="eyebrow">Question {active.seq} · {active.tierLabel}</p>
          <p style={{ whiteSpace: 'pre-line', marginBottom: '1rem' }}>{active.stem}</p>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 1rem 0' }}>
            <legend className="visually-hidden">Answer choices</legend>
            {active.options.map((opt, idx) => (
              <label key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`q-${active.seq}`}
                  checked={selected === idx}
                  onChange={() => { setSelected(idx); setError(null) }}
                  disabled={busy || pending.current !== null}
                />
                <span><strong>{labels[idx]}.</strong> {opt}</span>
              </label>
            ))}
          </fieldset>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="primary-button" disabled={busy || pending.current !== null || selected === null} onClick={() => submitChoice(false)}>
              {busy ? 'Submitting…' : 'Submit answer'}
            </button>
            <button type="button" className="secondary-button" disabled={busy || pending.current !== null} onClick={() => submitChoice(true)}>
              Skip (omit)
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={stopRun}>
              End practice
            </button>
          </div>
        </section>
      ) : (
        <section aria-label="Practice summary" className="card" style={{ padding: '1.25rem' }}>
          <h2>{run.status === 'finished_shortage' ? 'Practice ended — tier inventory reached' : 'Practice ended'}</h2>
          {run.status === 'finished_shortage' && (
            <p role="status">
              {run.shortageReason ?? `No eligible ${run.shortageTier ?? run.targetTier} routine items remain for this scope.`}
            </p>
          )}
          <p>
            Answered: {committedSteps.filter(s => s.committedOutcome === 'correct' || s.committedOutcome === 'incorrect').length} ·{' '}
            Correct: {committedSteps.filter(s => s.committedOutcome === 'correct').length}
          </p>
          <p style={{ marginTop: '1rem' }}>
            <Link className="primary-button" href="/app/tests">Back to Tests</Link>
          </p>
        </section>
      )}
    </main>
  )
}

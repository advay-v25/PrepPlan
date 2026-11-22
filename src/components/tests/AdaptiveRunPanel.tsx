'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Run = {
  id: string; cap: number; status: string; revision: number; delivered: number; answered: number; correct: number; action: 'continue' | 'resume' | 'summary' | 'stop' | 'ended'; finished: boolean; openAttemptId: string | null
  sets: { block: number; attemptId: string; status: string; decision: { profile?: string; reasons?: string[] }; stats: { answered: number; correct: number; size: number } | null }[]
  next: { state: string; label: string; message: string | null; reasons: string[]; target: Record<string, number>; deliverable: number } | null
}

/** What a finished practice set shows, and the explicit choices that follow. Nothing is reserved until the student chooses Continue. */
export function AdaptiveRunPanel({ runId, attemptId }: { runId: string; attemptId: string }) {
  const router = useRouter()
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'next' | 'stop' | null>(null)
  const key = useRef<string | null>(null)
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/tests/practice-runs/${runId}`, { cache: 'no-store' }); const d = await r.json()
      if (d.ok) { setRun(d.run); setError(null) } else setError('This practice run could not be loaded. Your answers are saved.')
    } catch { setError('Connection lost. Your answers are saved; try again.') }
  }, [runId])
  useEffect(() => { void load() }, [load])

  async function act(kind: 'next' | 'stop') {
    if (!run) return
    setBusy(kind); setError(null)
    if (kind === 'next') key.current ??= crypto.randomUUID()
    try {
      const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'next' ? { expectedRevision: run.revision, requestKey: key.current } : { expectedRevision: run.revision }) }
      // Two literal calls (not one templated kind) so the route audit checks each real endpoint.
      const res = await (kind === 'next' ? fetch(`/api/tests/practice-runs/${runId}/next`, init) : fetch(`/api/tests/practice-runs/${runId}/stop`, init))
      const d = await res.json()
      if (d.ok && kind === 'next') { key.current = null; router.push(d.url); return }
      if (d.ok) { await load(); return }
      key.current = null
      setError(d.message ?? 'That did not work. Nothing was started.'); await load()
    } catch { setError('Connection lost. Nothing is assumed: press the button again. A retry reuses the same request, so it cannot start two sets.') }
    finally { setBusy(null) }
  }

  if (!run) return <section className="result-hero" aria-busy={!error}>{error ? <p role="alert" className="review-error">{error} <button type="button" className="text-button" onClick={load}>Retry</button></p> : <p>Loading…</p>}</section>
  const mine = run.sets.find(s => s.attemptId === attemptId)
  const done = run.finished
  return (
    <section className="result-hero" aria-labelledby="run-h" data-run-action={run.action}>
      <h2 id="run-h">{mine?.stats ? `Set ${mine.block}: ${mine.stats.correct} of ${mine.stats.answered} answered correct` : 'Practice set'}</h2>
      {mine?.stats && mine.stats.answered < mine.stats.size && <p className="muted">{mine.stats.size - mine.stats.answered} not answered. Unanswered questions are not treated as wrong.</p>}
      {mine?.decision?.reasons?.[0] && <p className="muted">This set: {mine.decision.reasons[0]}</p>}
      {!done && run.next && run.next.state === 'start' && (
        <>
          <p><strong>If you continue: {run.next.label}.</strong> {run.next.reasons[0]}</p>
          <p className="muted">{run.delivered} of up to {run.cap} questions so far. The next set is reserved only when you press Continue.</p>
        </>
      )}
      {!done && run.next && run.next.state !== 'start' && <p role="status">{run.next.message}</p>}
      {done && (
        <div role="status">
          <h3>Run summary</h3>
          <p>{run.sets.length} set{run.sets.length === 1 ? '' : 's'} · {run.delivered} question{run.delivered === 1 ? '' : 's'} delivered · {run.answered} answered · {run.correct} correct.</p>
          <p className="muted">This was practice: it did not change your understanding signal, close a repair or count toward a weekly paper. A fresh check, not more practice, is what turns something into evidence.</p>
        </div>
      )}
      {error && <p role="alert" className="review-error">{error}</p>}
      <p className="result-hero__actions">
        {run.action === 'continue' && <button type="button" className="primary-button" disabled={busy !== null} onClick={() => act('next')}>{busy === 'next' ? 'Reserving…' : 'Continue to the next set'}</button>}
        {run.action === 'resume' && run.openAttemptId && <Link className="primary-button" href={`/app/tests/${run.openAttemptId}`}>Resume the open set</Link>}
        {(run.action === 'continue' || run.action === 'stop') && <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => act('stop')}>{busy === 'stop' ? 'Ending…' : 'Stop here'}</button>}
        <Link className="secondary-button" href="/app/tests?view=practice">Back to practice</Link>
        {done && <Link className="secondary-button" href="/app/curriculum">Back to Curriculum</Link>}
        <Link className="secondary-button" href="/app/tests">Back to Tests</Link>
      </p>
    </section>
  )
}

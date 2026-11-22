'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RehearsalState, SessionState } from '../../lib/rehearsal/service'

const fmt = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`

/** One session's card. The clock comes from the server: the deadline is fixed when Start is pressed, and a refresh cannot move it. */
function SessionCard({ s, rehearsalId, enabled, busy, onStart, skew }: { s: SessionState; rehearsalId: string; enabled: boolean; busy: boolean; onStart: (n: 1 | 2) => void; skew: number }) {
  const [left, setLeft] = useState<number | null>(s.secondsLeft)
  useEffect(() => {
    if (!s.deadlineAt || s.phase === 'ended') return
    const tick = () => setLeft(Math.max(0, Math.round((new Date(s.deadlineAt!).getTime() - (Date.now() + skew)) / 1000)))
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t)
  }, [s.deadlineAt, s.phase, skew])
  const status = s.phase === 'ended' ? (s.status === 'expired' ? 'Ended — no answers were saved' : 'Finished')
    : s.phase === 'running' ? 'In progress' : s.phase === 'timed_out' ? 'Time ran out' : s.phase === 'waiting' ? 'Starts after session 1' : 'Ready — clock not started'
  return (
    <li className={`rehearsal-session rehearsal-session--${s.phase}`} data-session={s.no} data-phase={s.phase}>
      <h3>Session {s.no} of 2</h3>
      <p><strong>{status}</strong> · {s.questions} questions · {s.minutes} minutes</p>
      {s.phase === 'running' && left !== null && <p role="timer" aria-label={`Session ${s.no} time remaining`}>{fmt(left)} left on the server clock · {s.answered} of {s.questions} answered</p>}
      {s.phase === 'timed_out' && <p>Your saved answers are being scored; unanswered questions are recorded as omitted.</p>}
      {s.phase === 'ended' && s.valid !== null && (s.policy === 'paper-score.1' && s.score !== null
        ? <p>Paper score {s.score}% · {s.valid} of {s.questions} answered{s.questions - s.valid > 0 ? `, ${s.questions - s.valid} not answered` : ''} · {s.correct} of the {s.valid} answered were correct.</p>
        : <p>{s.correct} of {s.valid} answered correctly{s.questions - s.valid > 0 ? ` · ${s.questions - s.valid} not answered` : ''}.</p>)}
      {s.phase === 'not_started' && enabled && (
        <button type="button" className="primary-button" disabled={busy} onClick={() => onStart(s.no)}>{busy ? 'Starting…' : `Start session ${s.no}`}</button>
      )}
      {s.phase === 'running' && <a className="primary-button" href={s.href}>Resume session {s.no}</a>}
      {s.resultHref && <a className="secondary-button" href={s.resultHref}>See session {s.no} result</a>}
    </li>
  )
}

export function RehearsalHub({ state }: { state: RehearsalState }) {
  const router = useRouter()
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const skew = new Date(state.serverNow).getTime() - Date.now()

  // The page only READS. When the server clock has passed a session's deadline, ask the server to finalise it (authenticated, idempotent,
  // checked against the server deadline), then refresh. A failure is shown with a retry; the saved answers are untouched.
  const timedOut = state.sessions.some(s => s.phase === 'timed_out')
  const [settleError, setSettleError] = useState<string | null>(null)
  const settle = async () => {
    setSettleError(null)
    try {
      const r = await (await fetch(`/api/rehearsal/${state.id}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settle' }) })).json()
      if (r.ok) router.refresh(); else setSettleError(r.message ?? 'Could not finish the session yet.')
    } catch { setSettleError('Could not reach PrepPlan. Your saved answers are safe.') }
  }
  useEffect(() => { if (timedOut) void settle() }, [timedOut]) // eslint-disable-line react-hooks/exhaustive-deps

  async function start(n: 1 | 2) {
    setBusy(n); setError(null)
    try {
      const r = await (await fetch(`/api/rehearsal/${state.id}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: n }) })).json()
      if (r.ok) router.push(r.url); else { setError(r.message ?? 'Could not start the session.'); setBusy(null) }
    } catch { setError('Could not reach PrepPlan. Nothing was started; try again.'); setBusy(null) }
  }

  const [s1, s2] = state.sessions
  return (
    <section aria-labelledby="rehearsal-h">
      <h2 id="rehearsal-h">Your rehearsal</h2>
      {state.stage === 'break' && (
        <p className="notice" role="status"><strong>Session 1 is finished.</strong> Take a break. Session 2 starts only when you press Start, and its 135 minutes begin then. Nothing runs while you rest.</p>
      )}
      {state.stage === 'ready' && (
        <div className="notice" role="note">
          <div>
            <strong>Two sessions, two clocks.</strong> Each session has 90 questions and its own 135-minute clock. A clock starts only when you press Start and runs on PrepPlan&rsquo;s server, so closing the tab or refreshing does not pause or extend it.
            <br /><strong>One difference from the real exam:</strong> PrepPlan asks how sure you are for every answer you give. That is extra interaction the official exam does not have, and the clock does not stop for it.
          </div>
        </div>
      )}
      {error && <p role="alert" className="review-error">{error}</p>}
      {settleError && <p role="alert" className="review-error">{settleError} <button type="button" className="text-button" onClick={settle}>Try again</button></p>}
      <ol className="rehearsal-sessions" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {s1 && <SessionCard s={s1} rehearsalId={state.id} enabled={s1.phase === 'not_started'} busy={busy === 1} onStart={start} skew={skew} />}
        {s2 && <SessionCard s={s2} rehearsalId={state.id} enabled={s2.phase === 'not_started'} busy={busy === 2} onStart={start} skew={skew} />}
      </ol>
    </section>
  )
}

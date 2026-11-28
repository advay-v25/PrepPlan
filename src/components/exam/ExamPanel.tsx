'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ExamStatus } from '../../lib/exam/status'
import type { RetakePreview } from '../../lib/exam/retake'
import { onboardingHref, ROUTES } from '../../lib/routing/registry'

const EDIT_EXAM = onboardingHref('exam', ROUTES.app.exam)

/** The student's own exam statement and optional follow-up. Every button sends one command; nothing is inferred. */
export function ExamPanel({ status }: { status: ExamStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [satOn, setSatOn] = useState(status.examDate && status.examDate <= status.today ? status.examDate : status.today)
  const [result, setResult] = useState(status.followUp?.reportedResult ?? '')
  const [note, setNote] = useState(status.followUp?.retakeNote ?? '')
  const [preview, setPreview] = useState<RetakePreview | null>(null)
  // A write returns the fresh version at once; the refreshed props can arrive later, so a quick second action must not send the old one.
  const latest = useRef(status.version)
  if (status.version > latest.current) latest.current = status.version

  async function send(label: string, body: Record<string, unknown>, done: string) {
    setBusy(label); setErr(null); setMsg(null)
    try {
      const r = await (await fetch('/api/exam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: latest.current, ...body }) })).json()
      if (r.ok) {
        if (typeof r.status?.version === 'number') latest.current = Math.max(latest.current, r.status.version)
        if (r.preview) { setPreview(r.preview); return }
        if (label === 'cancel' || label === 'activate') setPreview(null)
        setMsg(r.statusUnavailable ? `${done} Reload to see your current exam status.` : done)
        router.refresh()
      } else {
        setErr(r.error ?? 'Could not save the change.')
        if (r.code === 'STALE_RETAKE' || r.code === 'STALE_EXAM') { setPreview(null); router.refresh() }
      }
    } catch {
      setErr(label === 'preview' ? 'Could not prepare the review. Try again.'
        : label === 'activate' ? 'We could not confirm the result. Use the same Start button to check whether this preview was already saved.'
        : 'We could not confirm the result. Refresh to see the current exam status.')
    } finally { setBusy(null) }
  }

  if (status.phase === 'sat') {
    const f = status.followUp
    return (
      <section aria-labelledby="after-h" data-exam-phase="sat">
        <h2 id="after-h">After the exam</h2>
        <p>{status.note} Your plan and history stay available to read; PrepPlan will not nudge you to study.</p>
        <p><button type="button" className="text-button" disabled={busy !== null} onClick={() => send('undo', { action: 'undo' }, 'Study prompts are back on.')}>I did not sit it after all</button></p>

        <h3>Practical Skills Module</h3>
        <p className="muted">CFA Institute requires the Practical Skills Module before results are released. This is an optional reminder; PrepPlan does not teach or track the module itself.</p>
        <p role="group" aria-label="Practical Skills Module status">{(['done', 'not_done', 'unsure'] as const).map(v => (
          <button key={v} type="button" className={f?.psm === v ? 'primary-button' : 'secondary-button'} aria-pressed={f?.psm === v} disabled={busy !== null} onClick={() => send(`psm-${v}`, { action: 'follow_up', psm: v }, 'Saved.')}>{v === 'done' ? 'It is done' : v === 'not_done' ? 'Not yet' : 'Not sure'}</button>
        ))}</p>

        <h3>Your result (optional)</h3>
        <p className="muted">Only if you want to. It is kept as your own words and never turned into a score. PrepPlan never calls an internal score a pass or a fail.</p>
        <label htmlFor="exam-result">What you were told</label>{' '}
        <input id="exam-result" className="ob-input" maxLength={80} value={result} onChange={e => setResult(e.target.value)} placeholder="e.g. passed, or a band" />{' '}
        <button type="button" className="secondary-button" disabled={busy !== null || !result.trim()} onClick={() => send('result', { action: 'follow_up', result }, 'Saved as your own report.')}>Save</button>

        <h3>If you want to retake</h3>
        <p className="muted">Choose your next exam date, then review the study plan before resuming.</p>
        <label htmlFor="exam-retake">Anything that should shape it (optional)</label>{' '}
        <input id="exam-retake" className="ob-input" maxLength={500} value={note} onChange={e => setNote(e.target.value)} />{' '}
        <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => send('retake', { action: 'follow_up', retake: true, retakeNote: note }, 'Retake request saved.')}>Request a retake plan</button>
        {f?.retakeRequestedAt && <p role="status">Retake requested. <Link className="prose-link" href={EDIT_EXAM}>Choose your next exam date</Link>.</p>}
        {f?.retakeRequestedAt && status.examDate && status.satOn && status.examDate > status.satOn && status.examDate >= status.today && (
          <div data-retake-activate>
            <h3>New sitting: {status.examDate}</h3>
            <p className="muted">This date is saved. Study prompts stay paused until you start. The sitting you completed on {status.satOn}, any reported result and your previous study work stay in your history.</p>
            {!preview ? <button type="button" className="primary-button" disabled={busy !== null} onClick={() => send('preview', { action: 'preview_retake' }, '')}>{busy === 'preview' ? 'Preparing…' : 'Preview my retake plan'}</button> : (
              <section aria-label="Retake preparation preview" className="note retake-preview" data-testid="retake-preview">
                <h4>Study plan for {preview.examDate}</h4>
                <p>{preview.week.start} to {preview.week.end}. {preview.keepsWeek ? 'Your accepted week stays as scheduled.' : 'The previous week goes into Calendar history. This is the new week you are reviewing.'}</p>
                {preview.sessions.length === 0 ? <p>{preview.keepsWeek ? 'There is no remaining study work in the accepted week.' : 'The planner found no study blocks that fit the time available. You can resume with an empty week.'}</p> :
                  <ul>{preview.sessions.map(session => <li key={session.id}>{session.date ?? 'Unplaced'} · {session.title} · {session.minutes} min</li>)}</ul>}
                {preview.paper === 'none' && <p>There is no paper in this preview. Tests checks your recorded coverage and available questions.</p>}
                <button type="button" className="primary-button" disabled={busy !== null} onClick={() => send('activate', { action: 'activate_retake', draftId: preview.draftId, revision: preview.revision }, 'New sitting started. Your earlier sitting stays in your history.')}>Start preparing for this sitting</button>{' '}
                <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => send('cancel', { action: 'cancel_retake', draftId: preview.draftId, revision: preview.revision }, 'Preview cancelled. Study is still paused.')}>Cancel preview</button>
              </section>
            )}
          </div>
        )}
        {msg && <p role="status">{msg}</p>}{err && <p role="alert" className="review-error">{err}</p>}
      </section>
    )
  }

  const asks = status.phase === 'awaiting_status' || status.phase === 'exam_day' || (status.daysToExam !== null && status.daysToExam <= 0)
  return (
    <section aria-labelledby="exam-h" data-exam-phase={status.phase}>
      <h2 id="exam-h">{status.phase === 'awaiting_status' ? 'Did you sit the exam?' : 'Your exam'}</h2>
      <p>{status.note}</p>
      {status.phase === 'awaiting_status' && <p className="muted">PrepPlan cannot tell from a date or a window ending, so it asks. Study prompts continue until you answer.</p>}
      {asks && (<>
        <label htmlFor="exam-sat-on">The day you sat it</label>{' '}
        <input id="exam-sat-on" type="date" className="ob-input" max={status.today} value={satOn} onChange={e => setSatOn(e.target.value)} />{' '}
        <button type="button" className="primary-button" disabled={busy !== null || !satOn} onClick={() => send('sat', { action: 'sat', satOn }, 'Recorded. Study prompts are paused and your history is kept.')}>{busy === 'sat' ? 'Saving…' : 'I sat the exam'}</button>
        {status.phase === 'awaiting_status' && <> <Link className="secondary-button" href={EDIT_EXAM}>I have not sat it: change my exam date</Link></>}
      </>)}
      {!asks && <p className="muted">When your exam day has come and gone, an &ldquo;I sat the exam&rdquo; button appears here.</p>}
      {msg && <p role="status">{msg}</p>}{err && <p role="alert" className="review-error">{err}</p>}
    </section>
  )
}

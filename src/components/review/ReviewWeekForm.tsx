'use client'

import { formatStudyDate } from '../../lib/format/date'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { DueTask, PreviewResult, RevisionPreview, ReviewClassReport } from '../../lib/planning/weeklyReview/service'
import type { Happened, Next } from '../../lib/planning/weeklyReview/dispositions'
import { RevisionRotation } from './RevisionRotation'
import { AdaptationNote } from './AdaptationNote'
import { onboardingHref } from '../../lib/routing/registry'
import type { WeekAdaptation } from '../../lib/planning/pulse/generateWeek'
import { classLogHref } from '../../lib/routing/calendar'

const HAPPENED: { value: Happened; label: string }[] = [
  { value: 'completed', label: 'Done' },
  { value: 'partial', label: 'Partly done' },
  { value: 'not_done', label: 'Not done' },
  { value: 'unknown', label: 'Not sure' },
]
const NEXT: { value: Next; label: string }[] = [
  { value: 'continue', label: 'Continue next week' },
  { value: 'later', label: 'Keep for later' },
  { value: 'remove', label: 'Remove from the plan' },
]
const ESTIMATES = [15, 30, 45, 60, 90, 120]

type Answer = { happened?: Happened; next?: Next; estimateMinutes?: number | null; placeDate?: string }
type Preview = Extract<PreviewResult, { ok: true }>

function defaultNext(task: DueTask, happened: Happened): Next {
  return happened === 'not_done' && task.execution === 'deferred' ? 'later' : 'continue'
}

export function ReviewWeekForm(props: {
  cycleId: string
  dueTasks: DueTask[]
  classReports: ReviewClassReport[]
  canClose: boolean
  needsNoPaperAck: boolean
  noPaperReason: string | null
  /** The rotation as it looks before any answers; once a preview exists, the preview's own (which accounts for continuing work) replaces it. */
  rotation?: RevisionPreview | null
  adaptation?: WeekAdaptation | null
  /** Answers kept by the server from the latest draft, so editing availability and coming back loses nothing. */
  saved?: { choices: Record<string, unknown>; lighter: boolean; noPaperAcknowledged: boolean; unreportedClassKeys: string[] } | null
}) {
  const router = useRouter()
  // The server's latest draft first (same on server and client, so hydration agrees); then, once mounted, what this
  // browser held when the student left, which also covers answers that were never sent.
  const key = `review-answers:${props.cycleId}`
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => Object.fromEntries(Object.entries(props.saved?.choices ?? {}).map(([id, c]) => {
    const x = c as Answer
    return [id, { happened: x.happened, next: x.next, estimateMinutes: x.estimateMinutes ?? undefined, placeDate: x.placeDate }]
  })))
  const [ack, setAck] = useState(props.saved?.noPaperAcknowledged ?? false)
  const [unreported, setUnreported] = useState<string[]>(props.saved?.unreportedClassKeys ?? [])
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    try { const raw = sessionStorage.getItem(key); const saved = raw ? JSON.parse(raw) : null
      if (saved?.answers) { setAnswers(saved.answers); setAck(saved.ack === true) }
      if (Array.isArray(saved?.unreported)) setUnreported(saved.unreported)
    } catch { /* blocked storage: the server copy stands */ }
    setRestored(true)
  }, [key])
  useEffect(() => { if (restored) try { sessionStorage.setItem(key, JSON.stringify({ answers, ack, unreported })) } catch { /* convenience only */ } }, [key, answers, ack, unreported, restored])
  const [lighter, setLighter] = useState(props.saved?.lighter ?? false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)

  const unanswered = props.dueTasks.filter(t => !answers[t.id]?.happened).length
  const pendingClasses = props.classReports.filter(report => !unreported.includes(report.key)).length
  const ready = props.canClose && unanswered === 0 && pendingClasses === 0 && (!props.needsNoPaperAck || ack)

  const set = (id: string, patch: Answer) => { setPreview(null); setAnswers(s => ({ ...s, [id]: { ...s[id], ...patch } })) }

  async function buildPreview(current: Record<string, Answer> = answers, makeLighter: boolean = lighter) {
    setBusy(true); setMessage(null)
    try {
      const choices = Object.fromEntries(props.dueTasks.map(t => {
        const a = current[t.id]
        return [t.id, {
          happened: a.happened,
          ...(a.happened === 'completed' ? {} : { next: a.next ?? defaultNext(t, a.happened!) }),
          ...(a.estimateMinutes ? { estimateMinutes: a.estimateMinutes } : {}),
          ...(a.placeDate ? { placeDate: a.placeDate } : {}),
        }]
      }))
      const res = await fetch('/api/weekly-review/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycleId: props.cycleId, choices, acknowledgeNoPaper: props.needsNoPaperAck && ack, lighter: makeLighter,
          unreportedClassKeys: props.classReports.filter(report => unreported.includes(report.key)).map(report => report.key),
        }),
      })
      const body = await res.json()
      if (body.ok) setPreview(body); else setMessage(body.message ?? body.error ?? 'Could not prepare the review.')
    } catch { setMessage('Could not reach PrepPlan. Nothing was changed. Try again.') }
    finally { setBusy(false) }
  }

  /** Moving a continuing task is part of reviewing the proposal: rebuild it so what is shown is what will be saved. */
  async function choosePlace(taskId: string, value: string) {
    const next = { ...answers, [taskId]: { ...answers[taskId], placeDate: value } }
    setAnswers(next)
    await buildPreview(next)
  }

  async function toggleLighter() {
    const next = !lighter
    setLighter(next)
    await buildPreview(answers, next)
  }

  async function save() {
    if (!preview) return
    setBusy(true); setMessage(null)
    try {
      const res = await fetch('/api/weekly-review/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: preview.draftId }),
      })
      const body = await res.json()
      if (body.ok) { try { sessionStorage.removeItem(key) } catch { /* convenience only */ }; router.push(body.nextUrl ?? '/app/calendar'); return }
      setMessage(body.message ?? body.error ?? 'Save not confirmed.')
      if (body.code === 'stale' || body.code === 'unavailable') { setPreview(null); router.refresh() }   // answers are kept
    } catch {
      // A lost response is not proof nothing was saved; saving the same review again is safe.
      setMessage('Save not confirmed. Check your current week, or save again: saving twice cannot create a second week.')
    } finally { setBusy(false) }
  }

  if (preview) {
    const days = preview.next.placementDates ?? preview.next.week.days
    const dayLabel = (d: string) => formatStudyDate(d, 'short')
    const placed = preview.continuing.filter(c => c.placement.date)
    const unplaced = preview.continuing.filter(c => !c.placement.date)
    return (
      <div className="review-form">
        <h2>Next week, as it will be saved</h2>
        <p>These are the exact days that will be saved. Nothing is scheduled until you save.</p>
        {pendingClasses === 0 && props.classReports.length > 0 && (
          <p className="fine-print">{props.classReports.length} class {props.classReports.length === 1 ? 'report will' : 'reports will'} be left unreported. Coverage you already saved stays recorded.</p>
        )}
        <AdaptationNote adaptation={preview.next.adaptation} />
        <p>
          <button type="button" className="secondary-button" disabled={busy} aria-pressed={lighter} onClick={toggleLighter}>{lighter ? 'Back to the standard draft' : 'Make this draft lighter'}</button>{' '}
          <Link href={onboardingHref('week', '/app/review-week')}>Edit your availability</Link>
          <small className="fine-print"> Your answers here are kept when you come back.</small>
        </p>

        {preview.continuing.length > 0 && (
          <section aria-labelledby="cont-h">
            <h3 id="cont-h">Continuing from this week</h3>
            <ul className="review-continuing">
              {preview.continuing.map(c => (
                <li key={c.taskId}>
                  <strong>{c.title}</strong> <small>· {c.minutes} min{c.provisional ? ' (a first guess)' : ''}</small>
                  <div>
                    <label>Day{' '}
                      <select value={c.placement.date ?? 'none'} disabled={busy} onChange={e => choosePlace(c.taskId, e.target.value)} aria-label={`Day for ${c.title}`}>
                        {days.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}
                        <option value="none">Leave unplaced</option>
                      </select>
                    </label>
                  </div>
                  {c.placement.date && c.placement.note && <small className="fine-print">{c.placement.note}</small>}
                  {!c.placement.date && c.placement.reason && (
                    <small className="fine-print">Not placed: {c.placement.reason}{c.intent === 'continue' ? ' Choose a day, leave it for Calendar, or update your availability.' : ''}</small>
                  )}
                </li>
              ))}
            </ul>
            <p className="fine-print">
              {placed.length} placed, {unplaced.length} waiting. Unplaced work stays visible in Calendar. Your earlier progress and time stay with this week; these start fresh, so nothing is counted twice.
            </p>
          </section>
        )}

        {preview.displaced.length > 0 && (
          <section aria-labelledby="moved-h">
            <h3 id="moved-h">New work that moved</h3>
            <ul>
              {preview.displaced.map((d, i) => (
                <li key={i}>{d.title}: {d.mode === 'moved_back' ? 'moved to a later week' : `shortened by ${d.minutesRemoved} min`}. <small>{d.reason}</small></li>
              ))}
            </ul>
            <p className="fine-print">Continuing work takes the place of new work rather than adding to your week. Moved work is not lost; it returns in a later plan.</p>
          </section>
        )}
        {(preview.classFollowUp.placed.length > 0 || preview.classFollowUp.waiting.length > 0) && (
          <section aria-labelledby="cf-h" data-testid="review-class-followup">
            <h3 id="cf-h">Class follow-up that never got a slot</h3>
            <ul>
              {preview.classFollowUp.placed.map((c, i) => <li key={`p${i}`}>{c.title}: {c.minutes} min on {c.date}.</li>)}
              {preview.classFollowUp.waiting.map((c, i) => <li key={`w${i}`}>{c.title}: {c.remainingMinutes} min still waiting. <small>{c.reason}</small></li>)}
            </ul>
            <p className="fine-print">These are minutes from classes you logged that did not fit when you logged them. They are part of the plan below only if you accept it; anything still waiting is carried to the next review.</p>
          </section>
        )}
        {preview.duplicatesRemoved > 0 && (
          <p className="fine-print">{preview.duplicatesRemoved} planned item{preview.duplicatesRemoved === 1 ? '' : 's'} left out because exactly the same work is already continuing.</p>
        )}

        <section aria-labelledby="new-h">
          <h3 id="new-h">Planned for {preview.next.week.startDate} – {preview.next.week.endDate}</h3>
          {preview.next.taskCount === 0 && placed.length === 0
            ? <p>No study work is planned for this week. That is allowed: you can place work yourself, or <Link href={onboardingHref('week', '/app/review-week')}>update your availability</Link>.</p>
            : <ol>{preview.next.days.map(d => <li key={d.date}><strong>{dayLabel(d.date)}</strong><ul>
                {d.items.map((i, n) => <li key={n}>{i.title} <small>· {i.minutes} min</small></li>)}
                {placed.filter(c => c.placement.date === d.date).map(c => <li key={c.taskId}>{c.title} <small>· {c.minutes} min · continuing</small></li>)}
              </ul></li>)}
              {days.filter(d => !preview.next.days.some(x => x.date === d) && placed.some(c => c.placement.date === d)).map(d => (
                <li key={d}><strong>{dayLabel(d)}</strong><ul>{placed.filter(c => c.placement.date === d).map(c => <li key={c.taskId}>{c.title} <small>· {c.minutes} min · continuing</small></li>)}</ul></li>
              ))}</ol>}
        </section>
        <RevisionRotation revision={preview.next.revision} />
        {busy && <p role="status" className="fine-print">Updating your draft…</p>}
        {message && <p role="alert" className="review-error">{message}</p>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>Change my answers</button>{' '}
        <button type="button" className="primary-button" disabled={busy} onClick={save}>{busy ? 'Working…' : 'Save review and open next week'}</button>
      </div>
    )
  }

  return (
    <div className="review-form">
      <AdaptationNote adaptation={props.adaptation ?? null} />
      {props.adaptation && <p className="fine-print">This reads your earlier finished weeks. What you tell us about this week is added when you preview next week.</p>}
      <p className="fine-print">Free time wrong? <Link href={onboardingHref('week', '/app/review-week')}>Edit your availability</Link>. Your answers below are kept when you come back.</p>
      <RevisionRotation revision={props.rotation ?? null} />
      {props.classReports.length > 0 && <fieldset className="review-tasks">
        <legend>Class reports still open</legend>
        <p className="fine-print">Choose how to close the week for each class. Coverage already saved stays recorded.</p>
        {props.classReports.map(report => <div key={report.key} className="review-task">
          <p><strong>{report.label}</strong> · {report.date}{report.originalDate !== report.date ? ` (moved from ${report.originalDate})` : ''} · {report.sessionId ? 'Saved and still open' : 'No report'}</p>
          <Link prefetch={false} href={classLogHref({ sessionId: report.sessionId ?? undefined, occurrenceKey: report.key, fromReview: true })}>{report.sessionId ? 'Open saved class log' : 'Log this class'}</Link>
          <label className="review-ack"><input type="checkbox" checked={unreported.includes(report.key)} onChange={e => {
            const leave = e.target.checked
            setPreview(null)
            setUnreported(keys => leave ? [...keys, report.key] : keys.filter(k => k !== report.key))
          }} /> Leave unreported</label>
        </div>)}
      </fieldset>}
      {props.dueTasks.length > 0 && (
        <fieldset className="review-tasks">
          <legend>What happened with unfinished work, and what should happen next?</legend>
          {props.dueTasks.map(t => {
            const a = answers[t.id] ?? {}
            const showNext = a.happened && a.happened !== 'completed'
            return (
              <div key={t.id} className="review-task">
                <span>{t.title}<small> · {t.localDate ?? 'Not yet placed'}</small></span>
                <div role="radiogroup" aria-label={`What happened with ${t.title}`} className="review-choices">
                  {HAPPENED.map(c => (
                    <label key={c.value}>
                      <input type="radio" name={`h-${t.id}`} checked={a.happened === c.value} onChange={() => set(t.id, { happened: c.value })} />
                      {c.label}
                    </label>
                  ))}
                </div>
                {showNext && (
                  <div role="radiogroup" aria-label={`What next for ${t.title}`} className="review-choices">
                    {NEXT.map(c => (
                      <label key={c.value}>
                        <input type="radio" name={`n-${t.id}`} checked={(a.next ?? defaultNext(t, a.happened!)) === c.value} onChange={() => set(t.id, { next: c.value })} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
                {a.happened === 'partial' && (a.next ?? 'continue') !== 'remove' && (
                  <label className="fine-print">About how much time to finish?{' '}
                    <select value={a.estimateMinutes ?? ''} onChange={e => set(t.id, { estimateMinutes: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Not sure</option>
                      {ESTIMATES.map(m => <option key={m} value={m}>{m} min</option>)}
                    </select>
                  </label>
                )}
                {a.happened === 'unknown' && <small className="fine-print">It will stay visible as needing confirmation. Nothing is counted as done or missed.</small>}
              </div>
            )
          })}
        </fieldset>
      )}

      {props.needsNoPaperAck && (
        <label className="review-ack">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
          Close this week without a paper. {props.noPaperReason}
        </label>
      )}

      {message && <p role="alert" className="review-error">{message}</p>}

      <button type="button" className="primary-button" disabled={!ready || busy} onClick={() => buildPreview()}>
        {busy ? 'Preparing…' : 'Preview next week'}
      </button>
      {!ready && props.canClose && unanswered > 0 && (
        <p className="review-hint">{unanswered} task{unanswered === 1 ? ' still needs' : 's still need'} an answer.</p>
      )}
    </div>
  )
}

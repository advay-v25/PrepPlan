'use client'

import { formatStudyDate } from '../../lib/format/date'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { calendarTaskHref } from '../../lib/routing/calendar'
import Link from 'next/link'
import { CalendarClock, Loader2, Pencil } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Notice } from '../ui/Notice'
import { MOCK_KINDS, MOCK_KIND_LABEL, type MockKind } from '../../lib/curriculum/entryContext'
import { checkpointTitle, describeTiming, toHHMM, type AssessmentChoice, type MockOutcome } from '../../lib/curriculum/mockCheckpoint'
import type { AppointmentSummary, CheckpointView, RelatedTask } from '../../lib/planning/checkpointService'
import { RehearsalAction } from '../tests/RehearsalAction'

const longDate = (d: string) => formatStudyDate(d, 'long')
const shortDate = (d: string) => formatStudyDate(d, 'short')
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240, 300]

const CHOICES: { value: AssessmentChoice; label: string; hint: string }[] = [
  { value: 'use_mock', label: 'Use the mock as this week’s assessment', hint: 'No weekly paper is planned for this week.' },
  { value: 'keep_paper', label: 'Keep the weekly paper as well', hint: 'You take both. Neither replaces the other.' },
  { value: 'later', label: 'Decide later', hint: 'Nothing changes yet. This stays on your list until you choose.' },
]

type Reply = { ok: boolean; error?: string; code?: string; replacement?: { paperAvailable: boolean; message: string } | null; replayed?: boolean }
type Send = (intent: string, method: 'PUT' | 'POST' | 'DELETE', body: Record<string, unknown>) => Promise<Reply | null>

/**
 * The student's mock / checkpoint in Calendar. Every change is an explicit action sent as ONE request with a request key that is
 * kept until the request is confirmed: if the response is lost, pressing the button again repeats the same key, so it can only
 * ever take effect once. A request made against an out-of-date checkpoint is refused and the page refreshes.
 */
export function CheckpointPanel({ view, review, defaultDate, today }: { view: CheckpointView | null; review: RelatedTask[]; defaultDate: string; today: string }) {
  const router = useRouter()
  const [dialog, setDialog] = useState<'edit' | 'add' | 'outcome' | 'cancel' | 'paper' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [detailsRef, setDetailsRef] = useState('')
  const editButton = useRef<HTMLButtonElement>(null)
  // One key per intent, reused on retry and dropped only once the server has confirmed it (or definitely refused it).
  const keys = useRef<Record<string, string>>({})
  const keyFor = (intent: string) => (keys.current[intent] ??= crypto.randomUUID())

  const send: Send = async (intent, method, body) => {
    setBusy(intent); setError(''); setInfo(''); setDetailsRef('')
    try {
      const res = await fetch('/api/checkpoints', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyFor(intent), checkpointId: view?.checkpointId ?? null, expectedVersion: view?.version ?? null, ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok !== true) {
        // A definite refusal can never have been applied, so the key is released; anything else keeps it so a retry is the same request.
        if (res.status >= 400 && res.status < 500) delete keys.current[intent]
        const tries = data.code === 'SLOT_TAKEN' && Array.isArray(data.suggestions) && data.suggestions.length ? ` Free times that day: ${data.suggestions.slice(0, 3).map((x: { label?: string }) => x.label).filter(Boolean).join(', ')}.` : ''
        setError((data.error ? data.error + tries : '') || 'That did not save. If you are unsure, check Calendar; sending it again is safe.')
        if (data.code === 'CHECKPOINT_CHANGED') router.refresh()
        return null
      }
      delete keys.current[intent]
      if (data.projectionUnavailable && typeof data.requestId === 'string') setDetailsRef(data.requestId)
      router.refresh()
      return data
    } catch {
      setError('The connection dropped, so it is not confirmed whether that saved. Press the same button again: it is safe to repeat.')
      return null
    } finally { setBusy(null) }
  }

  async function chooseAssessment(choice: AssessmentChoice, paperAction?: 'replace' | 'keep') {
    const done = await send(`choice-${choice}`, 'POST', { action: 'choice', choice, paperAction })
    if (done) { setDialog(null); setInfo(choice === 'later' ? 'Left undecided for now.' : choice === 'use_mock' && paperAction === 'replace' ? 'The mock is this week’s assessment. The unstarted paper was cancelled (its history is kept).' : 'Saved.') }
  }

  function pickChoice(choice: AssessmentChoice) {
    if (!view) return
    if (choice === 'use_mock' && view.paper.onCalendar && !view.paper.started) { setDialog('paper'); return }
    void chooseAssessment(choice)
  }

  async function addSuggestion(s: CheckpointView['suggestions'][number]) {
    const done = await send(`add-${s.id}`, 'POST', { action: 'addSuggestion', suggestionId: s.id })
    if (done) setInfo(`Added “${s.title}”.`)
  }

  async function reviewTask(t: RelatedTask, action: 'removeRelated' | 'keepRelated') {
    const done = await send(`${action}-${t.taskId}`, 'POST', action === 'removeRelated' ? { action, taskId: t.taskId, expectedRevision: t.revision } : { action, taskId: t.taskId })
    if (done) setInfo(action === 'removeRelated' ? `Removed “${t.title}” from your calendar.` : `Kept “${t.title}” as it is.`)
  }

  const reviewList = (list: RelatedTask[]) => list.length > 0 && (
    <div className="cal-checkpoint__review" role="group" aria-label="Preparation that no longer matches your mock">
      <h3>Preparation you added earlier</h3>
      <p className="fine-print">Nothing was changed for you. Decide what to do with each one; work you have started or finished is never moved.</p>
      <ul className="cal-checkpoint__list">
        {list.map(t => (
          <li key={t.taskId} className="cal-checkpoint__item">
            <div>
              <strong>{t.title}</strong>
              <small>{t.date ? shortDate(t.date) : 'No day'} · {t.execution.replace('_', ' ')}</small>
              <small>{t.reason}</small>
            </div>
            <span className="cal-checkpoint__actions">
              <Link className="text-button" href={calendarTaskHref(t.taskId, t.date ?? undefined)}>Open</Link>
              {t.removable && <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => reviewTask(t, 'removeRelated')}>{busy === `removeRelated-${t.taskId}` ? 'Removing…' : 'Remove it'}</button>}
              <button type="button" className="text-button" disabled={busy !== null} onClick={() => reviewTask(t, 'keepRelated')}>Keep it</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )

  const feedback = (<>
    {error && <Notice tone="danger" role="alert">{error}</Notice>}
    {info && <Notice tone="success" role="status">{info}</Notice>}
    {detailsRef && <Notice tone="warn" role="status">Your change was saved. Refresh Calendar to see the updated details. Support reference {detailsRef}</Notice>}
  </>)

  const STATUS_TEXT: Record<string, string> = { completed: 'finished', cancelled: 'cancelled', postponed: 'postponed', missed: 'not taken' }
  const schedule = (view?.appointments.length ?? 0) > 0 && (
    <div className="cal-checkpoint__schedule" role="group" aria-label="Your mock schedule">
      <h3>Your mock schedule</h3>
      <ul className="cal-checkpoint__list">
        {view!.appointments.map((a: AppointmentSummary) => (
          <li key={a.id} className="cal-checkpoint__item" data-appointment={a.id} data-status={a.status} aria-current={a.id === view!.selectedId ? 'true' : undefined}>
            <div>
              <strong>{a.title}</strong>{' '}
              {a.designated && <span className="badge" data-designated>Counts for its week</span>}
              <small>{longDate(a.date)}{a.startTime ? ` · ${a.startTime}${a.durationMinutes ? `–${toHHMM(Math.min(24 * 60 - 1, toMin(a.startTime) + a.durationMinutes))}` : ''}` : ' · date only'} · {MOCK_KIND_LABEL[a.kind]}{a.status !== 'planned' ? ` · ${STATUS_TEXT[a.status] ?? a.status}` : ''}</small>
              {a.rehearsal && <small>Rehearsal: {a.rehearsal.stage === 'complete' ? 'both sessions finished' : a.rehearsal.stage === 'ready' ? 'prepared, not started' : a.rehearsal.stage === 'break' ? 'session 1 finished, session 2 waiting' : `session ${a.rehearsal.stage === 'session2' ? 2 : 1} under way`}</small>}
            </div>
            <span className="cal-checkpoint__actions">
              {a.id === view!.selectedId ? <small>Shown below</small> : <Link className="text-button" href={a.href}>Open</Link>}
              {a.rehearsal?.primary && <Link className="secondary-button" href={a.rehearsal.primary.href}>{a.rehearsal.primary.label}</Link>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )

  if (!view) {
    return (
      <section id="checkpoint" className="cal-checkpoint cal-checkpoint--empty" aria-label="Mock or checkpoint">
        <p><CalendarClock size={16} aria-hidden /> Have a mock or checkpoint coming up? Add it and PrepPlan will plan around it. You can add several, including a PrepPlan rehearsal.</p>
        <button type="button" ref={editButton} className="secondary-button" onClick={() => setDialog('edit')}>Add a mock</button>
        {reviewList(review)}
        {dialog === 'edit' && <EditDialog view={null} defaultDate={defaultDate} onClose={() => { setDialog(null); editButton.current?.focus() }} send={send} busy={busy === 'save'} serverError={error} onSaved={() => setInfo('Mock added.')} />}
        {feedback}
      </section>
    )
  }

  const c = view.checkpoint
  const internal = c.kind === 'internal_rehearsal'
  const thing = internal ? 'rehearsal' : 'mock'
  const paperUnstarted = view.paper.onCalendar && !view.paper.started
  return (
    <section id="checkpoint" className="cal-checkpoint" aria-labelledby="cp-h">
      {schedule}
      <p><button type="button" className="secondary-button" onClick={() => setDialog('add')}>Add another mock or rehearsal</button></p>
      <header className="cal-checkpoint__head">
        <div>
          <p className="cal-summary__label">{internal ? 'PrepPlan rehearsal' : 'Mock or checkpoint'}</p>
          <h2 id="cp-h">{checkpointTitle(c)}</h2>
          <p className="cal-checkpoint__when">{longDate(c.date)} · {describeTiming(c)}</p>
          <p className="fine-print">{MOCK_KIND_LABEL[c.kind]}. Your own entry, not a second exam date.</p>
        </div>
        <div className="cal-checkpoint__actions">
          <button type="button" ref={editButton} className="secondary-button" onClick={() => setDialog('edit')}><Pencil size={14} aria-hidden /> Edit or move</button>
          <button type="button" className="secondary-button" onClick={() => setDialog('outcome')}>{internal ? 'Postpone or skip it' : 'Record what happened'}</button>
          <button type="button" className="text-button" onClick={() => setDialog('cancel')}>Cancel it</button>
        </div>
      </header>

      {internal && <RehearsalAction appointmentId={view.checkpointId} />}

      {view.missing.length > 0 && (
        <p className="fine-print">Not set yet: {view.missing.join(' and ')}. Nothing is reserved on your calendar until you add them; add them whenever you know.</p>
      )}

      {view.conflicts.length > 0 && (
        <Notice tone="warn" role="status">
          This overlaps {view.conflicts.map(x => `${x.title} (${x.overlapMinutes} min)`).join(', ')}. Move one of them in Calendar, or change the mock’s time.
        </Notice>
      )}

      {reviewList(view.related.filter(r => r.needsReview))}

      <fieldset className="cal-checkpoint__choice" aria-describedby="cp-choice-hint">
        <legend>Your assessment this week ({shortDate(view.week.startDate)} – {shortDate(view.week.endDate)})</legend>
        {view.designatedElsewhere && <p className="fine-print" role="status">Your <strong>{view.designatedElsewhere.title}</strong> is the one that counts this week. Choosing this {thing} instead replaces that choice.</p>}
        {view.choice === 'use_mock' && <p className="fine-print" role="status">This {thing} is the one that counts for this week.</p>}
        <p id="cp-choice-hint" className="fine-print">
          {view.choiceUnresolved ? 'Not decided yet. ' : ''}A mock and the weekly paper are both assessments. Choose how they fit together; the {thing} is not assumed to have been {internal ? 'finished' : 'taken'}. {internal ? 'A rehearsal counts only when both of its sessions are finished.' : ''}
        </p>
        {view.paper.onCalendar && (
          <p className="fine-print">
            {view.paper.started
              ? `This week’s paper (${view.paper.title}) has been started or finished, so it stays as it is and the mock can only sit alongside it.`
              : `This week already has a paper: ${view.paper.title}${view.paper.date ? ` on ${shortDate(view.paper.date)}` : ''}. It has not been started.`}
          </p>
        )}
        {CHOICES.map(o => (
          <label key={o.value} className="ob-check cal-checkpoint__option">
            <input type="radio" name="assessment-choice" checked={view.choice === o.value}
              disabled={busy !== null || (o.value === 'use_mock' && view.paper.started)} onChange={() => pickChoice(o.value)} />
            <span><strong>{o.value === 'use_mock' ? `Use this ${thing} as this week’s assessment` : o.label}</strong><small>{o.value === 'use_mock' && paperUnstarted ? 'You will be asked whether it replaces the unstarted paper.' : o.hint}</small></span>
          </label>
        ))}
        {busy?.startsWith('choice') && <p className="fine-print" role="status"><Loader2 size={13} className="animate-spin" aria-hidden /> Saving…</p>}
      </fieldset>

      <div className="cal-checkpoint__suggest">
        <h3>Suggested around it</h3>
        <p className="fine-print">Proposals only. Each is placed in a free study window of your open week and added only if you choose. Self-study keeps Sunday for your paper.</p>
        <ul className="cal-checkpoint__list">
          {view.suggestions.map(s => (
            <li key={s.id} className="cal-checkpoint__item">
              <div>
                <strong>{s.title}</strong>
                <small>{s.minutes} min · {s.date ? `${shortDate(s.date)}${s.startMinutes !== null ? ` at ${toHHMM(s.startMinutes)}` : ''}` : 'Unplaced'}</small>
                <small>{s.unplacedReason ?? s.reason}</small>
              </div>
              {s.taskId ? (
                <Link className="text-button" href={`/app/calendar?week=${s.date ?? ''}&task=${s.taskId}`}>Added — open the task</Link>
              ) : s.addable ? (
                <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => addSuggestion(s)}>{busy === `add-${s.id}` ? 'Adding…' : 'Add to my week'}</button>
              ) : s.date ? <small>{s.laterReason}</small> : null}
            </li>
          ))}
        </ul>
        {view.suggestions.some(s => !s.date) && (
          <p className="fine-print">Unplaced items stay here. <a href="/app/settings" className="prose-link">Adjust your availability</a> to give them room.</p>
        )}
      </div>

      {view.history.length > 0 && (
        <p className="fine-print">Earlier: {view.history.map(h => `${shortDate(h.plannedDate)} ${h.outcome.replace('_', ' ')}${h.actualDate ? ` on ${shortDate(h.actualDate)}` : ''}${h.reportedResult ? ` (you noted ${h.reportedResult})` : ''}`).join('; ')}. These are your own reports.</p>
      )}

      {feedback}

      {dialog === 'add' && <EditDialog view={null} mode="add" defaultDate={defaultDate} onClose={() => { setDialog(null); editButton.current?.focus() }} send={send} busy={busy === 'add'} serverError={error} onSaved={() => setInfo('Added to your schedule.')} />}
      {dialog === 'edit' && <EditDialog view={view} defaultDate={defaultDate} onClose={() => { setDialog(null); editButton.current?.focus() }} send={send} busy={busy === 'save'} serverError={error} onSaved={() => setInfo('Saved. Your roadmap and next-week proposals now use these details.')} />}
      {dialog === 'outcome' && <OutcomeDialog view={view} today={today} onClose={() => { setDialog(null); editButton.current?.focus() }} send={send} busy={busy === 'outcome'} serverError={error} onDone={m => setInfo(m)} />}
      {dialog === 'paper' && (
        <Dialog open onClose={() => { setDialog(null); editButton.current?.focus() }} title="This week already has a paper" size="sm" role="alertdialog"
          description={`${view.paper.title}${view.paper.date ? ` on ${shortDate(view.paper.date)}` : ''} has not been started. Choose what the mock does to it.`}
          footer={<>
            <button type="button" className="text-button" onClick={() => { setDialog(null); editButton.current?.focus() }}>Not now</button>
            <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => chooseAssessment('keep_paper')}>Keep both</button>
            <button type="button" className="primary-button" disabled={busy !== null} onClick={() => chooseAssessment('use_mock', 'replace')}>{busy?.startsWith('choice') ? 'Saving…' : 'Replace the paper with the mock'}</button>
          </>}>
          <p>Replacing cancels the unstarted paper. It is not deleted: it stays in your history, and you can still take a weekly paper later from Tests. Keeping both leaves the paper and the mock as two separate assessments.</p>
          {error && <Notice tone="danger" role="alert">{error}</Notice>}
        </Dialog>
      )}
      {dialog === 'cancel' && (
        <Dialog open onClose={() => { setDialog(null); editButton.current?.focus() }} title="Cancel this mock?" size="sm" role="alertdialog"
          description="It is removed from your calendar and roadmap. Your accepted study plan is not changed."
          footer={<>
            <button type="button" className="secondary-button" onClick={() => { setDialog(null); editButton.current?.focus() }}>Keep it</button>
            <button type="button" className="primary-button" disabled={busy !== null} onClick={async () => {
              const done = await send('cancel', 'DELETE', {})
              if (done) { setDialog(null); setInfo(`Mock cancelled. ${done.replacement?.message ?? ''}`.trim()) }
            }}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel the mock'}</button>
          </>}>
          {view.related.some(r => r.forCurrent) && <p className="fine-print">You added preparation for it. It stays on your calendar until you decide what to do with it; you will be asked next.</p>}
          {error && <Notice tone="danger" role="alert">{error}</Notice>}
        </Dialog>
      )}
    </section>
  )
}

function EditDialog({ view, mode = 'edit', defaultDate, onClose, send, busy, onSaved, serverError }: {
  view: CheckpointView | null; mode?: 'edit' | 'add'; defaultDate: string; onClose: () => void; send: Send; busy: boolean; onSaved: () => void; serverError: string
}) {
  const c = view?.checkpoint
  const [date, setDate] = useState(c?.date ?? defaultDate)
  const [kind, setKind] = useState<MockKind>(c?.kind ?? 'provider_mock')
  const [label, setLabel] = useState(c?.label ?? '')
  const [startTime, setStartTime] = useState(c?.startTime ?? '')
  const [duration, setDuration] = useState(c?.durationMinutes ? String(c.durationMinutes) : '')
  const first = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = { date, kind, label: label.trim() || null, startTime: startTime || null, durationMinutes: duration ? Number(duration) : null }
    const done = mode === 'add' ? await send('add', 'POST', { action: 'add', checkpointId: null, expectedVersion: null, ...body }) : await send('save', 'PUT', body)
    if (done) { onSaved(); onClose() }
  }

  return (
    <Dialog open onClose={onClose} title={mode === 'add' ? 'Add another mock or rehearsal' : view ? 'Edit or move your mock' : 'Add a mock or checkpoint'} size="md" initialFocusRef={first}
      description="Only the date is needed. Add a time and length if you know them; leave them empty if you don’t.">
      <form onSubmit={submit} className="cal-checkpoint__form">
        <label htmlFor="cp-date">Date</label>
        <input ref={first} id="cp-date" type="date" className="ob-input" required value={date} onChange={e => setDate(e.target.value)} />
        <label htmlFor="cp-label">What is it? (optional)</label>
        <input id="cp-label" className="ob-input" maxLength={80} placeholder="Coaching mock" value={label} onChange={e => setLabel(e.target.value)} />
        <label htmlFor="cp-kind">Type</label>
        <select id="cp-kind" className="ob-input" value={kind} onChange={e => setKind(e.target.value as MockKind)}>
          {MOCK_KINDS.map(k => <option key={k} value={k}>{MOCK_KIND_LABEL[k]}</option>)}
        </select>
        <label htmlFor="cp-time">Start time (optional)</label>
        <input id="cp-time" type="time" className="ob-input" value={startTime} onChange={e => setStartTime(e.target.value)} />
        <label htmlFor="cp-dur">Expected length (optional)</label>
        <select id="cp-dur" className="ob-input" value={duration} onChange={e => setDuration(e.target.value)}>
          <option value="">Not set</option>
          {DURATIONS.map(m => <option key={m} value={m}>{m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`}</option>)}
        </select>
        <p className="fine-print">No upload or portal access is needed. Time is only reserved when you give both a start time and a length. Moving it never changes work you have already accepted; you will be asked about any preparation you added.</p>
        {serverError && <Notice tone="danger" role="alert">{serverError}</Notice>}
        <div className="ui-dialog__foot">
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Dialog>
  )
}

function OutcomeDialog({ view, today, onClose, send, busy, onDone, serverError }: {
  view: CheckpointView; today: string; onClose: () => void; send: Send; busy: boolean; onDone: (m: string) => void; serverError: string
}) {
  const internal = view.checkpoint.kind === 'internal_rehearsal'
  const [outcome, setOutcome] = useState<MockOutcome>(internal ? 'postponed' : 'taken')
  const [actualDate, setActualDate] = useState(today)
  const [result, setResult] = useState('')
  const [notes, setNotes] = useState('')
  const [newDate, setNewDate] = useState('')
  const [counts, setCounts] = useState<'' | 'use_mock' | 'keep_paper'>('')
  const first = useRef<HTMLInputElement>(null)
  const undecided = view.choiceUnresolved
  const paperUnstarted = view.paper.onCalendar && !view.paper.started

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const done = await send('outcome', 'POST', {
      action: 'outcome', outcome, actualDate: outcome === 'taken' ? actualDate : null, result: outcome === 'taken' ? result : null, notes,
      newDate: outcome === 'postponed' ? newDate || null : null,
      choice: outcome === 'taken' && undecided && counts ? counts : null, paperAction: counts === 'use_mock' && paperUnstarted ? 'replace' : null,
    })
    if (done) {
      onDone(outcome === 'taken'
        ? 'Recorded as your own report. It does not change your readiness or create evidence.'
        : `Recorded. ${done.replacement?.message ?? ''}`.trim())
      onClose()
    }
  }

  return (
    <Dialog open onClose={onClose} title="Record what happened" size="md" initialFocusRef={first}
      description="This is your own report. It is not scored, and it never changes your readiness or creates repair work.">
      <form onSubmit={submit} className="cal-checkpoint__form">
        <fieldset>
          <legend className="fine-print">What happened?</legend>
          {([['taken', 'I took it'], ['postponed', 'It was postponed'], ['not_taken', 'I didn’t take it']] as const).filter(([v]) => !(internal && v === 'taken')).map(([v, l], i) => (
            <label key={v} className="ob-check"><input ref={i === 0 ? first : undefined} type="radio" name="outcome" checked={outcome === v} onChange={() => setOutcome(v)} /> {l}</label>
          ))}
        </fieldset>
        {outcome === 'taken' && (<>
          <label htmlFor="cp-actual">The day you took it</label>
          <input id="cp-actual" type="date" className="ob-input" max={today} required value={actualDate} onChange={e => setActualDate(e.target.value)} />
          <label htmlFor="cp-result">A result you were given (optional)</label>
          <input id="cp-result" className="ob-input" maxLength={80} placeholder="e.g. 62%" value={result} onChange={e => setResult(e.target.value)} />
          {undecided && (
            <fieldset>
              <legend className="fine-print">How should it count this week? (optional)</legend>
              <label className="ob-check"><input type="radio" name="counts" checked={counts === 'use_mock'} onChange={() => setCounts('use_mock')} /> As this week’s assessment{paperUnstarted ? ' (this also cancels the unstarted weekly paper)' : ''}</label>
              <label className="ob-check"><input type="radio" name="counts" checked={counts === 'keep_paper'} onChange={() => setCounts('keep_paper')} /> I will still take the weekly paper</label>
              <label className="ob-check"><input type="radio" name="counts" checked={counts === ''} onChange={() => setCounts('')} /> Decide later (the week keeps its paper requirement)</label>
            </fieldset>
          )}
        </>)}
        {outcome === 'postponed' && (<>
          <label htmlFor="cp-newdate">New date, if you know it (optional)</label>
          <input id="cp-newdate" type="date" className="ob-input" value={newDate} onChange={e => setNewDate(e.target.value)} />
        </>)}
        <label htmlFor="cp-notes">Anything to remember (optional)</label>
        <input id="cp-notes" className="ob-input" maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} />
        <p className="fine-print">A typed result is kept as your own words. It is never turned into a score, readiness change or repair work. Postponed or not taken does not close your week.</p>
        {serverError && <Notice tone="danger" role="alert">{serverError}</Notice>}
        <div className="ui-dialog__foot">
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Dialog>
  )
}

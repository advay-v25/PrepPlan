'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, Check, CheckCircle2, GraduationCap, Loader2, PenLine, Search } from 'lucide-react'
import { addDays } from '../../lib/planning/studyWeek'
import { learningLogSchema } from '../../lib/learning/log'
import { plannedLogSchema } from '../../lib/learning/plannedLog'

type Outcome = { id: string; code: string; title: string }
type Reading = { id: string; no: number; title: string; topicId: string; outcomes?: Outcome[] }
type Block = { id: string; title: string; date: string | null; minutes: number | null; execution: string }
type Kind = 'independent_study' | 'external_practice' | 'class'
type Pending = { mode: 'planned'; body: ReturnType<typeof plannedLogSchema.parse>; label: string } | { mode: 'separate'; body: ReturnType<typeof learningLogSchema.parse>; label: string }
type Receipt = {
  action: 'planned' | 'separate'; minutes: number | null; label: string; execution?: string; outcomes: number
  scope: 'confirmed' | 'time_only'; date: string; inCycle: boolean; taskId: string; readingHref?: string
}

const KINDS: { value: Kind; label: string; hint: string; Icon: typeof BookOpen }[] = [
  { value: 'independent_study', label: 'Studied', hint: 'Read, watched or worked through it', Icon: BookOpen },
  { value: 'external_practice', label: 'Practised', hint: 'Questions outside PrepPlan', Icon: PenLine },
  { value: 'class', label: 'Had a class', hint: 'It was taught to you', Icon: GraduationCap },
]
const MINUTES = [15, 30, 45, 60, 90, 120]
const LOAD_MS = 15_000
/** A save that outlives this is treated as an unknown outcome: the retry replays the same request and key, never a new one. */
const SAVE_MS = 30_000
const newKey = () => crypto.randomUUID()
const dayLabel = (d: string | null) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'Unscheduled'
const minuteLabel = (m: number) => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`

/** Loads are bounded: a stalled read ends in the visible error and Retry instead of an endless spinner. */
async function getJson(url: string, signal?: AbortSignal) {
  const bound = new AbortController()
  const timer = setTimeout(() => bound.abort(), LOAD_MS)
  signal?.addEventListener('abort', () => bound.abort())
  try {
    const r = await fetch(url, { signal: bound.signal })
    const body = await r.json().catch(() => null)
    if (!r.ok || !body?.ok) throw new Error(body?.error ?? 'failed')
    return body
  } finally { clearTimeout(timer) }
}

/**
 * Logging study that already happened, against exactly one target the student chooses:
 * an open block of this week (minutes, status and coverage commit together) or "a separate session".
 * Nothing is matched by name, date or reading. Deep links load only their own context.
 * A retry keeps its request and key, across refresh.
 */
export function LogLearningSheet({ classLed = false, initialReadingId, initialTaskId, onDone }: {
  classLed?: boolean
  initialReadingId?: string
  initialTaskId?: string
  onDone?: () => void
}) {
  const router = useRouter()
  const [owner, setOwner] = useState('')
  const [today, setToday] = useState('')
  const [blocks, setBlocks] = useState<Block[]>([])
  const [recent, setRecent] = useState<Reading[]>([])
  const [showChoices, setShowChoices] = useState(!initialTaskId && !initialReadingId)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  // Target: null = not chosen yet, a block id, or 'separate'.
  const [target, setTarget] = useState<string | 'separate' | null>(initialTaskId ?? (initialReadingId ? 'separate' : null))
  const [task, setTask] = useState<{ block: Block & { revision: number }; reading: Reading | null; confirmed: string[]; blocked: string | null } | null>(null)
  const [taskError, setTaskError] = useState('')
  const [kind, setKind] = useState<Kind>('independent_study')
  const [reading, setReading] = useState<Reading | null>(null)
  const [readingError, setReadingError] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Reading[] | null>(null)
  const [searchError, setSearchError] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [execution, setExecution] = useState<'completed' | 'partial'>('completed')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [minutes, setMinutes] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [stale, setStale] = useState(false)
  const key = useRef(newKey())
  const pending = useRef<Pending | null>(null)
  const storageKey = useRef('')
  const heading = useRef<HTMLHeadingElement>(null)
  const loadedTask = useRef<{ id: string; attempt: number } | null>(null)

  const scopedTask = showChoices ? undefined : initialTaskId
  const scopedReading = showChoices || scopedTask ? undefined : initialReadingId
  useEffect(() => {
    const abort = new AbortController()
    setLoadError(false)
    const scope = scopedTask ? `?task=${encodeURIComponent(scopedTask)}` : scopedReading ? `?reading=${encodeURIComponent(scopedReading)}` : ''
    getJson(`/api/log-learning${scope}`, abort.signal).then(body => {
      if (abort.signal.aborted) return
      setOwner(body.ownerId); setToday(body.today); setDate(prev => prev || body.today)
      setBlocks(body.blocks ?? []); setRecent(body.recent ?? [])
      if (scopedTask) {
        setTask({ block: body.task, reading: body.reading, confirmed: body.confirmed, blocked: body.blocked })
        setPicked(new Set(body.confirmed))
        loadedTask.current = { id: scopedTask, attempt: loadAttempt }
      }
      if (scopedReading) setReading(body.reading)
      storageKey.current = `roadmap.learning-log.pending.v2.${body.ownerId}`
      try {
        const saved = sessionStorage.getItem(storageKey.current)
        const parsed = saved ? JSON.parse(saved) : null
        const ok = parsed?.mode === 'planned' ? plannedLogSchema.safeParse(parsed.body) : parsed?.mode === 'separate' ? learningLogSchema.safeParse(parsed.body) : null
        if (ok?.success) { pending.current = parsed; setUncertain(true) }
      } catch { /* In-memory retry remains available when storage is disabled. */ }
      setReady(true)
    }).catch(() => { if (!abort.signal.aborted) setLoadError(true) })
    return () => abort.abort()
  }, [loadAttempt, scopedTask, scopedReading])

  // A chosen block loads only its own outstanding work.
  useEffect(() => {
    if (scopedTask) return
    if (!target || target === 'separate') { loadedTask.current = null; setTask(null); return }
    if (loadedTask.current?.id === target && loadedTask.current.attempt === loadAttempt) return
    const abort = new AbortController()
    setTask(null); setTaskError('')
    getJson(`/api/log-learning?task=${encodeURIComponent(target)}`, abort.signal).then(body => {
      if (abort.signal.aborted) return
      setTask({ block: { ...body.task, date: body.task.date, revision: body.task.revision }, reading: body.reading, confirmed: body.confirmed, blocked: body.blocked })
      setPicked(new Set(body.confirmed))
      setMinutes(null); setExecution('completed')
      loadedTask.current = { id: target, attempt: loadAttempt }
    }).catch(() => { if (!abort.signal.aborted) setTaskError('This block could not be loaded.') })
    return () => abort.abort()
  }, [target, loadAttempt, scopedTask])

  // A chosen reading loads only its own outcomes.
  const chooseReading = useCallback(async (r: Reading) => {
    setReadingError(''); setPicked(new Set()); setReading({ ...r, outcomes: undefined })
    try { const body = await getJson(`/api/log-learning?reading=${encodeURIComponent(r.id)}`); setReading(body.reading) }
    catch { setReadingError('The outcomes for this reading could not be loaded.') }
  }, [])

  useEffect(() => {
    const term = query.trim()
    setResults(null)
    setSearchError(false)
    if (term.length < 2 && !/^\d+$/.test(term)) return
    const abort = new AbortController()
    const t = setTimeout(() => getJson(`/api/log-learning?q=${encodeURIComponent(term)}`, abort.signal)
      .then(b => { if (!abort.signal.aborted) setResults(b.readings) })
      .catch(() => { if (!abort.signal.aborted) setSearchError(true) }), 250)
    return () => { clearTimeout(t); abort.abort() }
  }, [query, searchAttempt])

  function toggle(id: string) { setPicked(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next }) }
  function clearPending() {
    pending.current = null; setUncertain(false)
    try { if (storageKey.current) sessionStorage.removeItem(storageKey.current) } catch { /* Storage is optional. */ }
  }
  function choose(next: string | 'separate') {
    if (next === target) return
    setTarget(next); setError(''); setPicked(new Set()); setMinutes(null); key.current = newKey()
    if (next === 'separate') setReading(null)
  }

  async function save() {
    if (saving) return
    if (!pending.current) {
      if (target === 'separate' && reading) {
        const body = { activity_type: kind, reading_id: reading.id, outcome_ids: [...picked], duration_minutes: minutes, date, note: note.trim() || undefined, idempotency_key: key.current }
        pending.current = { mode: 'separate', body, label: reading.title }
      } else if (task && !task.blocked) {
        const body = { task_id: task.block.id, expected_revision: task.block.revision, execution, duration_minutes: minutes, outcome_ids: [...picked], note: note.trim() || undefined, idempotency_key: key.current }
        pending.current = { mode: 'planned', body, label: task.block.title }
      } else return
    }
    const request = pending.current
    try { sessionStorage.setItem(storageKey.current, JSON.stringify(request)) } catch { /* Optional recovery aid. */ }
    setSaving(true); setError('')
    try {
      const res = await fetch(request.mode === 'planned' ? '/api/log-learning/planned' : '/api/log-learning', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(SAVE_MS),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Could not confirm the save.')
        setRemoved(body.code === 'LOG_REMOVED')
        setStale(['REVISION_MISMATCH', 'CONTINUED', 'HISTORY_CLOSED', 'RECORDED_LEARNING'].includes(body.code))
        // A refusal means nothing was saved: drop the pending request so the form can be corrected and retried with a fresh key.
        if (res.status >= 400 && res.status < 500) { clearPending(); key.current = newKey() } else setUncertain(true)
        setSaving(false); return
      }
      setReceipt(request.mode === 'planned'
        ? { action: 'planned', minutes: body.minutes, label: request.label, execution: body.execution, outcomes: body.scope.confirmed, scope: body.scope.state, date: body.date, inCycle: true, taskId: body.taskId }
        : { action: 'separate', minutes: body.minutes, label: request.label, outcomes: body.outcomes, scope: 'confirmed', date: body.date, inCycle: body.inCycle, taskId: body.taskId,
            readingHref: reading ? `/app/curriculum/${reading.topicId}/${reading.id}` : undefined })
      clearPending(); setSaving(false); router.refresh()
    } catch {
      setError('The response was lost. Your log may already be saved. Retry the same log to check without duplicating it.'); setUncertain(true); setSaving(false)
    }
  }

  function again() {
    clearPending(); key.current = newKey()
    setReceipt(null); setNote(''); setQuery(''); setResults(null); setPicked(new Set()); setMinutes(null); setDate(today); setRemoved(false)
    setTarget(null); setReading(null); setTask(null); setShowChoices(true); setLoadAttempt(n => n + 1)
  }

  useEffect(() => { if (receipt || uncertain) heading.current?.focus() }, [receipt, uncertain])

  if (uncertain && !receipt) {
    const p = pending.current
    return <div className="log-sheet" role="status">
      <h2 ref={heading} tabIndex={-1}>{removed ? 'This log was removed' : 'Check a pending save'}</h2>
      <p>{error || 'A previous log has an unconfirmed response. Retry its original request to check safely.'}</p>
      {p && <p>{p.label} · {p.body.outcome_ids.length} outcome{p.body.outcome_ids.length === 1 ? '' : 's'} · {p.body.duration_minutes == null ? 'time unknown' : `${p.body.duration_minutes} minutes`}</p>}
      <div className="log-sheet__actions">
        {removed ? <button type="button" className="primary-button" onClick={again}>Start a new log</button> : <button type="button" className="primary-button" disabled={saving} onClick={save}>{saving ? 'Checking…' : 'Retry same log'}</button>}
        <Link href="/app/calendar" className="secondary-button" onClick={onDone}>Check Calendar</Link>
      </div>
    </div>
  }

  if (receipt) {
    const calendarHref = receipt.inCycle ? `/app/calendar?task=${encodeURIComponent(receipt.taskId)}` : '/app/calendar'
    return (
      <div className="log-sheet log-sheet--done" role="status">
        <CheckCircle2 size={36} className="log-sheet__done-icon" aria-hidden />
        <h2 ref={heading} tabIndex={-1}>{receipt.action === 'planned' ? (receipt.execution === 'partial' ? 'Progress saved.' : 'Block finished.') : 'Session logged.'}</h2>
        <ul className="log-sheet__receipt">
          <li><Check size={14} aria-hidden /> {receipt.action === 'planned' ? `Updated “${receipt.label}” on your Calendar.` : 'Added as a separate session. No planned block changed.'}</li>
          <li><Check size={14} aria-hidden /> {receipt.minutes == null ? 'Time not reported' : `${receipt.minutes} minutes reported once`}</li>
          <li><Check size={14} aria-hidden /> {receipt.scope === 'confirmed'
            ? `${receipt.outcomes} outcome${receipt.outcomes === 1 ? '' : 's'} marked as covered`
            : 'Time only. No outcomes are confirmed yet, so this adds nothing to your test scope.'}</li>
          {receipt.action === 'separate' && <li><Check size={14} aria-hidden /> {receipt.inCycle ? `Saved to Calendar for ${receipt.date === today ? 'today' : dayLabel(receipt.date)}.` : 'Saved to your history. It is outside your open week, so it is not on this week’s Calendar.'}</li>}
        </ul>
        <p className="log-sheet__fine">Covered is not the same as understood — a test is what shows that. Papers already started keep their original scope.{receipt.action === 'planned' && receipt.execution === 'partial' ? ' Unfinished work is offered again at weekly review.' : ''}</p>
        <div className="log-sheet__actions">
          {receipt.scope === 'time_only' && <Link href={calendarHref} className="primary-button" onClick={onDone}>Confirm coverage</Link>}
          {receipt.readingHref && <Link href={receipt.readingHref} className="secondary-button" onClick={onDone}>See the reading</Link>}
          <Link href={`/app/coach?task=${encodeURIComponent(receipt.taskId)}`} className="text-button" onClick={onDone}>Review this log with Coach</Link>
          <Link href={calendarHref} className="secondary-button" onClick={onDone}>{receipt.inCycle ? 'See it on Calendar' : 'Open Calendar'}</Link>
          <button type="button" className={receipt.scope === 'time_only' ? 'secondary-button' : 'primary-button'} onClick={onDone ?? again}>{onDone ? 'Done' : 'Log another'}</button>
        </div>
      </div>
    )
  }

  const outcomes = target === 'separate' ? reading?.outcomes : task?.reading?.outcomes
  const minutesBad = minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 720)
  const canSave = !saving && !minutesBad && picked.size <= 40 && (target === 'separate'
    ? !!reading && !!outcomes && picked.size > 0 && !!date
    : !!task && !task.blocked)
  const plannedMinutes = task?.block.minutes ?? null

  return (
    <div className="log-sheet">
      {loadError ? <div role="alert" className="auth-error">Logging could not be loaded. <button type="button" className="text-button" onClick={() => setLoadAttempt(n => n + 1)}>Retry</button>
        {!showChoices && <button type="button" className="text-button" onClick={() => { setTarget(null); setShowChoices(true) }}>Choose what to log</button>}</div>
        : !ready ? <p className="log-sheet__fine" role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading…</p>
        : <fieldset disabled={saving} className="log-sheet__fields">
          <fieldset className="log-sheet__step">
            <legend>What are you logging?</legend>
            <div className="log-sheet__targets" role="radiogroup" aria-label="What are you logging?">
              {(scopedTask && task ? [task.block] : blocks).map(b => (
                <button key={b.id} type="button" role="radio" aria-checked={target === b.id} className={`log-kind ${target === b.id ? 'is-on' : ''}`} onClick={() => choose(b.id)}>
                  <strong>{b.title}</strong>
                  <span>{dayLabel(b.date)}{b.minutes ? ` · ${minuteLabel(b.minutes)} planned` : ''}{b.execution === 'partial' ? ' · partly done' : ''}</span>
                </button>
              ))}
              {(showChoices || scopedReading) && <button type="button" role="radio" aria-checked={target === 'separate'} className={`log-kind ${target === 'separate' ? 'is-on' : ''}`} onClick={() => choose('separate')}>
                <strong>Log a separate session</strong>
                <span>Study that was not one of your planned blocks</span>
              </button>}
            </div>
            {!showChoices && <button type="button" className="text-button" onClick={() => setShowChoices(true)}>See other logging options</button>}
            {showChoices && blocks.length === 0 && <p className="log-sheet__fine">No open study blocks this week.</p>}
          </fieldset>

          {target && target !== 'separate' && (taskError
            ? <div role="alert" className="auth-error">{taskError} <button type="button" className="text-button" onClick={() => setLoadAttempt(n => n + 1)}>Retry</button></div>
            : !task ? <p className="log-sheet__fine" role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading this block…</p>
            : task.blocked ? <p className="auth-error" role="alert">{task.blocked}</p>
            : <>
              <fieldset className="log-sheet__step">
                <legend>How did it go?</legend>
                <div className="log-sheet__chips" role="radiogroup" aria-label="Status">
                  {([['completed', 'Finished it'], ['partial', 'Partly done']] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={execution === v} className={`log-chip ${execution === v ? 'is-on' : ''}`} onClick={() => setExecution(v)}>{label}</button>
                  ))}
                </div>
              </fieldset>
              {task.reading && <Coverage reading={task.reading} outcomes={task.reading.outcomes ?? []} picked={picked} toggle={toggle} setPicked={setPicked}
                hint="Leave all unticked to log time only. You can confirm coverage afterwards from Calendar." />}
            </>)}

          {target === 'separate' && <>
            <fieldset className="log-sheet__step">
              <legend>What did you do?</legend>
              <div className="log-sheet__kinds" role="radiogroup">
                {KINDS.map(({ value, label, hint, Icon }) => (
                  <button key={value} type="button" role="radio" aria-checked={kind === value} className={`log-kind ${kind === value ? 'is-on' : ''}`} onClick={() => setKind(value)}>
                    <Icon size={18} aria-hidden /><strong>{label}</strong><span>{hint}</span>
                  </button>
                ))}
              </div>
              {kind === 'class' && classLed && <p className="log-sheet__fine">For a regular class, <Link href="/app/calendar/log-class">log the class session</Link> instead — that also plans the follow-up work.</p>}
            </fieldset>
            <fieldset className="log-sheet__step">
              <legend>Which reading?</legend>
              {reading ? <p className="log-sheet__fine"><strong>{reading.no ? `Reading ${reading.no}: ` : ''}{reading.title}</strong> <button type="button" className="text-button" onClick={() => { setReading(null); setPicked(new Set()) }}>Change</button></p> : <>
                {recent.length > 0 && !query && <div className="log-sheet__chips" aria-label="Recent readings">
                  {recent.map(r => <button key={r.id} type="button" className="log-chip" onClick={() => chooseReading(r)}>{r.no}. {r.title.length > 36 ? `${r.title.slice(0, 35)}…` : r.title}</button>)}
                </div>}
                <label className="log-sheet__search"><Search size={15} aria-hidden />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search readings by title or number" aria-label="Search readings" />
                </label>
                {searchError && <p role="alert" className="auth-error">Could not search readings. <button type="button" className="text-button" onClick={() => setSearchAttempt(n => n + 1)}>Retry search</button></p>}
                {results && <div className="log-sheet__readings" role="listbox" aria-label="Readings">
                  {results.map(r => <button key={r.id} type="button" role="option" aria-selected={false} className="log-reading" onClick={() => { chooseReading(r); setQuery('') }}>
                    <span className="log-reading__no">{r.no}</span><span className="log-reading__title">{r.title}</span></button>)}
                  {results.length === 0 && <p className="log-sheet__fine">No reading matches that.</p>}
                </div>}
              </>}
              {readingError && <p role="alert" className="auth-error">{readingError} <button type="button" className="text-button" onClick={() => reading && chooseReading(reading)}>Retry</button></p>}
            </fieldset>
            {reading?.outcomes && <Coverage reading={reading} outcomes={reading.outcomes} picked={picked} toggle={toggle} setPicked={setPicked} />}
          </>}

          {target && (target === 'separate' || (task && !task.blocked)) && <>
            <div className="log-sheet__step log-sheet__step--row">
              <div role="group" aria-labelledby="log-minutes-label">
                <p id="log-minutes-label" className="log-sheet__label">How long?</p>
                <div className="log-sheet__chips">
                  <button type="button" className={`log-chip ${minutes === null ? 'is-on' : ''}`} aria-pressed={minutes === null} onClick={() => setMinutes(null)}>Not sure</button>
                  {[...new Set([...(target !== 'separate' && plannedMinutes ? [plannedMinutes] : []), ...MINUTES])].sort((a, b) => a - b).map(m => (
                    <button key={m} type="button" className={`log-chip ${minutes === m ? 'is-on' : ''}`} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{minuteLabel(m)}</button>
                  ))}
                </div>
                <details><summary>Enter different minutes</summary><label>Minutes studied <input type="number" min={1} max={720} value={minutes ?? ''} onChange={e => setMinutes(e.target.value === '' ? null : Number(e.target.value))} /></label></details>
                {minutesBad && <p role="alert" className="auth-error">Use whole minutes from 1 to 720.</p>}
              </div>
              {target === 'separate' && <div role="group" aria-labelledby="log-when-label">
                <p id="log-when-label" className="log-sheet__label">When?</p>
                <div className="log-sheet__chips">
                  {today && ['Today', 'Yesterday'].map((label, i) => (
                    <button key={label} type="button" className={`log-chip ${date === addDays(today, -i) ? 'is-on' : ''}`} aria-pressed={date === addDays(today, -i)} onClick={() => setDate(addDays(today, -i))}>{label}</button>
                  ))}
                </div>
                {today && <details><summary>Choose an earlier day</summary><label>Study date <input type="date" min={addDays(today, -14)} max={today} value={date} onChange={e => setDate(e.target.value)} /></label></details>}
              </div>}
            </div>
            <details className="log-sheet__note">
              <summary>Add a note (optional)</summary>
              <textarea rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} aria-label="Session note (optional)" placeholder="Anything worth remembering about this session" />
            </details>
          </>}
        </fieldset>}

      {error && <p className="auth-error" role="alert">{error}{stale && <> <button type="button" className="text-button" onClick={() => { setError(''); setStale(false); setLoadAttempt(n => n + 1) }}>Reload this block</button></>}</p>}

      <div className="log-sheet__footer">
        <p>{!target ? 'Choose a planned block or a separate session.'
          : target === 'separate' ? (reading ? <>Separate session · <strong>{picked.size}</strong> outcome{picked.size === 1 ? '' : 's'} · {minutes == null ? 'time unknown' : `${minutes} min`} · {date === today ? 'today' : dayLabel(date)}</> : 'Choose the reading you worked on.')
          : task && !task.blocked ? <>{task.block.title} · {execution === 'partial' ? 'partly done' : 'finished'} · {picked.size ? `${picked.size} outcome${picked.size === 1 ? '' : 's'}` : 'time only'} · {minutes == null ? 'time unknown' : `${minutes} min`}</> : ''}</p>
        <button type="button" className="primary-button" disabled={!canSave} onClick={save}>
          {saving ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Saving…</> : 'Save'}
        </button>
      </div>
    </div>
  )
}

function Coverage({ reading, outcomes, picked, toggle, setPicked, hint }: {
  reading: Reading; outcomes: Outcome[]; picked: Set<string>; toggle: (id: string) => void; setPicked: (s: Set<string>) => void; hint?: string
}) {
  return (
    <fieldset className="log-sheet__step">
      <legend>
        What did it cover?
        {outcomes.length > 1 && <button type="button" className="text-button" onClick={() => setPicked(picked.size === outcomes.length ? new Set() : new Set(outcomes.map(o => o.id)))}>
          {picked.size === outcomes.length ? 'Clear all' : `Select all ${outcomes.length}`}
        </button>}
      </legend>
      <p className="log-sheet__fine">{reading.title}</p>
      <ul className="log-sheet__outcomes">
        {outcomes.map(o => (
          <li key={o.id}>
            <label className={`log-outcome ${picked.has(o.id) ? 'is-on' : ''}`}>
              <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />
              {o.code && <span className="log-outcome__code">{o.code}</span>}
              <span>{o.title}</span>
            </label>
          </li>
        ))}
      </ul>
      {outcomes.length === 0 && <p className="log-sheet__fine">Outcome mapping for this reading is not available yet.</p>}
      {hint && <p className="log-sheet__fine">{hint}</p>}
    </fieldset>
  )
}

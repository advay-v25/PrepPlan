'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, Check, CheckCircle2, GraduationCap, Loader2, PenLine, Search } from 'lucide-react'
import { addDays } from '../../lib/planning/studyWeek'
import { learningLogSchema, type LearningLogInput } from '../../lib/learning/log'

type Outcome = { id: string; code: string; title: string }
type Reading = { id: string; no: number; title: string; outcomes: Outcome[] }
type Topic = { id: string; name: string; readings: Reading[] }
type Kind = 'independent_study' | 'external_practice' | 'class'

const KINDS: { value: Kind; label: string; hint: string; Icon: typeof BookOpen }[] = [
  { value: 'independent_study', label: 'Studied', hint: 'Read, watched or worked through it', Icon: BookOpen },
  { value: 'external_practice', label: 'Practised', hint: 'Questions outside Roadmap', Icon: PenLine },
  { value: 'class', label: 'Had a class', hint: 'It was taught to you', Icon: GraduationCap },
]
const MINUTES = [15, 30, 45, 60, 90, 120]

function newKey() {
  return crypto.randomUUID()
}

type Result = { outcomes: number; inCycle: boolean; reading: Reading; topicId: string; date: string; minutes: number | null; taskId: string }

/**
 * Logging learning that already happened, in one short form. What it writes
 * One sitting, one optional time report, exact selected outcome links.
 * A retry retains its request and key, including across refresh/navigation.
 */
export function LogLearningSheet({ classLed = false, initialReadingId, onDone }: {
  classLed?: boolean
  initialReadingId?: string
  onDone?: () => void
}) {
  const router = useRouter()
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [kind, setKind] = useState<Kind>('independent_study')
  const [topicId, setTopicId] = useState<string>('')
  const [readingId, setReadingId] = useState<string>(initialReadingId ?? '')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [minutes, setMinutes] = useState<number | null>(null)
  const [today, setToday] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const key = useRef(newKey())
  const pending = useRef<LearningLogInput | null>(null)
  const storageKey = useRef('')
  const recentReadingKey = useRef('')
  const [uncertain, setUncertain] = useState(false)
  const [removed, setRemoved] = useState(false)

  useEffect(() => {
    let live = true
    setLoadError(false)
    fetch('/api/log-learning').then(r => r.ok ? r.json() : Promise.reject())
      .then(body => {
        if (!live) return
        const list: Topic[] = body.topics ?? []
        setTopics(list)
        setToday(body.today); setDate(body.today)
        storageKey.current = `roadmap.learning-log.pending.v1.${body.ownerId}`
        recentReadingKey.current = `roadmap.learning-log.reading.v1.${body.ownerId}`
        let lastReading: string | null = null
        try {
          const saved = sessionStorage.getItem(storageKey.current)
          const parsed = saved ? learningLogSchema.safeParse(JSON.parse(saved)) : null
          if (parsed?.success) { pending.current = parsed.data; setUncertain(true) }
          lastReading = localStorage.getItem(recentReadingKey.current)
        } catch { /* In-memory retry remains available when storage is disabled. */ }
        const chosen = initialReadingId ?? lastReading
        const owner = list.find(t => t.readings.some(r => r.id === chosen))
        setTopicId(owner?.id ?? list[0]?.id ?? '')
        setReadingId(owner ? chosen ?? '' : '')
      })
      .catch(() => { if (live) setLoadError(true) })
    return () => { live = false }
  }, [initialReadingId, loadAttempt])

  const topic = topics?.find(t => t.id === topicId) ?? null
  const reading = topic?.readings.find(r => r.id === readingId) ?? topics?.flatMap(t => t.readings).find(r => r.id === readingId) ?? null
  const readings = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (topic?.readings ?? []).filter(r => !q || r.title.toLowerCase().includes(q) || String(r.no) === q)
  }, [topic, query])

  // Coverage is an explicit choice, never preselected from a reading title.
  useEffect(() => { setPicked(new Set()) }, [reading?.id])

  function toggle(id: string) {
    setPicked(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  async function save() {
    if (saving || (!pending.current && (!reading || picked.size === 0))) return
    const request = pending.current ?? {
      activity_type:kind, reading_id:reading!.id,outcome_ids:[...picked],duration_minutes:minutes,
      date,note:note.trim() || undefined,idempotency_key:key.current,
    }
    pending.current = request
    try { sessionStorage.setItem(storageKey.current, JSON.stringify(request)) } catch { /* Optional recovery aid. */ }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/log-learning', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Could not confirm the save.')
        setRemoved(body.code === 'LOG_REMOVED')
        if (res.status === 400 || res.status === 403) clearPending()
        else setUncertain(true)
        setSaving(false); return
      }
      const owner = topics?.find(t => t.readings.some(r => r.id === request.reading_id))
      const savedReading = owner?.readings.find(r => r.id === request.reading_id)
      if (!savedReading) throw new Error('Saved reading missing')
      setResult({ outcomes: body.outcomes, inCycle: body.inCycle, reading:savedReading, topicId:owner!.id, date:body.date, minutes:body.minutes,taskId:body.taskId })
      try { localStorage.setItem(recentReadingKey.current, savedReading.id) } catch { /* Optional preference. */ }
      clearPending()
      setSaving(false)
      router.refresh()
    } catch {
      setError('The response was lost. Your log may already be saved. Retry the same log to check without duplicating it.'); setUncertain(true); setSaving(false)
    }
  }

  function again() {
    clearPending()
    key.current = newKey()
    setResult(null); setNote(''); setQuery(''); setPicked(new Set());setMinutes(null);setDate(today);setRemoved(false)
  }

  function clearPending() {
    pending.current=null; setUncertain(false)
    try { if(storageKey.current)sessionStorage.removeItem(storageKey.current) } catch { /* Storage is optional. */ }
  }

  if (uncertain && !result) return <div className="log-sheet" role="status">
    <h2>{removed ? 'This log was removed' : 'Check a pending save'}</h2>
    <p>{error || 'A previous log has an unconfirmed response. Retry its original request to check safely.'}</p>
    <p>{pending.current?.outcome_ids.length ?? 0} selected outcomes · {pending.current?.duration_minutes == null ? 'time unknown' : `${pending.current.duration_minutes} minutes`} · {pending.current?.date}</p>
    <div className="log-sheet__actions">
      {removed ? <button type="button" className="primary-button" onClick={again}>Start a new log</button> : <button type="button" className="primary-button" disabled={saving} onClick={save}>{saving ? 'Checking…' : 'Retry same log'}</button>}
      <Link href="/app/calendar" className="secondary-button" onClick={onDone}>Check Calendar</Link>
    </div>
  </div>

  if (result) {
    return (
      <div className="log-sheet log-sheet--done" role="status">
        <CheckCircle2 size={36} className="log-sheet__done-icon" aria-hidden />
        <h2>Logged.</h2>
        <ul className="log-sheet__receipt">
          <li><Check size={14} aria-hidden /> {result.outcomes} outcome{result.outcomes === 1 ? '' : 's'} from Reading {result.reading.no} marked as covered</li>
          <li><Check size={14} aria-hidden /> One sitting · {result.minutes == null ? 'time not reported' : `${result.minutes} minutes reported once`}</li>
          <li><Check size={14} aria-hidden /> {result.inCycle
            ? `Saved to Calendar for ${result.date === today ? 'today' : result.date}.`
            : 'Saved to your curriculum. It will not show on Calendar because that date is outside your active week.'}</li>
        </ul>
        <p className="log-sheet__fine">Covered is not the same as understood — a test is what shows that. Papers already started keep their original scope.</p>
        <div className="log-sheet__actions">
          <Link href={`/app/curriculum/${result.topicId}/${result.reading.id}`} className="secondary-button" onClick={onDone}>See the reading</Link>
          <Link href={result.inCycle ? `/app/calendar?task=${encodeURIComponent(result.taskId)}` : '/app/calendar'} className="secondary-button" onClick={onDone}>{result.inCycle ? 'See this sitting' : 'Open Calendar'}</Link>
          <button type="button" className="primary-button" onClick={onDone ?? again}>{onDone ? 'Done' : 'Log another'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="log-sheet">
      <fieldset disabled={saving} className="log-sheet__fields">
      <fieldset className="log-sheet__step">
        <legend>What did you do?</legend>
        <div className="log-sheet__kinds" role="radiogroup">
          {KINDS.map(({ value, label, hint, Icon }) => (
            <button key={value} type="button" role="radio" aria-checked={kind === value}
              className={`log-kind ${kind === value ? 'is-on' : ''}`} onClick={() => setKind(value)}>
              <Icon size={18} aria-hidden />
              <strong>{label}</strong>
              <span>{hint}</span>
            </button>
          ))}
        </div>
        {kind === 'class' && classLed && (
          <p className="log-sheet__fine">For a regular class, <Link href="/app/calendar/log-class">log the class session</Link> instead — that also plans the follow-up work.</p>
        )}
      </fieldset>

      <fieldset className="log-sheet__step">
        <legend>Which reading?</legend>
        {loadError ? <div role="alert" className="auth-error">The curriculum could not be loaded. <button type="button" className="text-button" onClick={() => setLoadAttempt(n => n + 1)}>Retry</button></div>
          : !topics ? <p className="log-sheet__fine" role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading the curriculum…</p>
          : (
            <>
              <div className="log-sheet__subjects" role="tablist" aria-label="Subject">
                {topics.map(t => (
                  <button key={t.id} type="button" role="tab" aria-selected={t.id === topicId}
                    className={`log-chip ${t.id === topicId ? 'is-on' : ''}`} onClick={() => { setTopicId(t.id); setReadingId(''); setQuery('') }}>
                    {t.name}
                  </button>
                ))}
              </div>
              <label className="log-sheet__search">
                <Search size={15} aria-hidden />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search readings in this subject" aria-label="Search readings" />
              </label>
              <div className="log-sheet__readings" role="listbox" aria-label="Readings">
                {readings.map(r => (
                  <button key={r.id} type="button" role="option" aria-selected={r.id === readingId}
                    className={`log-reading ${r.id === readingId ? 'is-on' : ''}`} onClick={() => setReadingId(r.id)}>
                    <span className="log-reading__no">{r.no}</span>
                    <span className="log-reading__title">{r.title}</span>
                    {r.id === readingId && <Check size={16} aria-hidden />}
                  </button>
                ))}
                {readings.length === 0 && <p className="log-sheet__fine">No reading matches that.</p>}
              </div>
            </>
          )}
      </fieldset>

      {reading && (
        <fieldset className="log-sheet__step">
          <legend>
            What did it cover?
            <button type="button" className="text-button" onClick={() => setPicked(picked.size === reading.outcomes.length ? new Set() : new Set(reading.outcomes.map(o => o.id)))}>
              {picked.size === reading.outcomes.length ? 'Clear all' : `Select all ${reading.outcomes.length}`}
            </button>
          </legend>
          <ul className="log-sheet__outcomes">
            {reading.outcomes.map(o => (
              <li key={o.id}>
                <label className={`log-outcome ${picked.has(o.id) ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />
                  {o.code && <span className="log-outcome__code">{o.code}</span>}
                  <span>{o.title}</span>
                </label>
              </li>
            ))}
          </ul>
          {reading.outcomes.length === 0 && <p className="log-sheet__fine">Outcome mapping for this reading is not available yet.</p>}
        </fieldset>
      )}

      <div className="log-sheet__step log-sheet__step--row">
        <div role="group" aria-labelledby="log-minutes-label">
          <p id="log-minutes-label" className="log-sheet__label">How long?</p>
          <div className="log-sheet__chips">
            <button type="button" className={`log-chip ${minutes === null ? 'is-on' : ''}`} aria-pressed={minutes === null} onClick={() => setMinutes(null)}>Not sure</button>
            {MINUTES.map(m => (
              <button key={m} type="button" className={`log-chip ${minutes === m ? 'is-on' : ''}`} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                {m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' 30m' : ''}`}
              </button>
            ))}
          </div>
          <details><summary>Enter different minutes</summary><label>Minutes studied <input type="number" min={1} max={720} value={minutes ?? ''} onChange={e => setMinutes(e.target.value === '' ? null : Number(e.target.value))} /></label></details>
        </div>
        <div role="group" aria-labelledby="log-when-label">
          <p id="log-when-label" className="log-sheet__label">When?</p>
          <div className="log-sheet__chips">
            {today && ['Today', 'Yesterday'].map((label, i) => (
                <button key={label} type="button" className={`log-chip ${date === addDays(today,-i) ? 'is-on' : ''}`} aria-pressed={date === addDays(today,-i)} onClick={() => setDate(addDays(today,-i))}>{label}</button>
            ))}
          </div>
          {today && <details><summary>Choose an earlier day</summary><label>Study date <input type="date" min={addDays(today,-14)} max={today} value={date} onChange={e => setDate(e.target.value)} /></label></details>}
        </div>
      </div>

      <details className="log-sheet__note">
        <summary>Add a note (optional)</summary>
        <textarea rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} aria-label="Session note (optional)" placeholder="Anything worth remembering about this session" />
      </details>
      </fieldset>

      {error && <p className="auth-error" role="alert">{error}</p>}

      <div className="log-sheet__footer">
        <p>
          {reading
            ? <>One sitting · <strong>{picked.size}</strong> selected outcome{picked.size === 1 ? '' : 's'} · {minutes == null ? 'time unknown' : `${minutes} min`} · {date === today ? 'today' : date}</>
            : 'Choose the reading you worked on.'}
        </p>
        <button type="button" className="primary-button" disabled={!reading || picked.size === 0 || picked.size > 40 || !today || !date || saving || (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 720))} onClick={save}>
          {saving ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Saving…</> : 'Save'}
        </button>
      </div>
    </div>
  )
}

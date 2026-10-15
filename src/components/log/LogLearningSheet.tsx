'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, Check, CheckCircle2, GraduationCap, Loader2, PenLine, Search } from 'lucide-react'

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

function isoDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function newKey() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

type Result = { outcomes: number; inCycle: boolean; reading: Reading; topicId: string; date: string }

/**
 * Logging learning that already happened, in one short form. What it writes
 * (see /api/log-learning → log_learning_entry): the reading's coverage in
 * Curriculum, and one completed block per outcome on Calendar — so the work
 * counts toward Position and this week's paper can test it. It never marks
 * anything understood; only a test can.
 */
export function LogLearningSheet({ classLed = false, initialReadingId, onDone }: {
  classLed?: boolean
  initialReadingId?: string
  onDone?: () => void
}) {
  const router = useRouter()
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [kind, setKind] = useState<Kind>('independent_study')
  const [topicId, setTopicId] = useState<string>('')
  const [readingId, setReadingId] = useState<string>(initialReadingId ?? '')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [minutes, setMinutes] = useState(45)
  const [daysAgo, setDaysAgo] = useState(0)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const key = useRef(newKey())

  useEffect(() => {
    let live = true
    fetch('/api/log-learning').then(r => r.ok ? r.json() : Promise.reject())
      .then(body => {
        if (!live) return
        const list: Topic[] = body.topics ?? []
        setTopics(list)
        const owner = initialReadingId ? list.find(t => t.readings.some(r => r.id === initialReadingId)) : null
        setTopicId(owner?.id ?? list[0]?.id ?? '')
      })
      .catch(() => { if (live) setLoadError(true) })
    return () => { live = false }
  }, [initialReadingId])

  const topic = topics?.find(t => t.id === topicId) ?? null
  const reading = topic?.readings.find(r => r.id === readingId) ?? topics?.flatMap(t => t.readings).find(r => r.id === readingId) ?? null
  const readings = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (topic?.readings ?? []).filter(r => !q || r.title.toLowerCase().includes(q) || String(r.no) === q)
  }, [topic, query])

  // A new reading starts with every outcome selected — the common case is "I did the reading".
  useEffect(() => { setPicked(new Set(reading?.outcomes.map(o => o.id) ?? [])) }, [reading?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setPicked(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  async function save() {
    if (!reading || picked.size === 0) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/log-learning', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_type: kind, reading_id: reading.id, outcome_ids: [...picked],
          duration_minutes: minutes, date: isoDaysAgo(daysAgo), note: note.trim() || undefined,
          idempotency_key: key.current,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) { setError(body.error ?? 'Could not save that.'); setSaving(false); return }
      setResult({ outcomes: body.outcomes, inCycle: body.inCycle, reading, topicId: topicId || '', date: body.date })
      setSaving(false)
      router.refresh()
    } catch {
      setError('Network error — nothing was saved.'); setSaving(false)
    }
  }

  function again() {
    key.current = newKey()
    setResult(null); setNote(''); setQuery('')
  }

  if (result) {
    return (
      <div className="log-sheet log-sheet--done" role="status">
        <CheckCircle2 size={36} className="log-sheet__done-icon" aria-hidden />
        <h2>Logged.</h2>
        <ul className="log-sheet__receipt">
          <li><Check size={14} aria-hidden /> {result.outcomes} outcome{result.outcomes === 1 ? '' : 's'} from Reading {result.reading.no} marked as covered</li>
          <li><Check size={14} aria-hidden /> {result.inCycle
            ? `On your Calendar for ${result.date === isoDaysAgo(0) ? 'today' : result.date}, and in scope for this week’s paper`
            : 'Saved to your curriculum. It will not show on Calendar because that date is outside your active week.'}</li>
        </ul>
        <p className="log-sheet__fine">Covered is not the same as understood — a test is what shows that.</p>
        <div className="log-sheet__actions">
          <Link href={`/app/curriculum/${result.topicId}/${result.reading.id}`} className="secondary-button">See the reading</Link>
          <Link href="/app/calendar" className="secondary-button">Open Calendar</Link>
          <button type="button" className="primary-button" onClick={onDone ?? again}>{onDone ? 'Done' : 'Log another'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="log-sheet">
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
        {loadError ? <p className="auth-error">The curriculum could not be loaded. Refresh to try again.</p>
          : !topics ? <p className="log-sheet__fine"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading the curriculum…</p>
          : (
            <>
              <div className="log-sheet__subjects" role="tablist" aria-label="Subject">
                {topics.map(t => (
                  <button key={t.id} type="button" role="tab" aria-selected={t.id === topicId}
                    className={`log-chip ${t.id === topicId ? 'is-on' : ''}`} onClick={() => { setTopicId(t.id); setQuery('') }}>
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
        </fieldset>
      )}

      <div className="log-sheet__step log-sheet__step--row">
        <div role="group" aria-labelledby="log-minutes-label">
          <p id="log-minutes-label" className="log-sheet__label">How long?</p>
          <div className="log-sheet__chips">
            {MINUTES.map(m => (
              <button key={m} type="button" className={`log-chip ${minutes === m ? 'is-on' : ''}`} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                {m < 60 ? `${m}m` : `${m / 60}h${m % 60 ? ' 30m' : ''}`}
              </button>
            ))}
          </div>
        </div>
        <div role="group" aria-labelledby="log-when-label">
          <p id="log-when-label" className="log-sheet__label">When?</p>
          <div className="log-sheet__chips">
            {['Today', 'Yesterday'].map((label, i) => (
              <button key={label} type="button" className={`log-chip ${daysAgo === i ? 'is-on' : ''}`} aria-pressed={daysAgo === i} onClick={() => setDaysAgo(i)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <details className="log-sheet__note">
        <summary>Add a note (optional)</summary>
        <textarea rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything worth remembering about this session" />
      </details>

      {error && <p className="auth-error" role="alert">{error}</p>}

      <div className="log-sheet__footer">
        <p>
          {reading
            ? <>Logs <strong>{picked.size}</strong> outcome{picked.size === 1 ? '' : 's'} from Reading {reading.no} · {minutes} min · {daysAgo === 0 ? 'today' : 'yesterday'}</>
            : 'Choose the reading you worked on.'}
        </p>
        <button type="button" className="primary-button" disabled={!reading || picked.size === 0 || saving} onClick={save}>
          {saving ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Saving…</> : 'Save'}
        </button>
      </div>
    </div>
  )
}

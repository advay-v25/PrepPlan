'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChallengeDialog } from '../diagnostic/ChallengeDialog'

type Level = 'low' | 'medium' | 'high'
type Item = {
  id: string; seq: number; stem: string; options: string[]
  answer: { selected: number; confidence: Level | null } | null
  flagged: boolean; activeSeconds: number; interruptedSeconds: number
}
type Meta = { id: string; status: string; kind: string | null; timed: boolean; deadlineAt: string | null; paused: boolean; total: number; answered: number }

/** Plain, jargon-free labels for the three confidence levels. Nothing is preselected. */
const LEVELS: { v: Level; label: string; hint: string }[] = [
  { v: 'low', label: 'Guessing', hint: 'I am not sure at all' },
  { v: 'medium', label: 'Somewhat sure', hint: 'I lean this way' },
  { v: 'high', label: 'Sure', hint: 'I know this' },
]
const KIND_LABEL: Record<string, string> = { weekly: 'Weekly paper', reading: 'Reading diagnostic', subject: 'Subject diagnostic', repair: 'Repair re-check', mock: 'Mock session', module: 'Diagnostic' }
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`

export function AttemptRunner({ attemptId }: { attemptId: string }) {
  const router = useRouter()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [idx, setIdx] = useState(0)
  const [draft, setDraft] = useState<{ selected: number | null; confidence: Level | null }>({ selected: null, confidence: null })
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [paused, setPaused] = useState(false)
  const [challengeOpen, setChallengeOpen] = useState(false)
  const [allowUnanswered, setAllowUnanswered] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [clockSkew, setClockSkew] = useState(0)

  // Active vs interrupted seconds for the question on screen (seeded from what the server saved).
  const active = useRef(0); const interrupted = useRef(0); const lastFlush = useRef(0)
  const curId = useRef<string | null>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const conf = useRef<(HTMLButtonElement | null)[]>([])
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const item = items[idx]

  const load = useCallback(async () => {
    const res = await fetch(`/api/tests/attempt/${attemptId}`, { cache: 'no-store' })
    const data = await res.json()
    if (!data.ok) { setError(data.error ?? 'Could not load this attempt.'); return }
    if (data.attempt.status === 'scored') { router.replace(`/app/tests/${attemptId}/result`); return }
    setMeta(data.attempt); setItems(data.items); setPaused(data.attempt.paused)
    setClockSkew(new Date(data.serverNow).getTime() - Date.now())
    const first = data.items.findIndex((i: Item) => !i.answer)
    setIdx(first === -1 ? 0 : first)
    if (first === -1 && data.items.length > 0) setReviewing(true)
  }, [attemptId, router])
  useEffect(() => { load() }, [load])

  // Load the draft and saved time whenever the question changes.
  useEffect(() => {
    if (!item) return
    curId.current = item.id
    active.current = item.activeSeconds; interrupted.current = item.interruptedSeconds; lastFlush.current = active.current + interrupted.current
    setDraft({ selected: item.answer?.selected ?? null, confidence: item.answer?.confidence ?? null })
    setSaving(item.answer ? 'saved' : 'idle'); setError(null)
    headingRef.current?.focus()
    fetch(`/api/tests/attempt/${attemptId}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: item.id, activeSeconds: active.current, interruptedSeconds: interrupted.current, visit: true }) }).catch(() => {})
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback((keepalive = false) => {
    const id = curId.current
    if (!id || reviewing) return
    fetch(`/api/tests/attempt/${attemptId}/progress`, { method: 'POST', keepalive, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: id, activeSeconds: active.current, interruptedSeconds: interrupted.current }) }).catch(() => {})
    lastFlush.current = active.current + interrupted.current
  }, [attemptId, reviewing])

  // Second-by-second: only a visible, focused, online, unpaused question counts as active solving time.
  useEffect(() => {
    if (!meta || reviewing || meta.status === 'scored') return
    const t = setInterval(() => {
      const engaged = document.visibilityState === 'visible' && document.hasFocus() && navigator.onLine && !paused
      if (paused) return
      if (engaged) active.current += 1; else interrupted.current += 1
      if (active.current + interrupted.current - lastFlush.current >= 10) flush()
    }, 1000)
    const onHide = () => flush(true)
    document.addEventListener('visibilitychange', onHide); window.addEventListener('pagehide', onHide)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide) }
  }, [meta, reviewing, paused, flush])

  // Timed mock: a strict countdown to the server's deadline, then automatic submission.
  const submit = useCallback(async (auto = false) => {
    setSubmitting(true); setError(null)
    const res = await fetch(`/api/tests/attempt/${attemptId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowUnanswered: auto || allowUnanswered }) })
    const data = await res.json()
    if (data.ok) { router.replace(data.resultUrl ?? `/app/tests/${attemptId}/result`); return }
    setSubmitting(false); setError(data.error ?? 'Could not submit.')
  }, [attemptId, allowUnanswered, router])
  useEffect(() => {
    if (!meta?.timed || !meta.deadlineAt) return
    const tick = () => {
      const left = Math.round((new Date(meta.deadlineAt!).getTime() - (Date.now() + clockSkew)) / 1000)
      setRemaining(left)
      if (left <= 0) submit(true)
    }
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t)
  }, [meta?.timed, meta?.deadlineAt, clockSkew]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(selected: number, confidence: Level, flagged = item.flagged) {
    setSaving('saving'); setError(null)
    const res = await fetch(`/api/tests/attempt/${attemptId}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, selectedOptionIndex: selected, confidence, activeSeconds: active.current, interruptedSeconds: interrupted.current, flagged }) })
    const data = await res.json()
    if (!data.ok) { setSaving('error'); setError(data.error ?? 'Could not save that answer.'); if (data.code === 'time_up') submit(true); return }
    setItems(list => list.map(i => i.id === item.id ? { ...i, answer: { selected, confidence }, flagged } : i))
    setMeta(m => m ? { ...m, answered: items.filter(i => i.id === item.id ? true : i.answer).length } : m)
    setSaving('saved')
  }
  const choose = (selected: number | null, confidence: Level | null) => {
    setDraft({ selected, confidence })
    if (selected !== null && confidence !== null) save(selected, confidence)
  }
  async function toggleFlag() {
    const flagged = !item.flagged
    setItems(list => list.map(i => i.id === item.id ? { ...i, flagged } : i))
    await fetch(`/api/tests/attempt/${attemptId}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: item.id, activeSeconds: active.current, interruptedSeconds: interrupted.current, flagged }) })
  }
  async function pause(action: 'pause' | 'resume') {
    if (action === 'pause') flush()
    const res = await fetch(`/api/tests/attempt/${attemptId}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    const data = await res.json()
    if (data.ok) setPaused(data.paused); else setError(data.error ?? 'Could not pause.')
  }

  const complete = draft.selected !== null && draft.confidence !== null
  const savedHere = Boolean(item?.answer) && draft.selected === item?.answer?.selected && draft.confidence === item?.answer?.confidence
  const canLeave = !item || savedHere
  const go = (n: number) => { if (n === idx || !canLeave) return; flush(); setIdx(Math.min(Math.max(n, 0), items.length - 1)); setReviewing(false) }
  const answered = items.filter(i => i.answer).length
  const unanswered = items.filter(i => !i.answer)

  const kindLabel = useMemo(() => KIND_LABEL[meta?.kind ?? 'module'] ?? 'Assessment', [meta?.kind])

  if (error && !meta) return <div className="empty-state"><h2>This assessment could not be loaded</h2><p>{error}</p><a href="/app/tests" className="primary-button">Back to Tests</a></div>
  if (!meta || !item) return <div className="test-loading" role="status" aria-live="polite">Loading…</div>

  if (paused) {
    return (
      <div className="attempt-paused" role="dialog" aria-label="Paused">
        <h2>Paused</h2>
        <p>Your questions are hidden and this time is not counted. Nothing is lost.</p>
        <button type="button" className="primary-button" onClick={() => pause('resume')}>Resume</button>
      </div>
    )
  }

  if (reviewing) {
    return (
      <div className="attempt-review">
        <h2>Review before you submit</h2>
        <p>{answered} of {items.length} answered. You can change any answer or confidence until you submit.</p>
        <ol className="attempt-review__list">
          {items.map((i, n) => (
            <li key={i.id}>
              <button type="button" className="text-button" onClick={() => { setReviewing(false); setIdx(n) }}>Question {i.seq}</button>{' '}
              {i.answer ? <span>answered · {LEVELS.find(l => l.v === i.answer!.confidence)?.label}</span> : <strong>not answered</strong>}
              {i.flagged && <span> · flagged</span>}
            </li>
          ))}
        </ol>
        {unanswered.length > 0 && <label className="attempt-review__ack"><input type="checkbox" checked={allowUnanswered} onChange={e => setAllowUnanswered(e.target.checked)} /> Submit with {unanswered.length} unanswered (they will not be scored)</label>}
        {error && <p role="alert" className="review-error">{error}</p>}
        <div className="attempt-review__actions">
          <button type="button" className="secondary-button" onClick={() => { setReviewing(false); setIdx(Math.max(0, items.findIndex(i => !i.answer))) }}>Keep working</button>
          <button type="button" className="primary-button" disabled={submitting || (unanswered.length > 0 && !allowUnanswered)} onClick={() => submit(false)}>{submitting ? 'Scoring…' : 'Submit for scoring'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="attempt">
      <header className="attempt__head">
        <span><strong>{kindLabel}</strong> · Question {item.seq} of {items.length}</span>
        {meta.timed && remaining !== null && <span className="attempt__clock" role="timer" aria-label="Time remaining">{fmt(remaining)} left</span>}
        <span className="attempt__save" role="status" aria-live="polite">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Not saved' : ''}</span>
        {!meta.timed && <button type="button" className="text-button" onClick={() => pause('pause')}>Pause</button>}
      </header>

      <nav className="attempt__nav" aria-label="Questions">
        {items.map((i, n) => (
          <button key={i.id} type="button" className={`attempt__dot ${n === idx ? 'is-current' : ''} ${i.answer ? 'is-answered' : ''} ${i.flagged ? 'is-flagged' : ''}`}
            aria-label={`Question ${i.seq}${i.answer ? ', answered' : ', not answered'}${i.flagged ? ', flagged' : ''}`} aria-current={n === idx ? 'step' : undefined}
            onClick={() => go(n)}>{i.seq}</button>
        ))}
      </nav>

      <section className="question-card" aria-labelledby="q-h">
        <h2 id="q-h" ref={headingRef} tabIndex={-1}>{item.stem}</h2>
        <div className="answer-list" role="radiogroup" aria-label="Answer choices">
          {item.options.map((opt, n) => {
            const on = draft.selected === n
            return (
              <button key={n} type="button" role="radio" aria-checked={on} ref={el => { optionRefs.current[n] = el }}
                tabIndex={draft.selected === null ? (n === 0 ? 0 : -1) : on ? 0 : -1} className={`answer-row ${on ? 'is-selected' : ''}`}
                onClick={() => choose(n, draft.confidence)}
                onKeyDown={e => {
                  const k = e.key; let next: number | null = null
                  if (k === 'ArrowDown' || k === 'ArrowRight') next = (n + 1) % item.options.length; else if (k === 'ArrowUp' || k === 'ArrowLeft') next = (n - 1 + item.options.length) % item.options.length
                  else if (/^[a-c]$/i.test(k)) next = k.toLowerCase().charCodeAt(0) - 97
                  if (next !== null && next < item.options.length) { e.preventDefault(); choose(next, draft.confidence); optionRefs.current[next]?.focus() }
                }}>
                <span className="answer-letter" aria-hidden>{String.fromCharCode(65 + n)}</span><span>{opt}</span><span className="answer-radio" aria-hidden />
              </button>
            )
          })}
        </div>
      </section>

      <div className="attempt__confidence">
        <span id="conf-h"><strong>How sure are you?</strong> <span className="muted">Required — pick one to continue.</span></span>
        <div role="radiogroup" aria-labelledby="conf-h" className="attempt__levels">
          {LEVELS.map((l, n) => {
            const on = draft.confidence === l.v
            return (
              <button key={l.v} type="button" role="radio" aria-checked={on} ref={el => { conf.current[n] = el }} title={l.hint}
                tabIndex={draft.confidence === null ? (n === 0 ? 0 : -1) : on ? 0 : -1} className={`attempt__level ${on ? 'is-on' : ''}`}
                onClick={() => choose(draft.selected, l.v)}
                onKeyDown={e => {
                  let next: number | null = null
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (n + 1) % 3; else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (n + 2) % 3
                  if (next !== null) { e.preventDefault(); choose(draft.selected, LEVELS[next].v); conf.current[next]?.focus() }
                }}>{l.label}</button>
            )
          })}
        </div>
      </div>

      {error && <p role="alert" className="review-error">{error}</p>}

      <footer className="attempt__foot">
        <button type="button" className="text-button" onClick={toggleFlag} aria-pressed={item.flagged}>{item.flagged ? 'Flagged for review' : 'Flag for review'}</button>
        <button type="button" className="text-button" onClick={() => setChallengeOpen(true)}>Challenge this question</button>
        <span className="attempt__spacer" />
        <button type="button" className="secondary-button" disabled={idx === 0 || !canLeave} onClick={() => go(idx - 1)}>Previous</button>
        {idx < items.length - 1
          ? <button type="button" className="primary-button" disabled={!complete || !savedHere} onClick={() => go(idx + 1)}>{complete && !savedHere ? 'Saving…' : 'Next'}</button>
          : <button type="button" className="primary-button" disabled={!complete || !savedHere} onClick={() => { flush(); setReviewing(true) }}>Review and submit</button>}
      </footer>
      {!complete && <p className="muted attempt__why" aria-live="polite">{draft.selected === null && draft.confidence === null ? 'Choose an answer and how sure you are.' : draft.selected === null ? 'Choose an answer.' : 'Now choose how sure you are.'}</p>}

      {challengeOpen && <ChallengeDialog itemId={item.id} attemptId={attemptId} onClose={() => setChallengeOpen(false)} onRaised={() => setChallengeOpen(false)} />}
    </div>
  )
}

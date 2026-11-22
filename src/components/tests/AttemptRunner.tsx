'use client'

import { createProgressQueue, type ProgressPayload } from '../../lib/tests/progressQueue'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChallengeDialog } from '../diagnostic/ChallengeDialog'

type Level = 'low' | 'medium' | 'high'
type Item = {
  id: string; seq: number; stem: string; options: string[]
  answer: { selected: number; confidence: Level | null } | null
  flagged: boolean; activeSeconds: number; interruptedSeconds: number
}
type Meta = { id: string; status: string; kind: string | null; rehearsal?: { id: string; session: number; started: boolean } | null; timed: boolean; deadlineAt: string | null; paused: boolean; total: number; answered: number; adaptive?: { runId: string; block: number; cap: number } | null }
type AttemptLoad = { ok: true; attempt: Meta; items: Item[]; serverNow: string } | { ok: false; error?: string; requestId?: string }

/** Plain, jargon-free labels for the three confidence levels. Nothing is preselected. */
const LEVELS: { v: Level; label: string; hint: string }[] = [
  { v: 'low', label: 'Guessing', hint: 'I am not sure at all' },
  { v: 'medium', label: 'Somewhat sure', hint: 'I lean this way' },
  { v: 'high', label: 'Sure', hint: 'I know this' },
]
const KIND_LABEL: Record<string, string> = { weekly: 'Weekly paper', reading: 'Reading diagnostic', subject: 'Subject diagnostic', repair: 'Repair re-check', mock: 'Mock session', practice: 'Timed practice (not evidence)', module: 'Diagnostic' }
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`

export function AttemptRunner({ attemptId }: { attemptId: string }) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const [meta, setMeta] = useState<Meta | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [idx, setIdx] = useState(0)
  const [draft, setDraft] = useState<{ selected: number | null; confidence: Level | null }>({ selected: null, confidence: null })
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [loadReference, setLoadReference] = useState<string | null>(null)
  const loadRequest = useRef<AbortController | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [paused, setPaused] = useState(false)
  const [challengeOpen, setChallengeOpen] = useState(false)
  const [allowUnanswered, setAllowUnanswered] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submitPending = useRef(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [clockSkew, setClockSkew] = useState(0)
  const autoFired = useRef(false)

  // Active vs interrupted seconds for the question on screen (seeded from what the server saved).
  const active = useRef(0); const interrupted = useRef(0); const lastFlush = useRef(0)
  const curId = useRef<string | null>(null)
  // Optional timing telemetry: one request in flight, merged per question, stopped by a "closed" refusal. It never delays an answer save or a submit.
  const progress = useRef<ReturnType<typeof createProgressQueue> | null>(null)
  if (!progress.current) progress.current = createProgressQueue(async (p: ProgressPayload, keepalive: boolean) => {
    const res = await fetch(`/api/tests/attempt/${attemptId}/progress`, { method: 'POST', keepalive, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
    return res.status === 409 || res.status === 401 || res.status === 403 || res.status === 404 ? 'stop' : 'ok'
  })
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const conf = useRef<(HTMLButtonElement | null)[]>([])
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const item = items[idx]

  const load = useCallback(async () => {
    loadRequest.current?.abort()
    const request = new AbortController()
    loadRequest.current = request
    setError(null)
    setLoadReference(null)
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)])
      const res = await fetch(`/api/tests/attempt/${attemptId}`, { cache: 'no-store', signal })
      const data: AttemptLoad | null = await res.json().catch(() => null)
      if (request.signal.aborted) return
      if (!res.ok || !data?.ok) {
        if (data && !data.ok && data.requestId) setLoadReference(data.requestId)
        setError(res.status === 404 ? 'This paper is unavailable. Open Tests to find your papers.' : 'Your paper could not be loaded. Try again to open it with your saved answers.')
        return
      }
      if (data.attempt.status === 'scored') { routerRef.current.replace(data.attempt.rehearsal ? `/app/tests/rehearsal/${data.attempt.rehearsal.id}` : `/app/tests/${attemptId}/result`); return }
      // A rehearsal session's clock starts only on the hub's explicit Start.
      if (data.attempt.rehearsal && !data.attempt.rehearsal.started) { routerRef.current.replace(`/app/tests/rehearsal/${data.attempt.rehearsal.id}`); return }
      if (!data.items.length) { setError('The questions could not be loaded. Try again to open the paper.'); return }
      setMeta(data.attempt); setItems(data.items); setPaused(data.attempt.paused)
      setClockSkew(new Date(data.serverNow).getTime() - Date.now())
      const first = data.items.findIndex(i => !i.answer)
      setIdx(first === -1 ? 0 : first)
      setReviewing(first === -1)
    } catch {
      if (!request.signal.aborted) setError('Your paper could not be loaded. Try again to open it with your saved answers.')
    }
  }, [attemptId])
  useEffect(() => { void load(); return () => loadRequest.current?.abort() }, [load])

  // Load the draft and saved time whenever the question changes.
  useEffect(() => {
    if (!item) return
    curId.current = item.id
    active.current = item.activeSeconds; interrupted.current = item.interruptedSeconds; lastFlush.current = active.current + interrupted.current
    setDraft({ selected: item.answer?.selected ?? null, confidence: item.answer?.confidence ?? null })
    setSaving(item.answer ? 'saved' : 'idle'); setError(null)
    headingRef.current?.focus()
    progress.current!.push({ itemId: item.id, activeSeconds: active.current, interruptedSeconds: interrupted.current, visit: true })
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback((keepalive = false) => {
    const id = curId.current
    if (!id || reviewing) return
    const payload = { itemId: id, activeSeconds: active.current, interruptedSeconds: interrupted.current }
    if (keepalive) progress.current!.final(payload); else progress.current!.push(payload)
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
    if (submitPending.current) return
    submitPending.current = true
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`/api/tests/attempt/${attemptId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowUnanswered: auto || allowUnanswered }) })
      const data = await res.json()
      if (data.ok) { progress.current?.close(); routerRef.current.replace(data.resultUrl ?? `/app/tests/${attemptId}/result`); return }
      setError(data.error ?? 'Could not submit. Try again.')
    } catch {
      setError('We could not confirm the submission. Try again to open the result or submit the same saved answers.')
    }
    submitPending.current = false
    setSubmitting(false)
    setTimeout(() => { autoFired.current = false }, 5000)   // a failed automatic submit is retried, but not in a tight loop
  }, [attemptId, allowUnanswered])
  useEffect(() => {
    if (!meta?.timed || !meta.deadlineAt) return
    const tick = () => {
      const left = Math.round((new Date(meta.deadlineAt!).getTime() - (Date.now() + clockSkew)) / 1000)
      setRemaining(left)
      if (left <= 0 && !autoFired.current) { autoFired.current = true; void submit(true) }   // once: a slow response must not fire a submit every second
    }
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t)
  }, [meta?.timed, meta?.deadlineAt, clockSkew]) // eslint-disable-line react-hooks/exhaustive-deps

  // One counter per question: a delayed response for an older choice must not overwrite what the student chose since, and a lost response
  // (the answer may or may not have committed) is shown as "Not saved" with a retry. The save is idempotent per question, so retry is safe.
  const saveSeq = useRef<Record<string, number>>({})
  const stamp = useRef(0)   // monotonic across this tab (and ordered across tabs by the wall clock): the server keeps the newest stamp per question
  async function save(selected: number, confidence: Level, flagged = item.flagged) {
    stamp.current = Math.max(stamp.current + 1, Date.now() * 1000)
    const clientSeq = stamp.current
    const id = item.id, seq = (saveSeq.current[id] ?? 0) + 1
    saveSeq.current[id] = seq
    const current = () => saveSeq.current[id] === seq
    setSaving('saving'); setError(null)
    let data: { ok?: boolean; error?: string; code?: string; current?: { selected: number; confidence: Level } | null } | null = null
    try {
      const res = await fetch(`/api/tests/attempt/${attemptId}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id, selectedOptionIndex: selected, confidence, activeSeconds: active.current, interruptedSeconds: interrupted.current, flagged, clientSeq }) })
      data = await res.json().catch(() => null)
    } catch { data = null }
    if (!current()) return   // a newer choice for this question is in flight; it decides the outcome
    if (!data) { setSaving('error'); setError('Your answer is still here, but we could not confirm it was saved. Press Retry; saving twice is safe.'); return }
    if (data.code === 'stale_answer') {
      // Changed elsewhere (another tab or a slower request): show what is actually saved, and say so.
      const cur = data.current
      if (cur) { setItems(list => list.map(i => i.id === id ? { ...i, answer: { selected: cur.selected, confidence: cur.confidence } } : i)); setDraft({ selected: cur.selected, confidence: cur.confidence }) }
      setSaving('saved'); setError('This answer was changed in another tab, so the newer saved answer is shown.'); return
    }
    if (!data.ok) { setSaving('error'); setError(data.error ?? 'Could not save that answer.'); if (data.code === 'time_up') submit(true); return }
    setItems(list => list.map(i => i.id === id ? { ...i, answer: { selected, confidence }, flagged } : i))
    setMeta(m => m ? { ...m, answered: items.filter(i => i.id === id ? true : i.answer).length } : m)
    setSaving('saved')
  }
  const choose = (selected: number | null, confidence: Level | null) => {
    setDraft({ selected, confidence })
    if (selected !== null && confidence !== null) save(selected, confidence)
  }
  async function toggleFlag() {
    const flagged = !item.flagged
    setItems(list => list.map(i => i.id === item.id ? { ...i, flagged } : i))
    progress.current!.push({ itemId: item.id, activeSeconds: active.current, interruptedSeconds: interrupted.current, flagged })
  }
  // Discard drops only the LOCAL, unsaved choice. It never clears an answer the server already holds. Any save still in flight for this question
  // is retired first (its response is ignored), then the server's actual state is read back, so a save that did commit is shown, not hidden.
  async function discard() {
    const id = item.id
    saveSeq.current[id] = (saveSeq.current[id] ?? 0) + 1
    setDraft({ selected: item.answer?.selected ?? null, confidence: item.answer?.confidence ?? null }); setError(null)
    try {
      const data = await (await fetch(`/api/tests/attempt/${attemptId}`, { cache: 'no-store' })).json()
      const fresh = (data.items as Item[] | undefined)?.find(i => i.id === id)
      if (fresh) { setItems(list => list.map(i => i.id === id ? { ...i, answer: fresh.answer } : i)); setDraft({ selected: fresh.answer?.selected ?? null, confidence: fresh.answer?.confidence ?? null }) }
      setSaving(fresh?.answer ? 'saved' : 'idle')
    } catch { setSaving(item.answer ? 'saved' : 'idle') }
  }
  async function pause(action: 'pause' | 'resume') {
    if (action === 'pause') flush()
    setError(null)
    try {
      const res = await fetch(`/api/tests/attempt/${attemptId}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) setPaused(data.paused)
      else setError(data?.error ?? 'Could not confirm the timer change. Try again.')
    } catch { setError('Could not confirm the timer change. Try again.') }
  }

  const complete = draft.selected !== null && draft.confidence !== null
  const savedHere = Boolean(item?.answer) && draft.selected === item?.answer?.selected && draft.confidence === item?.answer?.confidence
  // A blank question can be skipped and returned to; no answer means no invented confidence. A half-made choice is never dropped silently.
  const blank = draft.selected === null && draft.confidence === null && !item?.answer
  const partial = !complete && !blank && !savedHere
  const canLeave = !item || savedHere || blank
  const unsaved = Boolean(item) && !savedHere && !blank
  // Warn before the tab closes with a choice that was never saved.
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])
  const go = (n: number) => { if (n === idx || !canLeave) return; flush(); setIdx(Math.min(Math.max(n, 0), items.length - 1)); setReviewing(false) }
  const answered = items.filter(i => i.answer).length
  const unanswered = items.filter(i => !i.answer)

  const kindLabel = useMemo(() => meta?.rehearsal ? `Rehearsal · Session ${meta.rehearsal.session} of 2` : meta?.adaptive ? `Practice set ${meta.adaptive.block} of up to ${meta.adaptive.cap / 5} (not evidence)` : KIND_LABEL[meta?.kind ?? 'module'] ?? 'Assessment', [meta?.kind, meta?.rehearsal, meta?.adaptive])

  if (error && !meta) return <div className="empty-state"><h2>This assessment could not be loaded</h2><p role="alert">{error}</p>
    {loadReference && <p className="muted">Support reference {loadReference}</p>}
    <button type="button" className="primary-button" onClick={() => void load()}>Retry loading paper</button>{' '}
    <a href="/app/tests" className="text-button">Back to Tests</a></div>
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
        <p data-review-counts>{answered} answered · {unanswered.length} not answered · {items.filter(i => i.flagged).length} flagged. You can change any answer or confidence until you submit.</p>
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
        <a className="text-button" href={meta.rehearsal ? `/app/tests/rehearsal/${meta.rehearsal.id}` : '/app/tests'} onClick={e => { if (unsaved && !window.confirm('Your choice on this question is not saved. Leave anyway? You can resume this paper later.')) e.preventDefault(); else flush(true) }}>Leave and resume later</a>
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
          ? <button type="button" className="primary-button" disabled={partial || (complete && !savedHere && saving !== 'error')} onClick={() => (complete && !savedHere ? save(draft.selected!, draft.confidence!) : go(idx + 1))}>{complete && !savedHere ? (saving === 'error' ? 'Retry saving' : 'Saving…') : blank ? 'Skip' : 'Next'}</button>
          : <button type="button" className="primary-button" disabled={partial || (complete && !savedHere && saving !== 'error')} onClick={() => { if (complete && !savedHere) { save(draft.selected!, draft.confidence!); return } flush(); setReviewing(true) }}>{complete && !savedHere && saving === 'error' ? 'Retry saving' : 'Review and submit'}</button>}
        {unsaved && saving !== 'saving' && <button type="button" className="text-button" onClick={discard}>{item.answer ? 'Discard my change (keeps the saved answer)' : 'Discard my choice'}</button>}
      </footer>
      {!complete && <p className="muted attempt__why" aria-live="polite">{draft.selected === null && draft.confidence === null ? 'Choose an answer and how sure you are, or skip and come back.' : draft.selected === null ? 'Choose an answer to finish this one, or discard your choice to move on.' : 'Now choose how sure you are, or discard your choice to move on.'}</p>}
      {complete && unsaved && saving === 'error' && <p className="muted attempt__why" aria-live="polite">Not saved yet. Retry saving, or discard your change, before you move on.</p>}

      {challengeOpen && <ChallengeDialog itemId={item.id} attemptId={attemptId} onClose={() => setChallengeOpen(false)} onRaised={() => setChallengeOpen(false)} />}
    </div>
  )
}

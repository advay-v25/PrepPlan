'use client'

import { useRef, useState } from 'react'
import { cardCall, keyring, when, type Card, type Rating } from './cards'

const RATE: { v: Rating; label: string }[] = [{ v: 'again', label: 'Again' }, { v: 'hard', label: 'Hard' }, { v: 'good', label: 'Good' }, { v: 'easy', label: 'Easy' }]

/**
 * One-card-at-a-time review. Ratings are the student's own recall report: they schedule review and never change evidence, coverage, a repair or a readiness band.
 *  - The server's returned due time decides what happens next: a card rated Again is due in ten minutes, so it is parked and offered when it is actually due, not re-queued now.
 *  - An exact retry of a lost-response rating reuses its request key and applies once; a different rating is a different request.
 *  - A card that changed in another tab is replaced by its current state, with a note; nothing is applied silently.
 * All hooks run on every render (the empty-queue return comes after them).
 */
export function FlashcardReview({ cards, onDone }: { cards: Card[]; onDone: (summary: { reviewed: number; nextDueAt: string | null }) => void }) {
  const [queue, setQueue] = useState<Card[]>(cards)
  const [parked, setParked] = useState<Card[]>([])     // rated Again: not due yet
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(0)
  const keys = useRef(keyring())
  const card = queue[0]

  const release = () => {   // parked cards whose time has come rejoin the queue
    const now = Date.now(); const ready = parked.filter(c => new Date(c.due_at).getTime() <= now)
    if (ready.length) { setQueue(q => [...q, ...ready]); setParked(p => p.filter(c => !ready.includes(c))) }
    return ready.length
  }

  async function rate(r: Rating) {
    if (!card) return
    setBusy(true); setProblem(null); setNote(null)
    const sig = `${card.id}:${card.revision}:${r}`
    const res = await cardCall({ action: 'review', cardId: card.id, rating: r, expectedRevision: card.revision, requestKey: keys.current.keyFor(sig) })
    if (res.ok && res.card) {
      keys.current.done(sig); setReviewed(n => n + 1); setShown(false)
      const due = new Date(res.card.due_at).getTime() <= Date.now()
      setQueue(q => q.slice(1).concat(due ? [res.card!] : []))
      if (!due) setParked(p => [...p, res.card!])
      if (res.replay) setNote('That rating had already been saved; the schedule shown is the saved one.')
    } else if (res.code === 'STALE_CARD' && res.card) {
      keys.current.done(sig); setQueue(q => [res.card!, ...q.slice(1)]); setShown(false)
      setNote('This card was changed or rated somewhere else, so your rating was not applied. Here is its current state; rate it again if you still want to.')
    } else if (res.code === 'NOT_FOUND') {
      keys.current.done(sig); setQueue(q => q.slice(1)); setShown(false); setNote('That card was deleted elsewhere, so it was skipped.')
    } else setProblem(res.error ?? 'That rating was not saved. It is safe to press the same rating again.')
    setBusy(false)
  }

  if (!card) {
    const next = parked.map(c => c.due_at).sort()[0] ?? null
    return (
      <div className="flashcard-review" aria-live="polite">
        <p><strong>{reviewed > 0 ? `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}.` : 'Nothing to review right now.'}</strong></p>
        <p className="muted">{next ? `${parked.length} card${parked.length === 1 ? ' comes' : 's come'} back ${when(next)}. That is a schedule, not a verdict.` : 'Nothing else is due now. New cards and the passing of time bring more.'}</p>
        {note && <p role="status" className="muted">{note}</p>}
        <p>
          {parked.length > 0 && <button type="button" className="secondary-button" onClick={() => { if (!release()) setNote('Not due yet.') }}>Check again</button>}{' '}
          <button type="button" className="text-button" onClick={() => onDone({ reviewed, nextDueAt: next })}>Back</button>
        </p>
      </div>
    )
  }
  return (
    <div className="flashcard-review" aria-live="polite">
      <p className="muted">{queue.length} left{parked.length > 0 ? ` · ${parked.length} coming back later` : ''}</p>
      <div className="flashcard"><strong>{card.front}</strong>{shown && <p className="flashcard__back">{card.back}</p>}</div>
      {!shown
        ? <button type="button" className="primary-button" onClick={() => setShown(true)}>Show the answer</button>
        : <div role="group" aria-label="How well did you recall it?" className="flashcard-review__rate">
            {RATE.map(r => <button key={r.v} type="button" className="secondary-button" disabled={busy} onClick={() => rate(r.v)}>{r.label}</button>)}
          </div>}
      {note && <p role="status" className="muted">{note}</p>}
      {problem && <p role="alert" className="review-error">{problem}</p>}
    </div>
  )
}

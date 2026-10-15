'use client'

import { useEffect, useState } from 'react'

type Card = { id: string; front: string; back: string; due_at: string; reps: number }
type Rating = 'again' | 'hard' | 'good' | 'easy'
const RATE: { v: Rating; label: string }[] = [{ v: 'again', label: 'Again' }, { v: 'hard', label: 'Hard' }, { v: 'good', label: 'Good' }, { v: 'easy', label: 'Easy' }]

async function call(body: object) {
  const res = await fetch('/api/curriculum/flashcards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

/** One-card-at-a-time review. Ratings are your own recall report — they schedule review and never change a readiness band. */
export function FlashcardReview({ cards, onDone }: { cards: Card[]; onDone: () => void }) {
  const [queue, setQueue] = useState(cards)
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const card = queue[0]
  if (!card) return <p>All done — nothing else is due. <button type="button" className="text-button" onClick={onDone}>Back</button></p>

  async function rate(r: Rating) {
    setBusy(true)
    try {
      const res = await call({ action: 'review', cardId: card.id, rating: r })
      if (res.ok) { setQueue(q => r === 'again' ? [...q.slice(1), card] : q.slice(1)); setShown(false) }
    } finally { setBusy(false) }
  }
  return (
    <div className="flashcard-review" aria-live="polite">
      <p className="muted">{queue.length} left</p>
      <div className="flashcard"><strong>{card.front}</strong>{shown && <p className="flashcard__back">{card.back}</p>}</div>
      {!shown
        ? <button type="button" className="primary-button" onClick={() => setShown(true)}>Show the answer</button>
        : <div role="group" aria-label="How well did you recall it?" className="flashcard-review__rate">
            {RATE.map(r => <button key={r.v} type="button" className="secondary-button" disabled={busy} onClick={() => rate(r.v)}>{r.label}</button>)}
          </div>}
    </div>
  )
}

/** Cards for one subject or reading: list, add, edit, delete, suggest from outcomes, review. */
export function FlashcardPanel({ scopeType, scopeId, label }: { scopeType: 'subject' | 'reading'; scopeId: string; label: string }) {
  const [cards, setCards] = useState<Card[] | null>(null)
  const [front, setFront] = useState(''); const [back, setBack] = useState('')
  const [drafts, setDrafts] = useState<{ outcomeId: string; front: string }[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch(`/api/curriculum/flashcards?scopeType=${scopeType}&scopeId=${scopeId}`)
    const body = await res.json(); if (body.ok) setCards(body.cards)
  }
  useEffect(() => { load() }, [scopeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const due = (cards ?? []).filter(c => new Date(c.due_at).getTime() <= Date.now())

  async function add(f = front, b = back, source: 'manual' | 'outcome_prompt' = 'manual') {
    setMessage(null)
    const res = await call({ action: 'create', scopeType, scopeId, front: f, back: b, source })
    if (!res.ok) { setMessage(res.error); return }
    setFront(''); setBack(''); load()
  }
  async function saveEdit(c: Card, f: string, b: string) {
    const res = await call({ action: 'update', cardId: c.id, front: f, back: b })
    if (!res.ok) { setMessage(res.error); return }
    setEditing(null); load()
  }
  async function remove(c: Card) { if (window.confirm('Delete this card?')) { await call({ action: 'delete', cardId: c.id }); load() } }
  async function suggest() {
    const res = await call({ action: 'draft', scopeType, scopeId })
    if (res.ok) setDrafts(res.drafts)
  }

  if (reviewing) return <FlashcardReview cards={due} onDone={() => { setReviewing(false); load() }} />
  return (
    <div className="flashcards">
      <div className="flashcards__head">
        <span>{cards === null ? 'Loading…' : `${cards.length} card${cards.length === 1 ? '' : 's'} · ${due.length} due`}</span>
        {due.length > 0 && <button type="button" className="primary-button" onClick={() => setReviewing(true)}>Review {due.length} due</button>}
        <button type="button" className="text-button" onClick={suggest}>Suggest fronts from the outcomes</button>
      </div>

      {drafts.length > 0 && (
        <div className="flashcards__drafts">
          <p className="muted">These are prompts only — write the answer in your own words, then add the card.</p>
          <ul>{drafts.map(d => (
            <li key={d.outcomeId}>{d.front}{' '}
              <button type="button" className="text-button" onClick={() => { setFront(d.front); setBack(''); setDrafts(x => x.filter(y => y.outcomeId !== d.outcomeId)) }}>Use</button></li>
          ))}</ul>
        </div>
      )}

      <form className="flashcards__form" onSubmit={e => { e.preventDefault(); add() }}>
        <label>Front <input type="text" value={front} maxLength={1000} onChange={e => setFront(e.target.value)} placeholder={`A question about ${label}`} /></label>
        <label>Back <textarea value={back} maxLength={2000} rows={3} onChange={e => setBack(e.target.value)} placeholder="The answer, in your own words" /></label>
        <button type="submit" className="secondary-button" disabled={!front.trim() || !back.trim()}>Add card</button>
      </form>
      {message && <p role="alert" className="review-error">{message}</p>}

      <ul className="flashcards__list">
        {(cards ?? []).map(c => editing === c.id
          ? <EditRow key={c.id} card={c} onSave={saveEdit} onCancel={() => setEditing(null)} />
          : (
            <li key={c.id}><strong>{c.front}</strong><span>{c.back}</span>
              <span>
                <button type="button" className="text-button" onClick={() => setEditing(c.id)}>Edit</button>{' '}
                <button type="button" className="text-button" onClick={() => remove(c)}>Delete</button>
              </span></li>
          ))}
      </ul>
    </div>
  )
}

function EditRow({ card, onSave, onCancel }: { card: Card; onSave: (c: Card, f: string, b: string) => void; onCancel: () => void }) {
  const [f, setF] = useState(card.front); const [b, setB] = useState(card.back)
  return (
    <li className="flashcards__edit">
      <input type="text" value={f} maxLength={1000} onChange={e => setF(e.target.value)} aria-label="Front" />
      <textarea value={b} maxLength={2000} rows={3} onChange={e => setB(e.target.value)} aria-label="Back" />
      <span><button type="button" className="secondary-button" disabled={!f.trim() || !b.trim()} onClick={() => onSave(card, f, b)}>Save</button>{' '}
        <button type="button" className="text-button" onClick={onCancel}>Cancel</button></span>
    </li>
  )
}

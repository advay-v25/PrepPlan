'use client'

import { WhenReady } from '../ui/WhenReady'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FlashcardReview } from './FlashcardReview'
import { NoteCardDrafter } from './NoteCardDrafter'
import { cardCall, keyring, when, type Card } from './cards'

export { FlashcardReview }
type Page = { cards: Card[]; matching: number; total: number; dueCount: number }
type Filter = 'all' | 'due' | 'later'
const PAGE = 50

/**
 * Cards for one subject or reading: counted, searchable, paginated list; add (always works, no model); edit with revision protection; delete with confirmation;
 * outcome PROMPTS (clearly not cards); optional note-based drafts; review. Every failure is shown as a failure: a failed load is not "no cards", a failed delete is not a deletion.
 */
export function FlashcardPanel({ scopeType, scopeId, label }: { scopeType: 'subject' | 'reading'; scopeId: string; label: string }) {
  const [page, setPage] = useState<Page | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all'); const [q, setQ] = useState(''); const [applied, setApplied] = useState('')
  const [front, setFront] = useState(''); const [back, setBack] = useState('')
  const [prompts, setPrompts] = useState<{ outcomeId: string; front: string }[]>([])
  const [editing, setEditing] = useState<string | null>(null); const [deleting, setDeleting] = useState<string | null>(null)
  const [reviewCards, setReviewCards] = useState<Card[] | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const keys = useRef(keyring()); const addRef = useRef<HTMLInputElement>(null); const listRef = useRef<HTMLUListElement>(null)
  const latest = useRef(0)   // replies can arrive out of order: only the newest list request may change what is shown
  // What the student has chosen NOW. A change that lands late must reload this, not the selection it was started under.
  const chosen = useRef({ filter, applied }); chosen.current = { filter, applied }
  const wanted = useRef(PAGE)   // how many cards the student has asked to see

  const fetchPage = useCallback(async (offset: number, limit = PAGE) => {
    const { filter, applied } = chosen.current
    const qs = new URLSearchParams({ scopeType, scopeId, limit: String(limit), offset: String(offset), filter })
    if (applied) qs.set('q', applied)
    const res = await fetch(`/api/curriculum/flashcards?${qs}`), b = await res.json().catch(() => null)
    if (!res.ok || !b?.ok) throw new Error(b?.error ?? 'Your cards could not be loaded. Nothing was changed.')
    return b as Page
  }, [scopeType, scopeId])
  /** Reloads the current selection, as many cards of it as are wanted (the server gives at most 100 a request). */
  const load = useCallback(async () => {
    setLoadError(null); setMoreError(null)
    const mine = ++latest.current
    try {
      const next = await fetchPage(0, Math.min(wanted.current, 100))
      while (mine === latest.current && next.cards.length < Math.min(wanted.current, next.matching)) {
        const rest = await fetchPage(next.cards.length, Math.min(wanted.current - next.cards.length, 100))
        if (!rest.cards.length) break
        next.cards = [...next.cards, ...rest.cards]
      }
      if (mine === latest.current) setPage(next)
    } catch (e) { if (mine === latest.current) setLoadError((e as Error).message === 'Failed to fetch' ? 'Could not reach the server. Nothing was changed.' : (e as Error).message) }
  }, [fetchPage])
  // A new filter or search starts again from its first page.
  useEffect(() => { wanted.current = PAGE; setPage(null); void load() }, [load, filter, applied])
  async function more() {
    if (!page) return; setMoreError(null)
    wanted.current = page.cards.length + PAGE
    const mine = ++latest.current
    try { const next = await fetchPage(page.cards.length); if (mine === latest.current) setPage({ ...next, cards: [...page.cards, ...next.cards] }) } catch (e) { if (mine === latest.current) setMoreError((e as Error).message) }
  }

  const fail = (text: string) => setMessage({ kind: 'error', text })
  async function add() {
    setMessage(null); setBusy(true)
    const sig = `create:${front}:${back}`
    const res = await cardCall({ action: 'create', scopeType, scopeId, front, back, requestKey: keys.current.keyFor(sig) })
    setBusy(false)
    if (!res.ok) { fail(res.error ?? 'Could not save the card.'); return }
    keys.current.done(sig); setFront(''); setBack(''); setMessage({ kind: 'info', text: res.replay ? 'That card was already saved.' : 'Card added.' }); await load(); addRef.current?.focus()
  }
  async function saveEdit(c: Card, f: string, b: string): Promise<{ stale?: Card; error?: string } | null> {
    const sig = `update:${c.id}:${c.revision}:${f}:${b}`
    const res = await cardCall({ action: 'update', cardId: c.id, expectedRevision: c.revision, front: f, back: b, requestKey: keys.current.keyFor(sig) })
    if (res.ok) { keys.current.done(sig); setEditing(null); setMessage({ kind: 'info', text: 'Card saved.' }); await load(); return null }
    if (res.code === 'STALE_CARD' && res.card) { keys.current.done(sig); return { stale: res.card } }
    if (res.code === 'NOT_FOUND') { keys.current.done(sig); setEditing(null); fail('That card was deleted elsewhere.'); await load(); return null }
    return { error: res.error ?? 'Could not save the card.' }
  }
  async function remove(c: Card) {
    const sig = `delete:${c.id}:${c.revision}`
    const res = await cardCall({ action: 'delete', cardId: c.id, expectedRevision: c.revision, requestKey: keys.current.keyFor(sig) })
    if (res.ok || res.code === 'NOT_FOUND') { keys.current.done(sig); setDeleting(null); setMessage({ kind: 'info', text: 'Card deleted.' }); await load(); addRef.current?.focus(); return }
    if (res.code === 'STALE_CARD') { keys.current.done(sig); setDeleting(null); fail('That card changed somewhere else, so it was not deleted. Its current text is shown; delete it again if you still want to.'); await load(); return }
    fail(`The card was not deleted; it is still here. ${res.error ?? 'Try again.'}`)
  }
  async function suggest() {
    setMessage(null)
    const res = await cardCall({ action: 'draft', scopeType, scopeId })
    if (res.ok) setPrompts((res as any).drafts ?? []); else fail((res as any).error ?? 'Prompts could not be loaded. Nothing was changed.')
  }

  async function startReview() {   // the authoritative due list, not whatever page happens to be on screen
    setMessage(null)
    try {
      const res = await fetch(`/api/curriculum/flashcards?${new URLSearchParams({ scopeType, scopeId, filter: 'due', limit: String(PAGE) })}`), b = await res.json().catch(() => null)
      if (!res.ok || !b?.ok) throw new Error(b?.error ?? 'Your due cards could not be loaded.')
      if (!b.cards.length) { setMessage({ kind: 'info', text: 'Nothing is due right now.' }); await load(); return }
      setReviewCards(b.cards)
    } catch (e) { fail((e as Error).message === 'Failed to fetch' ? 'Could not reach the server. Nothing was changed.' : (e as Error).message) }
  }
  if (reviewCards) return <FlashcardReview cards={reviewCards} onDone={() => { setReviewCards(null); void load() }} />
  const due = page?.dueCount ?? 0
  return (
    <WhenReady>
    <div className="flashcards">
      <div className="flashcards__head">
        <span role="status">{loadError ? 'Cards unavailable' : page === null ? 'Loading…' : `${page.total} card${page.total === 1 ? '' : 's'} · ${due} due now`}</span>
        {due > 0 && <button type="button" className="primary-button" onClick={startReview}>Review {Math.min(due, PAGE)} due</button>}
      </div>
      {loadError && <p role="alert" className="review-error">{loadError} <button type="button" className="text-button" onClick={load}>Try again</button></p>}

      <form className="flashcards__form" onSubmit={e => { e.preventDefault(); void add() }}>
        <label>Front <input ref={addRef} type="text" value={front} maxLength={1000} disabled={busy} onChange={e => setFront(e.target.value)} placeholder={`A question about ${label}`} /></label>
        <label>Back <textarea value={back} maxLength={2000} rows={3} disabled={busy} onChange={e => setBack(e.target.value)} placeholder="The answer, in your own words" /></label>
        <button type="submit" className="secondary-button" disabled={busy || !front.trim() || !back.trim()}>Add card</button>
      </form>
      <div className="flashcards__tools">
        <button type="button" className="text-button" onClick={suggest}>Show question prompts from the outcomes</button>{' · '}
        <NoteCardDrafter key={`${scopeType}:${scopeId}`} scopeType={scopeType} scopeId={scopeId} label={label} onSaved={load} />
      </div>
      {prompts.length > 0 && (
        <div className="flashcards__drafts">
          <p className="muted">These are question prompts only, taken from the outcome list. They are not cards and not generated answers: write the answer in your own words, then add the card.</p>
          <ul>{prompts.map(d => (
            <li key={d.outcomeId}>{d.front}{' '}
              <button type="button" className="text-button" onClick={() => { setFront(d.front); setBack(''); setPrompts(x => x.filter(y => y.outcomeId !== d.outcomeId)); addRef.current?.focus() }}>Use</button></li>
          ))}</ul>
        </div>
      )}
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'review-error' : 'muted'}>{message.text}</p>}

      {page && page.total > 0 && (
        <form className="flashcards__find" role="search" onSubmit={e => { e.preventDefault(); setApplied(q.trim()) }}>
          <label>Search cards <input type="search" value={q} maxLength={100} onChange={e => setQ(e.target.value)} /></label>{' '}
          <label>Show <select value={filter} onChange={e => setFilter(e.target.value as Filter)}><option value="all">All</option><option value="due">Due now</option><option value="later">Scheduled later</option></select></label>{' '}
          <button type="submit" className="text-button">Search</button>
          {applied && <button type="button" className="text-button" onClick={() => { setQ(''); setApplied('') }}>Clear search</button>}
        </form>
      )}
      {page && page.matching === 0 && page.total > 0 && <p className="muted">No cards match. {applied ? 'Try a different search.' : filter === 'due' ? 'Nothing is due right now.' : ''}</p>}
      {page && page.total === 0 && <p className="muted">No cards yet. Add one above; there is no minimum and nothing here counts as evidence.</p>}

      <ul className="flashcards__list" ref={listRef} aria-label="Your cards">
        {(page?.cards ?? []).map(c => editing === c.id
          ? <EditRow key={c.id} card={c} onSave={saveEdit} onCancel={() => setEditing(null)} />
          : (
            <li key={c.id}><strong>{c.front}</strong><span>{c.back}</span>
              <small className="muted">{new Date(c.due_at).getTime() <= Date.now() ? 'Due now' : `Next ${when(c.due_at)}`}</small>
              <span>
                <button type="button" className="text-button" onClick={() => { setEditing(c.id); setDeleting(null) }}>Edit</button>{' '}
                {deleting === c.id
                  ? <><span role="group" aria-label="Confirm delete">Delete this card? <button type="button" className="text-button" onClick={() => remove(c)}>Yes, delete</button> <button type="button" className="text-button" onClick={() => setDeleting(null)}>Keep it</button></span></>
                  : <button type="button" className="text-button" onClick={() => setDeleting(c.id)}>Delete</button>}
              </span></li>
          ))}
      </ul>
      {page && page.cards.length < page.matching && <p><button type="button" className="secondary-button" onClick={more}>Show more ({page.matching - page.cards.length} more)</button></p>}
      {moreError && <p role="alert" className="review-error">{moreError} <button type="button" className="text-button" onClick={more}>Try again</button></p>}
    </div>
    </WhenReady>
  )
}

/** Edit with revision protection: a stale save shows the saved version beside the student's own text, which is kept. */
function EditRow({ card, onSave, onCancel }: { card: Card; onSave: (c: Card, f: string, b: string) => Promise<{ stale?: Card; error?: string } | null>; onCancel: () => void }) {
  const [base, setBase] = useState(card)
  const [f, setF] = useState(card.front); const [b, setB] = useState(card.back)
  const [stale, setStale] = useState<Card | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  async function save() {
    setBusy(true); setError(null)
    const r = await onSave(base, f, b); setBusy(false)
    if (r?.stale) { setStale(r.stale); setBase(r.stale) } else if (r?.error) setError(r.error)
  }
  return (
    <li className="flashcards__edit">
      <input ref={first} type="text" value={f} maxLength={1000} disabled={busy} onChange={e => setF(e.target.value)} aria-label="Front" />
      <textarea value={b} maxLength={2000} rows={3} disabled={busy} onChange={e => setB(e.target.value)} aria-label="Back" />
      {stale && <div role="alert" className="review-error"><p>This card was changed somewhere else, so your edit was not applied. Your text is kept above. The saved version is:</p>
        <p><strong>{stale.front}</strong> — {stale.back}</p><p>Press Save to replace it with your text, or Cancel to keep the saved one.</p></div>}
      {error && <p role="alert" className="review-error">{error}</p>}
      <span><button type="button" className="secondary-button" disabled={busy || !f.trim() || !b.trim()} onClick={save}>{stale ? 'Save my text anyway' : 'Save'}</button>{' '}
        <button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button></span>
    </li>
  )
}

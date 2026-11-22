'use client'

import { useCallback, useEffect, useState } from 'react'
import { FlashcardReview } from './FlashcardReview'
import { when, type Card } from './cards'

type Due = { cards: Card[]; total: number; totalCards: number; nextDueAt: string | null }

/** Everything due across subjects. A failed read is shown as a failed read (with Retry), never as "nothing is due". */
export function DueFlashcards() {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; due: Due }>({ kind: 'loading' })
  const [reviewing, setReviewing] = useState(false)
  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/curriculum/flashcards?due=1'), b = await res.json().catch(() => null)
      if (res.ok && b?.ok) setState({ kind: 'ready', due: b })
      else setState({ kind: 'error', message: b?.error ?? 'Your cards could not be loaded. Nothing was changed.' })
    } catch { setState({ kind: 'error', message: 'Could not reach the server. Nothing was changed.' }) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (state.kind === 'loading') return <p role="status" aria-busy="true">Loading your cards…</p>
  if (state.kind === 'error') return <p role="alert" className="review-error">{state.message} <button type="button" className="text-button" onClick={load}>Try again</button></p>
  const { due } = state
  if (reviewing) return <FlashcardReview cards={due.cards} onDone={() => { setReviewing(false); void load() }} />
  if (due.total === 0) return (
    <div>
      <p><strong>{due.totalCards === 0 ? 'You have no cards yet.' : 'Nothing is due right now.'}</strong></p>
      <p className="muted">{due.totalCards === 0 ? 'Add cards on a reading or subject page.' : due.nextDueAt ? `Your next card is due ${when(due.nextDueAt)}.` : 'None of your cards is scheduled.'}</p>
    </div>
  )
  return (
    <div>
      <p><strong>{due.total} card{due.total === 1 ? '' : 's'} due</strong>{due.total > due.cards.length ? ` (showing the first ${due.cards.length}; the rest follow when you finish)` : ''}.</p>
      <button type="button" className="primary-button" onClick={() => setReviewing(true)}>Review {due.cards.length}</button>
    </div>
  )
}

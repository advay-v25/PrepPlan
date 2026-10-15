'use client'

import { useEffect, useState } from 'react'
import { FlashcardReview } from './FlashcardPanel'

export function DueFlashcards() {
  const [cards, setCards] = useState<any[] | null>(null)
  useEffect(() => { fetch('/api/curriculum/flashcards?due=1').then(r => r.json()).then(b => setCards(b.ok ? b.cards : [])) }, [])
  if (cards === null) return <p>Loading…</p>
  if (cards.length === 0) return <p>Nothing is due. Add cards on a reading or subject page.</p>
  return <FlashcardReview cards={cards} onDone={() => setCards([])} />
}

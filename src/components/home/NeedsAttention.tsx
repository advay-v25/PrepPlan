import Link from 'next/link'
import { AlertTriangle, ChevronRight, Target } from 'lucide-react'
import type { AttentionItem, RepairThread } from '../../lib/state/types'

/**
 * Decisions waiting on the student, in one place: the attention queue (setup gaps, missing logs,
 * proposals) and open weak areas — real repair threads opened by test evidence, never a guessed
 * weakness. Renders nothing when there is nothing to decide.
 */
export function NeedsAttention({ items, threads }: { items: AttentionItem[]; threads: RepairThread[] }) {
  // At most three decisions in all: the queue first (already deduplicated by identity), weak areas filling what is left.
  const shownItems = items.slice(0, 3)
  const shownThreads = threads.slice(0, Math.max(0, 3 - shownItems.length))
  if (shownItems.length === 0 && shownThreads.length === 0) return null
  return (
    <section className="home-card attention" aria-labelledby="attention-h">
      <header className="home-card__head">
        <h2 id="attention-h">Needs your decision</h2>
      </header>
      <ul className="attention__list">
        {shownItems.map(item => (
          <li key={item.id}>
            <Link href={item.destination} className="attention__row">
              <AlertTriangle size={16} aria-hidden className="attention__icon is-warn" />
              <span className="attention__text"><strong>{item.title}</strong><span>{item.actionLabel}</span></span>
              <ChevronRight size={16} aria-hidden />
            </Link>
          </li>
        ))}
        {shownThreads.map(t => (
          <li key={t.id}>
            <Link href={t.destination} className="attention__row">
              <Target size={16} aria-hidden className="attention__icon is-danger" />
              <span className="attention__text"><strong>{t.conceptName}</strong><span>Weak area from a test</span></span>
              <ChevronRight size={16} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {(items.length > shownItems.length || threads.length > shownThreads.length) && (
        <footer className="home-card__foot"><span /><Link href="/app/tests" className="text-button">{items.length - shownItems.length + threads.length - shownThreads.length} more &rarr;</Link></footer>
      )}
    </section>
  )
}

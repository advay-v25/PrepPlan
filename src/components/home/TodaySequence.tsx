'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { useTaskMutation } from '../calendar/useTaskMutation'
import type { PlanBlock } from '../../lib/state/types'
import { calendarTaskHref } from '../../lib/routing/calendar'

type Ask = { id: string; kind: 'complete' | 'partial' } | null

const KIND: Record<string, string> = {
  study: 'Study', class_consolidation: 'Class follow-up', repair: 'Weak area', recheck: 'Check again',
  review: 'Review', verification: 'Check understanding', diagnostic: 'Paper', mock: 'Mock',
}
const COMPACT_ROWS = 3

/**
 * Today's other work, with real controls. Every button is a revision-guarded write through the
 * same hook Calendar uses. The task already featured in "Up next" is not repeated here.
 * Only completed counts as done; skipped and deferred are resolved but not done.
 */
export function TodaySequence({ tasks, featuredId }: { tasks: PlanBlock[]; featuredId?: string | null }) {
  const m = useTaskMutation()
  const [ask, setAsk] = useState<Ask>(null)
  const [minutes, setMinutes] = useState('')
  const [showAll, setShowAll] = useState(false)

  if (tasks.length === 0) return null
  const done = tasks.filter(t => t.execution === 'completed').length
  const open = tasks.filter(t => !['completed', 'skipped', 'deferred'].includes(t.execution) && t.id !== featuredId)
  const visible = showAll ? open : open.slice(0, COMPACT_ROWS)
  const pct = Math.round((done / tasks.length) * 100)

  async function run(t: PlanBlock, body: Record<string, unknown>, undoMessage: string) {
    await m.call(t.id, { action: 'execution', expectedRevision: t.revision, ...body }, { undoMessage })
  }
  async function submitAsk(t: PlanBlock) {
    const n = Number(minutes)
    const actual = minutes.trim() && Number.isFinite(n) && n > 0 ? { actualDurationMinutes: Math.round(n) } : {}
    await run(t, { execution: ask!.kind === 'partial' ? 'partial' : 'completed', ...actual }, ask!.kind === 'partial' ? 'Marked partly done' : 'Marked complete')
    setAsk(null); setMinutes('')
  }

  return (
    <section className="home-card today" aria-labelledby="today-h">
      <header className="home-card__head">
        <h2 id="today-h">Today</h2>
        <span className="today__count">{done} of {tasks.length} done</span>
      </header>
      <div className="today__bar" role="img" aria-label={`${done} of ${tasks.length} tasks done today`}><span style={{ width: `${pct}%` }} /></div>

      {open.length === 0 ? (
        <p className="home-card__empty">{featuredId ? 'Nothing else is planned today.' : 'Everything planned for today is handled.'}</p>
      ) : (
        <ul className="today__list">
          {visible.map(t => (
            <li key={t.id} className="today__row">
              <div className="today__main">
                <span className="today__kind">{KIND[t.taskType] ?? 'Task'}</span>
                <p className="today__title"><Link href={t.destination || calendarTaskHref(t.id)}>{t.title}</Link></p>
                <p className="today__meta">{t.durationMinutes ? `${t.durationMinutes} min` : 'Flexible'}{t.execution === 'in_progress' ? ' · in progress' : ''}</p>
              </div>
              {ask?.id === t.id ? (
                <form className="today__ask" onSubmit={e => { e.preventDefault(); void submitAsk(t) }}>
                  <label>
                    <span>Minutes it took (optional)</span>
                    <input inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} aria-label="Actual minutes" />
                  </label>
                  <button className="primary-button is-sm" disabled={m.busy}>{ask.kind === 'partial' ? 'Save as partly done' : 'Save'}</button>
                  <button type="button" className="text-button" onClick={() => { setAsk(null); setMinutes('') }}>Cancel</button>
                </form>
              ) : (
                <div className="today__actions">
                  <button className="today__done" disabled={m.busy} onClick={() => setAsk({ id: t.id, kind: 'complete' })} aria-label={`Mark ${t.title} done`}>
                    <Check size={15} aria-hidden /> Done
                  </button>
                  <button className="text-button" disabled={m.busy} onClick={() => setAsk({ id: t.id, kind: 'partial' })}>Partly</button>
                  <button className="text-button" disabled={m.busy} onClick={() => void run(t, { execution: 'deferred' }, 'Deferred')}>Defer</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="home-card__foot">
        {open.length > visible.length
          ? <button type="button" className="text-button" onClick={() => setShowAll(true)}>Show {open.length - visible.length} more</button>
          : <span />}
        <Link href="/app/calendar?view=agenda" className="text-button">Full day &rarr;</Link>
      </footer>

      {m.staleNotice && <p role="status" className="home-card__note">{m.staleNotice}</p>}
      {m.error && <p role="alert" className="home-card__note">{m.error}</p>}
      {m.undo && (
        <p role="status" className="home-card__note">
          {m.undo.message}. <button className="text-button" onClick={() => void m.runUndo()}>Undo</button>
        </p>
      )}
    </section>
  )
}

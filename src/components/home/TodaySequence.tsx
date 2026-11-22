'use client'

import { formatStudyDate } from '../../lib/format/date'
import Link from 'next/link'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { useTaskMutation } from '../calendar/useTaskMutation'
import type { PlanBlock, WorkModel } from '../../lib/state/types'
import { calendarTaskHref } from '../../lib/routing/calendar'
import { remainingPlanTime } from '../../lib/state/homeModel'

type Ask = { id: string; kind: 'complete' | 'partial' } | null
type Row = WorkModel['open'][number]

const KIND: Record<string, string> = {
  study: 'Study', class_consolidation: 'Class follow-up', repair: 'Weak area', recheck: 'Check again',
  review: 'Review', verification: 'Check understanding', diagnostic: 'Paper', mock: 'Mock',
}
const COMPACT_ROWS = 2

const shortDay = (d: string) => formatStudyDate(d, 'short')

/**
 * Today's remaining work: scheduled time or flexible placement, an explicit status, planned duration, and Open / Done / Partly done
 * with the rarer actions in a menu. Every write is a revision-guarded PATCH through the hook Calendar uses, so a stale tab is refused
 * and what the student typed is kept. Only completed counts as done. Order comes from the shared work model, never from this component.
 */
export function TodaySequence({ work, featuredId, today, timezone }: { work: WorkModel; featuredId?: string | null; today: string; timezone: string }) {
  const m = useTaskMutation()
  const [ask, setAsk] = useState<Ask>(null)
  const [minutes, setMinutes] = useState('')
  const [showAll, setShowAll] = useState(false)

  const rows = work.open.filter(t => t.workStatus !== 'unplaced' && t.id !== featuredId)
  const visible = showAll ? rows : rows.slice(0, COMPACT_ROWS)
  const { remainingPlannedMinutes, plannedUsedButOpen } = remainingPlanTime(visible)

  const clock = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone }).format(new Date(iso))
  const when = (t: Row) => t.workStatus === 'overdue' ? `Overdue · ${t.localDate === today ? `was ${t.startsAt ? clock(t.startsAt) : 'earlier today'}` : shortDay(t.localDate!)}`
    : t.workStatus === 'current' ? `Under way · until ${clock(new Date(Date.parse(t.startsAt!) + t.durationMinutes * 60_000).toISOString())}`
    : t.workStatus === 'upcoming' ? `Today ${clock(t.startsAt!)}` : t.workStatus === 'in_progress' ? 'In progress' : 'Flexible today'
  // Planned, reported and remaining are different numbers: unknown time says so, and a used-up allocation says it is still open.
  const status = (t: Row) => {
    if (t.execution === 'in_progress') return 'In progress'
    if (t.execution !== 'partial') return 'Not started'
    const r = t.reportedMinutes, p = t.durationMinutes
    if (r == null) return 'Partly done · time not reported'
    const unk = t.timeUnknown ? ' (some time not reported)' : ''
    return r >= p && p > 0 ? `Partly done · ${r} min reported. Its ${p} min planned allocation is used, and it is still open${unk}` : `Partly done · ${r} of ${p} min reported${unk}`
  }

  async function run(t: PlanBlock, body: Record<string, unknown>, undoMessage: string) {
    return m.call(t.id, { action: 'execution', expectedRevision: t.revision, ...body }, { undoMessage })
  }
  async function submitAsk(t: PlanBlock) {
    const n = Number(minutes)
    if (minutes.trim() && (!Number.isInteger(n) || n < 0 || n > 1440)) { m.setError('Use whole minutes from 0 to 1440, or leave this blank.'); return }
    const actual = minutes.trim() ? { actualDurationMinutes: n } : {}
    // On any refusal the typed minutes stay where they are, so nothing the student entered is lost to a stale revision.
    const saved = await run(t, { execution: ask!.kind === 'partial' ? 'partial' : 'completed', ...actual }, ask!.kind === 'partial' ? 'Saved as partly done' : 'Marked complete')
    if (saved) { setAsk(null); setMinutes('') }
  }

  return (
    <section className="home-card today" aria-labelledby="today-h">
      <header className="home-card__head">
        <h2 id="today-h">Still to do today</h2>
        <span className="today__count"><span className="today__ring" role="img" aria-label={`${work.completedToday.length} of ${work.completedToday.length + work.open.filter(t => t.workStatus !== 'unplaced').length} done today`} style={{ ['--p' as string]: `${Math.round(100 * work.completedToday.length / Math.max(1, work.completedToday.length + work.open.filter(t => t.workStatus !== 'unplaced').length))}%` }}><b>{work.completedToday.length}</b></span> done</span>
      </header>
      <p className="today__summary">
        {visible.length === 0 ? 'Nothing else is planned for today.' : remainingPlannedMinutes > 0 ? `About ${remainingPlannedMinutes} min in the tasks shown` : `${visible.length} open task${visible.length === 1 ? '' : 's'} without remaining planned time`}
        {plannedUsedButOpen > 0 && remainingPlannedMinutes > 0 ? ` · ${plannedUsedButOpen} open with planned time used up` : ''}
        {work.reportedMinutesToday > 0 || work.reportedTodayUnknown > 0 ? ` · ${work.reportedMinutesToday} min reported today${work.reportedTodayUnknown ? ` (+${work.reportedTodayUnknown} report${work.reportedTodayUnknown === 1 ? '' : 's'} without minutes)` : ''}` : ''}
        {work.unplaced > 0 ? ` · ${work.unplaced} not placed yet` : ''}
      </p>

      {rows.length > 0 && (
        <ul className="today__list">
          {visible.map(t => (
            <li key={t.id} className={`today__row is-${t.workStatus}`}>
              <div className="today__main">
                <span className="today__kind">{KIND[t.taskType] ?? 'Task'} · {when(t)}</span>
                <p className="today__title"><Link href={t.destination || calendarTaskHref(t.id, t.localDate ?? today)}>{t.title}</Link></p>
                <p className="today__meta">{status(t)} · {t.durationMinutes ? `${t.durationMinutes} min planned` : 'flexible length'}</p>
              </div>
              {ask?.id === t.id ? (
                <form className="today__ask" onSubmit={e => { e.preventDefault(); void submitAsk(t) }}>
                  <label>
                    <span>New minutes since your last update (optional)</span>
                    <input type="number" min={0} max={1440} step={1} inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} aria-label="Actual minutes" autoFocus />
                  </label>
                  <button type="submit" className="primary-button is-sm" disabled={m.busy}>{ask.kind === 'partial' ? 'Save as partly done' : 'Save'}</button>
                  <button type="button" className="text-button" onClick={() => { setAsk(null); setMinutes('') }}>Cancel</button>
                </form>
              ) : t.assessmentControl ? (
                // A paper or re-check is started, resumed or read as a result. It is never marked done by hand.
                <div className="today__actions">
                  <Link className={t.assessmentControl.kind === 'waiting' || t.assessmentControl.kind === 'unavailable' ? 'text-button' : 'primary-button is-sm'} href={t.assessmentControl.href}>{t.assessmentControl.label}</Link>
                  {t.assessmentControl.note && <span className="fine-print">{t.assessmentControl.note}</span>}
                  <details className="today__more">
                    <summary aria-label={`More actions for ${t.title}`}>More</summary>
                    <button type="button" className="text-button" disabled={m.busy} onClick={() => void run(t, { execution: 'deferred' }, 'Deferred')}>Defer</button>
                  </details>
                </div>
              ) : (
                <div className="today__actions">
                  <Link className="text-button" href={t.destination || calendarTaskHref(t.id, t.localDate ?? today)} aria-label={`Open ${t.title}`}>Open</Link>
                  <button type="button" className="today__done" disabled={m.busy} onClick={() => void run(t, { execution: 'completed' }, 'Marked complete')} aria-label={`Mark ${t.title} done`}>
                    <Check size={15} aria-hidden /> Done
                  </button>
                  <button type="button" className="text-button" disabled={m.busy} onClick={() => setAsk({ id: t.id, kind: 'partial' })} aria-label={`Mark ${t.title} partly done`}>Partly done</button>
                  <details className="today__more">
                    <summary aria-label={`More actions for ${t.title}`}>More</summary>
                    <button type="button" className="text-button" disabled={m.busy} onClick={() => void run(t, { execution: 'deferred' }, 'Deferred')}>Defer</button>
                    <button type="button" className="text-button" disabled={m.busy} onClick={() => void run(t, { execution: 'skipped' }, 'Skipped')}>Skip</button>
                  </details>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(rows.length > visible.length || work.completedToday.length > 0) && (
        <footer className="home-card__foot">
          {rows.length > visible.length ? <button type="button" className="text-button" onClick={() => setShowAll(true)}>Show {rows.length - visible.length} more</button> : <span />}
          <Link href={`/app/calendar?view=agenda&week=${today}`} className="text-button">Full day &rarr;</Link>
        </footer>
      )}

      {work.completedToday.length > 0 && (
        <details className="today__done-list">
          <summary>Completed today ({work.completedToday.length})</summary>
          <ul>{work.completedToday.map(t => <li key={t.id}><Check size={13} aria-hidden /> {t.title} · {t.reportedMinutes != null ? `${t.reportedMinutes} min reported` : <>{t.durationMinutes} min planned <span className="chip-muted">Time not reported</span></>}</li>)}</ul>
        </details>
      )}
      {work.deferred.length > 0 && (
        <div className="home-card__note" role="group" aria-label="Deferred work">
          <p>{work.deferred.length} deferred: set aside, not done. Each can be given another time.</p>
          <ul className="today__done-list">{work.deferred.slice(0, 3).map(t => (
            <li key={t.id}>{t.title} <Link className="text-button" href={`${t.destination || calendarTaskHref(t.id, t.localDate ?? today)}`}>Choose another time</Link></li>
          ))}</ul>
        </div>
      )}

      {m.staleNotice && <p role="status" className="home-card__note">{m.staleNotice} What you typed is still here; check the task, then save again.</p>}
      {m.receipt && <p role="status" className="home-card__note">{m.receipt}</p>}
      {m.error && <p role="alert" className="home-card__note">{m.error}</p>}
      {m.undo && (
        <p role="status" className="home-card__note">
          {m.undo.detail ?? m.undo.message}. <button type="button" className="text-button" onClick={() => void m.runUndo()}>Undo</button>
        </p>
      )}
    </section>
  )
}

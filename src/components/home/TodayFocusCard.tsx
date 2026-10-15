'use client'

import Link from 'next/link'
import { CheckCircle2, Clock3, PlayCircle } from 'lucide-react'
import { useTaskMutation } from '../calendar/useTaskMutation'
import { ProgressRing } from '../ui/ProgressRing'

type FocusTask = {
  id: string
  title: string
  detail: string | null
  durationMinutes: number | null
  revision: number
}

type Milestone = { title: string; startWeek?: number; endWeek?: number } | null

/**
 * Home's hero: the one task worth starting right now, wired for real.
 *
 * The old page had "Start Now" / "Defer" buttons with no onClick at all — the
 * exact "looks interactive, does nothing" pattern the product bars against.
 * This uses the same useTaskMutation hook the Calendar grid uses, so a start
 * or defer here carries the same revision-guarded write and shows up on
 * Calendar immediately.
 */
export function TodayFocusCard({
  dateLabel, readinessPercent, hasRoadmap, focusTask, nextUpTitle, milestone,
}: {
  dateLabel: string
  readinessPercent: number
  hasRoadmap: boolean
  focusTask: FocusTask | null
  nextUpTitle: string | null
  milestone: Milestone
}) {
  const mutation = useTaskMutation()

  async function start() {
    if (!focusTask) return
    await mutation.call(focusTask.id, {
      action: 'execution', execution: 'in_progress', expectedRevision: focusTask.revision,
    }, { undoMessage: 'Marked in progress' })
  }

  async function defer() {
    if (!focusTask) return
    await mutation.call(focusTask.id, {
      action: 'execution', execution: 'deferred', expectedRevision: focusTask.revision,
    }, { undoMessage: 'Deferred' })
  }

  async function complete() {
    if (!focusTask) return
    const minutes = window.prompt('About how long did that actually take, in minutes? (Leave blank to skip)')
    const actualDurationMinutes = minutes && !Number.isNaN(Number(minutes)) ? Number(minutes) : undefined
    await mutation.call(focusTask.id, {
      action: 'execution', execution: 'completed', expectedRevision: focusTask.revision,
      ...(actualDurationMinutes !== undefined ? { actualDurationMinutes } : {}),
    }, { undoMessage: 'Marked complete' })
  }

  return (
    <section className="glass-hero">
      <div className="glass-hero__top">
        <div>
          <p className="glass-hero__eyebrow">Today</p>
          <p className="glass-hero__date">{dateLabel}</p>
        </div>
        {hasRoadmap && <ProgressRing percent={readinessPercent} label="Readiness" size={72} tone="light" />}
      </div>

      <div className="glass-panel">
        <p className="glass-panel__eyebrow">
          {focusTask ? "Today's focus" : milestone ? 'This week draws from' : 'Nothing scheduled today'}
        </p>

        {focusTask ? (
          <>
            <h3>{focusTask.title}</h3>
            {focusTask.detail && <p>{focusTask.detail}</p>}
            <div className="glass-panel__foot">
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="glass-pill-button" onClick={start} disabled={mutation.busy}>
                  <PlayCircle size={18} aria-hidden /> Start now
                </button>
                <button className="glass-pill-button glass-pill-button--ghost" onClick={defer} disabled={mutation.busy}>
                  <Clock3 size={16} aria-hidden /> Defer
                </button>
                <button className="glass-pill-button" onClick={complete} disabled={mutation.busy}>
                  <CheckCircle2 size={18} aria-hidden /> Complete
                </button>
              </div>
              {focusTask.durationMinutes && <span className="glass-hero__meta">{focusTask.durationMinutes} min</span>}
            </div>
          </>
        ) : milestone ? (
          <>
            <h3>{milestone.title}</h3>
            {milestone.startWeek && milestone.endWeek && (
              <p>Weeks {milestone.startWeek}–{milestone.endWeek} of your roadmap</p>
            )}
            <div className="glass-panel__foot">
              <Link href="/app/curriculum" className="glass-pill-button">Open curriculum</Link>
            </div>
          </>
        ) : (
          <p>Nothing is placed for today. Open Calendar, or adjust your availability in Settings.</p>
        )}

        {focusTask && nextUpTitle && (
          <p className="glass-hero__meta" style={{ marginTop: 14, whiteSpace: 'normal' }}>Next up &middot; {nextUpTitle}</p>
        )}
        {mutation.staleNotice && (
          <p className="glass-hero__meta" style={{ marginTop: 10, whiteSpace: 'normal' }} role="status">
            {mutation.staleNotice} Refreshed with the current version.
          </p>
        )}
        {mutation.error && (
          <p className="glass-hero__meta" style={{ marginTop: 10, whiteSpace: 'normal', color: '#ffb4bb' }} role="alert">
            {mutation.error}
          </p>
        )}
        {mutation.undo && (
          <p className="glass-hero__meta" style={{ marginTop: 10, whiteSpace: 'normal' }} role="status">
            <CheckCircle2 size={13} aria-hidden style={{ verticalAlign: -2, marginRight: 4 }} />
            {mutation.undo.message}. <button className="glass-hero__undo" onClick={mutation.runUndo}>Undo</button>
          </p>
        )}
      </div>
    </section>
  )
}

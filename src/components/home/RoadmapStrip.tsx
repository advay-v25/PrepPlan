import Link from 'next/link'
import { PHASE_LABEL, type Roadmap } from '../../lib/curriculum/roadmap'
import type { Progress } from '../../lib/curriculum/roadmapService'

function short(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

/**
 * The whole run to the exam on one line: phases sized by their weeks, a marker for today, the
 * topic the plan is on now and what comes next, and planned-by-now against done — the same
 * roadmap and progress model Curriculum shows (getActiveRoadmap + computeProgress). It states
 * positions and percentages only; it makes no promise about whether the plan is recoverable.
 */
export function RoadmapStrip({ status, roadmap, progress, weekNote }: { status: string; roadmap: Roadmap; progress: Progress; /** Why this week's accepted work differs from the milestone (recorded provenance), or null. */ weekNote?: string | null }) {
  const total = Math.max(1, roadmap.totalWeeks)
  const marker = Math.min(100, Math.max(0, (progress.weeksElapsed / total) * 100))
  const now = progress.currentMilestone
  const next = now
    ? [...roadmap.milestones].sort((a, b) => a.startWeek - b.startWeek).find(m => m.startWeek > now.endWeek && m.topicId !== now.topicId)
    : roadmap.milestones[0] ?? null
  const draft = status === 'draft'

  return (
    <section className="home-card road" aria-labelledby="road-h">
      <header className="home-card__head">
        <h2 id="road-h">Roadmap {draft && <span className="road__draft">Draft</span>}</h2>
        <Link href="/app/curriculum?view=roadmap" className="text-button">{draft ? 'Review it' : 'Full roadmap'} &rarr;</Link>
      </header>

      <div className="road__track" role="img"
        aria-label={`${roadmap.phases.map(p => `${PHASE_LABEL[p.phase]}, ${p.weeks} weeks`).join('; ')}. Week ${progress.weeksElapsed + 1} of ${total}.`}>
        {roadmap.phases.map(p => (
          <span key={p.phase} className={`road__phase road__phase--${p.phase}`} style={{ flexGrow: p.weeks }}>
            <span className="road__phase-name">{PHASE_LABEL[p.phase]}</span>
            <span className="road__phase-weeks">{p.weeks}w</span>
          </span>
        ))}
        <span className={`road__marker ${marker < 6 ? 'is-start' : marker > 94 ? 'is-end' : ''}`} style={{ left: `${marker}%` }} aria-hidden><span>Now</span></span>
      </div>
      <div className="road__ends"><span>{short(roadmap.startDate)}</span><span>{roadmap.targetKind === 'sitting' ? 'Target sitting opens' : 'Exam'} · {short(roadmap.targetDate)}</span></div>

      <div className="road__facts">
        <div className="road__fact">
          <span className="road__label">Week</span>
          <strong>{Math.min(progress.weeksElapsed + 1, total)} <small>of {total}</small></strong>
        </div>
        <div className="road__fact">
          <span className="road__label">Now</span>
          <strong>{now ? now.topicName : '—'}</strong>
          {now && <small>{now.startWeek === now.endWeek ? `Week ${now.startWeek}` : `Weeks ${now.startWeek}–${now.endWeek}`}{next ? ` · then ${next.topicName}` : ''}</small>}
        </div>
        <div className="road__fact road__fact--bars">
          <span className="road__label">First-pass effort estimate</span>
          <span className="road__bar is-done"><span>Covered</span><i><b style={{ width: `${progress.actualPercent}%` }} /></i><em>{progress.actualPercent}%</em></span>
        </div>
      </div>
      {weekNote && <p className="road__note road__note--clamp" data-testid="road-week-note" title={weekNote}>{weekNote}</p>}
      {draft && <p className="road__note">This is a proposed plan, not yet your accepted one — review it in Curriculum.</p>}
    </section>
  )
}

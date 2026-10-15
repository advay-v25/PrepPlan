import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import { getWeeklyReviewState } from '../../../lib/planning/weeklyReview/service'
import { ReviewWeekForm } from '../../../components/review/ReviewWeekForm'

export const dynamic = 'force-dynamic'

/** Weekly closure. A pure read: nothing here closes a week until the student confirms. */
export default async function ReviewWeekPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/review-week')

  const state = await getWeeklyReviewState(user.id)

  if (state.status === 'no_active_cycle') {
    return (
      <div className="page-content">
        <h1>Weekly review</h1>
        <p>There is no open week to review. <Link href="/app/calendar">Open the calendar</Link> to prepare one.</p>
      </div>
    )
  }

  const { gate, recap, carryover, next } = state
  const canClose = gate.kind === 'paper_scored' || gate.kind === 'no_paper_allowed'

  return (
    <div className="page-content review-week">
      <h1>Weekly review</h1>
      <p>Cycle {state.cycle.startsAt} – {state.cycle.endsAt}</p>
      <p><Link href={`/app/coach?q=${encodeURIComponent('Help me make sense of this week and what should carry over.')}`} className="text-button">Talk this week through with the Coach &rarr;</Link></p>

      <section aria-labelledby="recap-h">
        <h2 id="recap-h">This week</h2>
        <ul>
          <li>{recap.planned} tasks planned</li>
          {Object.entries(recap.byExecution).map(([k, n]) => <li key={k}>{n} {k.replace('_', ' ')}</li>)}
          <li>
            {recap.paper.scored
              ? `Weekly paper scored${recap.paper.valid ? `: ${recap.paper.correct ?? 0} of ${recap.paper.valid} correct` : ''}.`
              : recap.paper.present ? 'Weekly paper not yet scored.' : 'No weekly paper this week.'}
          </li>
        </ul>
        <p className="review-gate">
          {gate.kind === 'paper_scored' ? 'The paper is scored — you can close the week.' : gate.reason}
          {gate.kind === 'paper_pending' && <> <Link href="/app/tests">Go to Tests</Link></>}
        </p>
      </section>

      {state.unloggedClassDays.length > 0 && (
        <section aria-labelledby="unlogged-h">
          <h2 id="unlogged-h">Classes you have not logged</h2>
          <p>{state.unloggedClassDays.join(', ')}. What you covered shapes next week&apos;s plan.
            {' '}<Link href="/app/calendar/log-class">Log a class</Link>, or raise anything you already studied with your Coach.</p>
        </section>
      )}

      <section aria-labelledby="carry-h">
        <h2 id="carry-h">Carrying over</h2>
        {carryover.length === 0 ? <p>No open repair work.</p> : (
          <ul>{carryover.map(c => <li key={c.threadId}>Repair: {c.concept} <small>({c.status.replace('_', ' ')})</small></li>)}</ul>
        )}
      </section>

      <section aria-labelledby="next-h">
        <h2 id="next-h">Preview of next week</h2>
        <p>{next.week.startDate} – {next.week.endDate}. Nothing below is scheduled until you confirm.</p>
        {next.paper.kind === 'none'
          ? <p>No weekly paper next week{next.paper.reason ? ` (${next.paper.reason.replace(/_/g, ' ')})` : ''}.</p>
          : <p>Closing paper: {next.paper.title}</p>}
        {next.taskCount === 0 ? <p>The planner has no work to place next week yet.</p> : (
          <ol>
            {next.days.filter(d => d.items.length > 0).map(d => (
              <li key={d.date}><strong>{d.date}</strong>
                <ul>{d.items.map((i, n) => <li key={n}>{i.title} <small>· {i.minutes} min</small></li>)}</ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      <ReviewWeekForm
        cycleId={state.cycle.id}
        fingerprint={next.fingerprint}
        dueTasks={state.dueTasks}
        canClose={canClose && next.taskCount > 0}
        needsNoPaperAck={gate.kind === 'no_paper_allowed'}
        noPaperReason={gate.kind === 'no_paper_allowed' ? gate.reason : null}
      />
    </div>
  )
}

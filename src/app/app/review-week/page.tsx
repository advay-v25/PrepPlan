import type { Ledger } from '../../../lib/tests/scoreLedger'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import { getWeeklyReviewState } from '../../../lib/planning/weeklyReview/service'
import { loadExamStatus } from '../../../lib/exam/status'
import { getCheckpointView, listAppointments, type AppointmentSummary } from '../../../lib/planning/checkpointService'
import { ReviewWeekForm } from '../../../components/review/ReviewWeekForm'
import { listReports } from '../../../lib/mocks/reportService'
import { recoveryRemainder } from '../../../lib/mocks/recovery'
import { createAdminClient } from '../../../lib/supabase/admin'
import { classLogHref } from '../../../lib/routing/calendar'

export const metadata = { title: 'Review your week' }

export const dynamic = 'force-dynamic'

/** Weekly closure. A pure read: nothing here closes a week until the student confirms. */
export default async function ReviewWeekPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/review-week')

  const state = await getWeeklyReviewState(user.id)
  // Work chosen from a mock report that still has no sitting, and what was actually done from it this week (read-only; a failed read is said, never shown as nothing).
  const recovery = await (async () => {
    try {
      const rs = (await listReports(user.id)).filter(r => r.planSelection)
      const out: { id: string; takenOn: string; waiting: number; done: number; partial: number; open: number; needsReview: boolean }[] = []
      for (const r of rs) {
        const left = await recoveryRemainder(user.id, r)
        const { data } = await createAdminClient().from('plan_blocks').select('execution, duration_minutes').eq('user_id', user.id).eq('source_report_id', r.id).is('cancelled_at', null).throwOnError()
        out.push({ id: r.id, takenOn: r.takenOn, needsReview: left.some(x => x.status === 'needs_review'), waiting: left.reduce((n, x) => n + x.minutes - x.allocated, 0), done: (data ?? []).filter(t => t.execution === 'completed').length, partial: (data ?? []).filter(t => t.execution === 'partial').length, open: (data ?? []).filter(t => !['completed', 'partial', 'skipped', 'cancelled'].includes(t.execution as string)).length })
      }
      return { ok: true as const, items: out.filter(x => x.waiting > 0 || x.done + x.partial + x.open > 0) }
    } catch { return { ok: false as const, items: [] } }
  })()

  if (state.status === 'no_active_cycle') {
    return (
      <div className="page-content review-week">
        <Link href="/app" className="log-page__back">&larr; Home</Link>
        <h1>Weekly review</h1>
        <p>There is no open week to review. <Link href="/app/calendar">Open the calendar</Link> to prepare one.</p>
      </div>
    )
  }

  const { gate, recap, carryover } = state
  const exam = await loadExamStatus(user.id).catch(() => null)
  const cp = await getCheckpointView(user.id).catch(() => null)
  const checkpointHref = cp && cp.week.startDate <= state.cycle.endsAt && cp.checkpoint.date >= state.cycle.startsAt ? cp.href : null
  const appts = (await listAppointments(user.id).catch(() => [] as AppointmentSummary[])).filter(a => a.date >= state.cycle.startsAt && a.date <= state.cycle.endsAt && a.status === 'planned')
  const canClose = gate.kind === 'paper_scored' || gate.kind === 'no_paper_allowed' || gate.kind === 'external_mock' || gate.kind === 'rehearsal'

  return (
    <div className="page-content review-week">
      <Link href="/app" className="log-page__back">&larr; Home</Link>
      <h1>Weekly review</h1>
      {exam?.phase === 'sat' && <p className="notice" role="status" data-exam-sat>You told us you sat the exam on {exam.satOn}, so study prompts are paused. This week stays here as history; <Link href="/app/exam">the exam page</Link> has the optional follow-up.</p>}
      <p>Cycle {state.cycle.startsAt} – {state.cycle.endsAt}</p>
      <p><Link href={`/app/coach?q=${encodeURIComponent('Help me make sense of this week and what should carry over.')}`} className="text-button">Talk this week through with the Coach &rarr;</Link></p>

      <section aria-labelledby="recap-h">
        <h2 id="recap-h">This week</h2>
        <ul>
          <li>{recap.planned} {recap.planned === 1 ? 'task' : 'tasks'} planned</li>
          {Object.entries(recap.byExecution).map(([k, n]) => <li key={k}>{n} {k.replace('_', ' ')}</li>)}
          {recap.external.map((x, i) => (
            <li key={i}>External mock ({x.plannedDate}): {x.outcome.replace('_', ' ')}{x.actualDate ? ` on ${x.actualDate}` : ''}{x.reportedResult ? ` · result you noted: ${x.reportedResult} (your own report)` : ''}
              {x.outcome === 'taken' ? (x.countsAsAssessment ? ' · counts as this week’s assessment.' : ' · does not replace this week’s paper.') : ' · does not replace this week’s assessment.'}</li>
          ))}
          <li>
            {recap.paper.scored
              ? paperLine(recap.paper.ledger)
              : recap.paper.present ? 'Weekly paper not yet scored.' : 'No weekly paper this week.'}
          </li>
        </ul>
        {appts.length > 0 && (
          <div data-week-appointments>
            <h3>Mock appointments this week</h3>
            <ul>{appts.map(a => (
              <li key={a.id} data-appointment={a.id}><Link href={a.href}>{a.title}</Link> ({a.date}) — {a.designated ? <strong>this is the one that counts as your assessment</strong> : 'does not count as your assessment'}
                {a.rehearsal && <> · <Link href={a.rehearsal.primary?.href ?? `/app/tests/rehearsal/${a.rehearsal.id}`}>{a.rehearsal.stage === 'complete' ? 'See the combined result' : a.rehearsal.primary?.label ?? 'Open the rehearsal'}</Link></>}</li>
            ))}</ul>
            {appts.length > 1 && !appts.some(a => a.designated) && <p className="fine-print">More than one mock falls in this week and none is chosen. Open one and choose whether it counts, or keep your weekly paper.</p>}
          </div>
        )}
        <p className="review-gate">
          {gate.kind === 'paper_scored' ? 'The paper is scored — you can close the week.' : gate.reason}
          {gate.kind === 'external_mock' && <> <Link href="/app/calendar#checkpoint">Open Calendar</Link></>}
          {gate.kind === 'rehearsal' && <> <Link href={`/app/tests/rehearsal/${gate.rehearsalId}`}>See the combined result</Link></>}
          {gate.kind === 'paper_pending' && <> <Link href="/app/tests">Go to Tests</Link></>}
          {gate.kind !== 'paper_scored' && gate.kind !== 'external_mock' && gate.kind !== 'rehearsal' && (gate.kind === 'mock_pending' || checkpointHref) && <> <Link href={checkpointHref ?? '/app/calendar#checkpoint'}>{gate.kind === 'mock_pending' ? 'Record what happened to your mock' : 'If you took an external mock, record it here'}</Link></>}
        </p>
      </section>

      {!recovery.ok && <p role="status" data-testid="review-recovery-failed">Your mock-report follow-up could not be loaded just now, so it is not shown rather than guessed. <Link href="/app/review-week">Try again</Link></p>}
      {recovery.items.length > 0 && (
        <section aria-labelledby="recovery-review-h" data-testid="review-recovery">
          <h2 id="recovery-review-h">Follow-up from a mock report</h2>
          <ul>{recovery.items.map(r => <li key={r.id}>Report of {r.takenOn}: {r.done} sitting{r.done === 1 ? '' : 's'} done, {r.partial} partly done, {r.open} still open{r.waiting > 0 ? `, ${r.waiting} min you chose still has no sitting` : ''}{r.needsReview ? '; completion still needs your decision' : ''}. <Link href={`/app/calendar/mock-report/${r.id}${r.waiting > 0 || r.needsReview ? '?plan=left' : ''}`} data-testid={r.waiting > 0 || r.needsReview ? 'review-plan-left' : undefined}>{r.waiting > 0 ? 'Plan what is left' : 'Review it'}</Link></li>)}</ul>
          <p className="fine-print">Your own report, not test evidence. Reviewing it proposes sittings only for what is still undone and fits next; nothing is added until you confirm.</p>
        </section>
      )}

      {state.classFollowUp.length > 0 && (
        <section aria-labelledby="owed-h" data-testid="review-owed-class-work">
          <h2 id="owed-h">Class follow-up still to place</h2>
          <ul>{state.classFollowUp.map(o => <li key={`${o.sessionId}:${o.outcomeId}`}>{o.title} · {o.remainingMinutes} of {o.plannedMinutes} min still to place. <Link href={classLogHref({ sessionId: o.sessionId, fromReview: true })}>{o.classLabel ?? 'Saved class'} on {o.classDate}</Link>{o.classOriginalDate && o.classOriginalDate !== o.classDate ? ` (moved from ${o.classOriginalDate})` : ''}.</li>)}</ul>
          <p className="fine-print">The next proposal places what fits and keeps the rest here. Nothing is added to your week until you accept it.</p>
        </section>
      )}

      <section aria-labelledby="carry-h">
        <h2 id="carry-h">Carrying over</h2>
        {carryover.length === 0 ? <p>No open repair work.</p> : (
          <ul>{carryover.map(c => <li key={c.threadId}>Repair: {c.concept} <small>({c.status.replace('_', ' ')})</small></li>)}</ul>
        )}
      </section>

      <ReviewWeekForm
        rotation={state.next.revision}
        adaptation={state.next.adaptation}
        saved={state.saved}
        cycleId={state.cycle.id}
        dueTasks={state.dueTasks}
        classReports={state.classReports}
        canClose={canClose}
        needsNoPaperAck={gate.kind === 'no_paper_allowed'}
        noPaperReason={gate.kind === 'no_paper_allowed' ? gate.reason : null}
      />
    </div>
  )
}

const pct = (n: number | null) => (n === null ? 'not available' : `${Math.round(n * 100)}%`)
/** Paper score first, with its own denominator; answered accuracy is secondary. Legacy papers keep their historical label. */
function paperLine(l: Ledger | null): string {
  if (!l) return 'Weekly paper scored.'
  const setAside = l.voided ? `; ${l.voided} set aside after an upheld challenge, leaving ${l.scoreable} to score` : ''
  if (l.policy === 'paper-score.1') return `Weekly paper scored: ${pct(l.paperScore)} of the paper (${l.correct} of ${l.scoreable} questions correct). ${l.correct + l.incorrect} of ${l.scoreable} answered, ${l.omitted} not answered${setAside}. Answered accuracy ${pct(l.answeredAccuracy)}.`
  return `Weekly paper scored under the earlier answered-questions-only rule: ${pct(l.paperScore)} (${l.correct} of ${l.correct + l.incorrect} answered correct). ${l.delivered} questions were on the paper and ${l.omitted} were not answered${setAside}.`
}

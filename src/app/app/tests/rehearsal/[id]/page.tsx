import { redirect } from 'next/navigation'
import { paperUnavailable, validPaperId } from '../../../../../lib/tests/paperLinks'
import Link from 'next/link'
import { createClient } from '../../../../../lib/supabase/server'
import { getRehearsal, getRehearsalResult } from '../../../../../lib/rehearsal/service'
import { RehearsalHub } from '../../../../../components/tests/RehearsalHub'
import { RepairFollowUp } from '../../../../../components/diagnostic/RepairFollowUp'

export const metadata = { title: 'Mock rehearsal' }

export const dynamic = 'force-dynamic'

const pct = (n: number | null) => (n === null ? '—' : `${n}%`)

/** The rehearsal: where you are, the next action, and — only once BOTH sessions have ended — the combined result and the debrief. */
export default async function RehearsalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!validPaperId(id)) paperUnavailable()
  const state = await getRehearsal(user.id, id)
  if (!state) paperUnavailable()
  const result = await getRehearsalResult(user.id, id)

  return (
    <div className="page-content result-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Rehearsal</p>
          <h1>{state.stage === 'complete' ? 'Your rehearsal result' : 'Full rehearsal'}</h1>
          <p>Two linked sessions from questions held back from every other paper. A combined result appears only when both sessions have finished.</p>
        </div>
        <Link href="/app/tests" className="text-button">&larr; Back to Tests</Link>
      </header>

      {state.status === 'cancelled' && <p className="notice" role="status">This rehearsal was cancelled before it started. Its questions are free again.</p>}
      {state.stage !== 'complete' && <RehearsalHub state={state} />}

      {result && !result.complete && result.completedSessions.length > 0 && (
        <section aria-labelledby="partial-h" style={{ marginTop: 24 }}>
          <h2 id="partial-h">Partly finished</h2>
          <p>Session {result.completedSessions[0].no} is finished: {result.completedSessions[0].correct} of {result.completedSessions[0].valid} answered correctly. There is no combined result until the second session has finished, so no overall percentage is shown.</p>
        </section>
      )}

      {result?.complete && (
        <>
          <section aria-labelledby="combined-h" style={{ marginTop: 24 }}>
            <h2 id="combined-h">Combined result</h2>
            {result.combined.policy === 'mixed'
              ? <p data-combined-mixed><strong>No combined score.</strong> The two sessions were scored under different policies, so they are shown separately below instead of being blended into one percentage. {result.credit.note}</p>
              : <>
                <p><strong>{result.combined.correct} of {result.combined.policy === 'paper-score.1' ? result.combined.scoreable : result.combined.valid}</strong> {result.combined.policy === 'paper-score.1' ? 'questions' : 'answered questions'} correct ({pct(result.combined.accuracy)}). {result.combined.valid} of {result.combined.scoreable} answered ({pct(result.combined.completion)}); {result.combined.omitted} not answered{result.combined.invalidated ? `; ${result.combined.invalidated} set aside after an upheld challenge` : ''}{result.combined.provisional ? `; ${result.combined.provisional} under review and counted for now` : ''}. Answered accuracy: {pct(result.combined.answeredAccuracy)}.</p>
                <p className="muted">{result.combined.policy === 'paper-score.1' ? 'The score counts every question on the two papers; a question you did not answer earns no mark but is not treated as a misconception.' : 'This rehearsal was scored under the earlier policy: answered questions only.'} Confidence and timing are shown separately below, so none of them is hidden inside the percentage. {result.credit.note}</p>
              </>}
            <ul className="rehearsal-compare" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {result.sessions.map(s => (
                <li key={s.no} data-session-result={s.no}>
                  <h3>Session {s.no}</h3>
                  <p>{s.correct} of {s.policy === 'paper-score.1' ? s.scoreable : s.valid} correct ({pct(s.accuracy)}) · {s.omitted} not answered{s.invalidated ? ` · ${s.invalidated} set aside` : ''}</p>
                  <p>Sure and wrong: {s.confidence.confidentMisses}. Confidence: {s.confidence.high} high, {s.confidence.medium} medium, {s.confidence.low} low.</p>
                  <p>{s.activeMinutes} min of active solving{s.timedOut ? '; the clock ran out' : ''}.</p>
                  {s.resultHref && <Link className="text-button" href={s.resultHref}>Session {s.no} in detail</Link>}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="debrief-h" style={{ marginTop: 24 }}>
            <h2 id="debrief-h">Debrief</h2>
            <p><strong>Start here:</strong> {result.debrief.firstAction.title}.</p>
            <p className="muted">{result.debrief.firstAction.why}</p>
            {result.debrief.items.length > 0 && (
              <ol data-debrief-items>{result.debrief.items.map(i => <li key={i.key}><strong>{i.title}</strong> <small>({i.kind === 'gap' ? 'possible gap' : i.kind === 'timing' ? 'timing' : i.kind === 'omitted' ? 'not answered' : 'fragile'}) · {i.support}</small></li>)}</ol>
            )}
            {result.debrief.more > 0 && <p className="muted">{result.debrief.more} smaller pattern{result.debrief.more === 1 ? '' : 's'} are kept in the session results, not planned now, so this stays manageable.</p>}
            <h3>Add the follow-up to your week</h3>
            <p className="muted">At most five repairs are proposed, placed around your commitments and availability. Nothing reaches Calendar until you confirm. Re-checks use ordinary questions, so the held-back rehearsal questions stay protected.</p>
            {result.scoredAttemptIds.length > 0
              ? <RepairFollowUp attemptId={result.scoredAttemptIds[result.scoredAttemptIds.length - 1]} alsoAttemptIds={result.scoredAttemptIds.slice(0, -1)} limit={5} />
              : <p className="muted">No session has answers to follow up.</p>}
          </section>
        </>
      )}
    </div>
  )
}

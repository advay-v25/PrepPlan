import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../../../../lib/supabase/server'
import { getAttemptResult, ResultUnavailable } from '../../../../../lib/tests/resultService'
import { ResultSeen } from '../../../../../components/tests/ResultSeen'
import { ResultView } from '../../../../../components/tests/ResultView'
import { ItemReviewList } from '../../../../../components/diagnostic/ItemReviewList'
import { getAttemptConceptSummaries, ConceptEvidenceUnavailable } from '../../../../../lib/diagnostic/conceptSummary'
import { RepairFollowUp } from '../../../../../components/diagnostic/RepairFollowUp'
import { AdaptiveRunPanel } from '../../../../../components/tests/AdaptiveRunPanel'
import { setOfAttempt } from '../../../../../lib/tests/adaptivePractice'
import { PROFILE_LABEL } from '../../../../../lib/tests/difficultyPolicy'
import { paperUnavailable, validPaperId } from '../../../../../lib/tests/paperLinks'
import { SectionFailed } from '../../../../../components/home/SectionFailed'
import { recordFailure } from '../../../../../lib/ops/routeFailure'

export const metadata = { title: 'Paper result' }

export const dynamic = 'force-dynamic'

/** The result of a scored attempt. A pure read: nothing here writes evidence, repairs or plans. */
export default async function DiagnosticResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params
  if (!validPaperId(attemptId)) paperUnavailable()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: attempt } = await supabase.from('assessment_attempts').select('id, status, rehearsal_id, session_no').eq('id', attemptId).eq('user_id', user.id).maybeSingle().throwOnError()
  if (!attempt) paperUnavailable()
  if (attempt.status === 'ready' || attempt.status === 'in_progress') redirect(`/app/tests/${attemptId}`)
  if (attempt.status !== 'scored') paperUnavailable()

  let result: Awaited<ReturnType<typeof getAttemptResult>>
  try { result = await getAttemptResult(user.id, attemptId) } catch (e) {
    if (!(e instanceof ResultUnavailable)) throw e
    // A failed read is unavailable, never an empty or zero result.
    return <div className="page-content result-page"><SectionFailed what="This result" reference={recordFailure('tests.result', e, 503)} /> <Link className="prose-link" href="/app/tests">Back to Tests</Link></div>
  }
  if (!result) paperUnavailable()

  const adaptiveSet = result.attempt.kind === 'practice' ? await setOfAttempt(user.id, attemptId) : null
  if (adaptiveSet) {
    const o = result.analysis.overall
    return (
      <div className="page-content result-page">
        <header className="page-header">
          <div><p className="eyebrow">Practice set {adaptiveSet.block}</p><h1>Practice set result</h1>
            <p>This was practice. It is not recorded as evidence: it did not change your understanding signal, close a repair or count toward your weekly paper.</p></div>
          <Link href="/app/tests?view=practice" className="text-button">&larr; Back to practice</Link>
        </header>
        <p className="muted">{o.correct} of {o.answered} answered correct · {o.activeMinutes} min of active solving.</p>
        <AdaptiveRunPanel runId={adaptiveSet.runId} attemptId={attemptId} />
      </div>
    )
  }
  if (result.attempt.kind === 'practice') {
    const o = result.analysis.overall
    // Back to the result that suggested the practice: the latest scored paper that counted, not another practice.
    const { data: origin } = await supabase.from('assessment_attempts').select('id').eq('user_id', user.id).eq('status', 'scored').neq('attempt_kind', 'practice').order('submitted_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    return (
      <div className="page-content result-page">
        <header className="page-header">
          <div><p className="eyebrow">Timed practice</p><h1>Practice result</h1>
            <p>This was practice. It is not recorded as evidence: it did not change your understanding signal, close a repair or count toward your weekly paper.</p></div>
          <Link href="/app/tests" className="text-button">&larr; Back to Tests</Link>
        </header>
        <section className="result-hero" aria-labelledby="prac-h">
          <h2 id="prac-h">{o.correct} of {o.answered} correct</h2>
          <p>{o.activeMinutes} min of active solving across {o.answered} question{o.answered === 1 ? '' : 's'}; {result.analysis.patterns.slowCorrect} correct but slow.{result.omitted.length > 0 ? ` ${result.omitted.length} not answered in time.` : ''}</p>
          <p className="muted">Use the time per question to decide what to speed up. If something here felt shaky, a fresh check is what turns it into evidence.</p>
          <p>{origin && <Link className="primary-button" href={`/app/tests/${origin.id}/result#findings-h`}>Back to your result</Link>} <Link className="secondary-button" href="/app/tests">Back to Tests</Link> <Link className="secondary-button" href="/app/calendar">Open Calendar</Link></p>
        </section>
      </div>
    )
  }

  // Difficulty actually delivered, and whether it changed from the previous paper. Never an improvement curve or a pass probability.
  const { data: cov } = await supabase.from('assessment_attempts').select('delivered_coverage, completed_at, attempt_kind').eq('id', attemptId).single()
  const dc = (cov?.delivered_coverage as any)?.difficulty
  let mixNote: string | null = null
  if (dc?.actual) {
    const labels = (dc.readings ?? []).map((r: any) => r.profile as keyof typeof PROFILE_LABEL)
    const { data: prev } = await supabase.from('assessment_attempts').select('delivered_coverage').eq('user_id', user.id).in('attempt_kind', ['weekly', 'reading', 'subject']).in('status', ['scored', 'rescored', 'partially_voided']).lt('completed_at', cov!.completed_at as string).order('completed_at', { ascending: false }).limit(1)
    const pr = ((prev?.[0]?.delivered_coverage as any)?.difficulty?.readings ?? []).map((r: any) => r.profile)
    const changed = pr.length ? (JSON.stringify([...new Set(pr)].sort()) !== JSON.stringify([...new Set(labels)].sort()) ? `The difficulty approach changed from the previous paper (${[...new Set(pr)].map((p: any) => PROFILE_LABEL[p as keyof typeof PROFILE_LABEL]).join(', ')}).` : 'The difficulty approach was the same as the previous paper.') : 'There is no earlier paper with a recorded difficulty approach to compare.'
    mixNote = `Difficulty delivered: ${dc.actual.foundation} foundation, ${dc.actual.standard} standard, ${dc.actual.difficult} difficult${dc.actual.unclassified ? `, ${dc.actual.unclassified} not yet level-reviewed` : ''} (${[...new Set(labels.map((l: any) => PROFILE_LABEL[l as keyof typeof PROFILE_LABEL]))].join(', ')}). ${changed} Scores from papers with different mixes are not a validated improvement curve or a pass probability.`
  }
  const repairCount = result.repairs.length
  let concepts: Awaited<ReturnType<typeof getAttemptConceptSummaries>> | null = null
  try { concepts = await getAttemptConceptSummaries(attemptId) } catch (e) { if (!(e instanceof ConceptEvidenceUnavailable)) throw e }
  const STATE: Record<string, string> = { supported: 'Supported', unstable: 'Unstable', needs_repair: 'Needs repair', insufficient: 'Insufficient evidence' }

  return (
    <div className="page-content result-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Result</p>
          <h1>Your result</h1>
          {result.attempt.submittedAt && <p>Submitted <time dateTime={result.attempt.submittedAt}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(result.attempt.submittedAt))}</time> (UTC)</p>}
          <p>What this paper showed, and what to do next — without claiming more than the questions can support.</p>
        </div>
        <Link href="/app/tests" className="text-button">&larr; Back to Tests</Link>
      </header>

      {attempt.rehearsal_id && (
        <p className="notice" role="note">This is the result of <strong>session {attempt.session_no} of 2</strong> of your rehearsal. <Link href={`/app/tests/rehearsal/${attempt.rehearsal_id}`}>Open the rehearsal</Link> for the other session and the combined result.</p>
      )}
      <ResultSeen attemptId={attemptId} />
      <ResultView r={result} />
      {mixNote && <p className="result-mixnote" role="note">{mixNote}</p>}

      <details className="result-group" id="next-steps" open>
        <summary><h2>Follow-up and closing the week</h2></summary>
        <section aria-labelledby="proposal-h">
          <h3 id="proposal-h">Follow-up</h3>
          <p className="muted">Review what could be repaired and when it would fit. Repairs reach your calendar only when you confirm them.</p>
          <RepairFollowUp attemptId={attempt.id} />
        </section>
        {result.attempt.kind === 'weekly' && (
          <section aria-labelledby="review-h" style={{ marginTop: 16 }}>
            <h3 id="review-h">Close the week</h3>
            <p>Now that your paper is scored, review what happened this week and decide what carries into the next.</p>
            <Link href="/app/review-week" className="primary-button">Review this week</Link>
          </section>
        )}
        <p><Link className="text-button" href={`/app/coach?attempt=${attempt.id}&q=${encodeURIComponent('Help me understand this result and what to do next.')}`}>Talk this result through with the Coach &rarr;</Link></p>
      </details>

      <details className="result-group">
        <summary><h2 id="concept-h">Concept evidence (as of this paper)</h2></summary>
        <p className="muted">The concept-level view of what THIS paper recorded. A concept reads as supported only after repeated valid observations; one or two successes are shown as observations (a wording rule only: the support state, repairs and re-check policy are unchanged). Later papers do not change this; Curriculum shows where things stand now.</p>
        {concepts === null ? <p role="alert" className="muted">Concept evidence could not be loaded just now. That is not the same as none being recorded.</p>
          : concepts.length === 0 ? <p className="muted">No concept evidence was recorded. The questions on this attempt were not mapped to curriculum concepts, or the paper was practice.</p> : (
          <ul>{concepts.map(c => <li key={c.concept_id}><strong>{c.concept_label ?? 'Unknown concept'}</strong> — {c.current_state === 'supported' && c.valid_sample_size < 3 ? 'Observed success, more evidence needed' : STATE[c.current_state as string] ?? c.current_state} · {c.valid_sample_size} valid question{c.valid_sample_size === 1 ? '' : 's'}</li>)}</ul>
        )}
      </details>

      <details className="result-group" open>
        <summary><h2 id="q-all-h">Every question, and why</h2></summary>
        <p className="muted">{result.questions.length} reviewable questions. Filter to what you got wrong, were unsure about, did not answer or flagged.</p>
        {result.invalidated.some(question => question.why === 'voided') && (
          <ul aria-label="Questions set aside after review">
            {result.invalidated.filter(question => question.why === 'voided').map(question => (
              <li key={question.itemId}>Question {question.seq}: your report was upheld and this question was set aside.</li>
            ))}
          </ul>
        )}
        <ItemReviewList rows={result.questions} attemptId={attempt.id} />
      </details>
    </div>
  )
}

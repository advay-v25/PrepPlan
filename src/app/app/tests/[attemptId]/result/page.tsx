import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../../../../lib/supabase/server'
import { getAttemptResult } from '../../../../../lib/tests/resultService'
import { ResultView } from '../../../../../components/tests/ResultView'
import { ItemReviewList } from '../../../../../components/diagnostic/ItemReviewList'
import { getAttemptConceptSummaries } from '../../../../../lib/diagnostic/conceptSummary'
import { RepairProposalUI } from '../../../../../components/diagnostic/RepairProposalUI'

export const dynamic = 'force-dynamic'

/** The result of a scored attempt. A pure read: nothing here writes evidence, repairs or plans. */
export default async function DiagnosticResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: attempt } = await supabase.from('assessment_attempts').select('id, status').eq('id', attemptId).eq('user_id', user.id).maybeSingle()
  if (!attempt) redirect('/app/tests')
  if (attempt.status !== 'scored') redirect(`/app/tests/${attemptId}`)

  const result = await getAttemptResult(user.id, attemptId)
  if (!result) redirect('/app/tests')

  const repairCount = result.repairs.length
  const concepts = await getAttemptConceptSummaries(attemptId)
  const STATE: Record<string, string> = { supported: 'Supported', unstable: 'Unstable', needs_repair: 'Needs repair', insufficient: 'Insufficient evidence' }

  return (
    <div className="page-content result-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Result</p>
          <h1>What this told us</h1>
          <p>What held up, what did not, how sure you were, and what to do about it — without claiming more than the questions can support.</p>
        </div>
        <Link href="/app/tests" className="text-button">&larr; Back to Tests</Link>
      </header>

      <ResultView r={result} />

      {repairCount > 0 && (
        <section aria-labelledby="proposal-h" style={{ marginTop: 24 }}>
          <h2 id="proposal-h">Turn the repairs into a calendar proposal</h2>
          <p className="muted">This asks for a proposal you can review. Nothing is placed on your calendar until you accept it.</p>
          <RepairProposalUI attemptId={attempt.id} needsRepairCount={repairCount} />
        </section>
      )}

      <section style={{ marginTop: 24 }} aria-labelledby="concept-h">
        <h2 id="concept-h">Concept evidence</h2>
        <p className="muted">The concept-level view behind the outcomes above. A concept counts as supported only when tested on an unseen, independently validated question.</p>
        {concepts.length === 0 ? <p className="muted">No concept evidence was recorded. The questions on this attempt were not mapped to curriculum concepts.</p> : (
          <ul>{concepts.map(c => <li key={c.concept_id}><strong>{c.concept_label ?? 'Unknown concept'}</strong> — {STATE[c.current_state as string] ?? c.current_state} · {c.valid_sample_size} valid question{c.valid_sample_size === 1 ? '' : 's'}</li>)}</ul>
        )}
      </section>

      <section style={{ marginTop: 40 }} aria-labelledby="q-all-h">
        <div className="section-heading">
          <h2 id="q-all-h">Every question, and why</h2>
          <span className="text-muted" style={{ fontSize: 12 }}>{result.questions.length} questions</span>
        </div>
        <ItemReviewList rows={result.questions} attemptId={attempt.id} />
      </section>
    </div>
  )
}

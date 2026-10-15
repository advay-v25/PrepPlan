import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { checkIsReviewer } from '../../../../lib/diagnostic/reviewAccess'
import { ItemReviewQueue, QueueItem } from '../../../../components/diagnostic/ItemReviewQueue'

export const dynamic = 'force-dynamic'

/**
 * Tier 2 review (§5.5).
 *
 * Every item here has already passed the verifier. The question this page asks
 * is the pilot's headline metric: of the items the verifier passed, how many
 * does a person also accept? A verifier that passes items you would reject is
 * not fit to gate unreviewed delivery, and its disagreements say what to fix.
 */
export default async function ItemReviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/tests/review')
  const isRev = await checkIsReviewer(user.id)
  if (!isRev) redirect('/app/tests')

  const admin = createAdminClient()

  const { data: pending } = await admin
    .from('assessment_items')
    .select(`
      id, stem, options, key_index, per_option_feedback, item_card, cognition, item_form,
      intended_difficulty, generator_model, verifier_model, verified_at,
      concept:curriculum_concepts ( id, name, topic, scope_notes, excluded_or_superseded, verification_status )
    `)
    .eq('review_status', 'verified')
    .order('verified_at', { ascending: true })
    .limit(50)

  // Verifier gate detail, so a reviewer can see what was already checked rather
  // than re-deriving it.
  const itemIds = (pending ?? []).map(i => i.id as string)
  const { data: validations } = itemIds.length
    ? await admin
        .from('item_validations')
        .select('item_id, reviewer_role, status, detail')
        .in('item_id', itemIds)
    : { data: [] as any[] }

  const gatesByItem = new Map<string, { gate: string; passed: boolean; detail: string }[]>()
  for (const v of validations ?? []) {
    if (v.reviewer_role === 'human_reviewer') continue
    const list = gatesByItem.get(v.item_id as string) ?? []
    const d = (v.detail ?? {}) as any
    list.push({ gate: d.gate ?? v.reviewer_role, passed: v.status === 'PASS', detail: d.detail ?? '' })
    gatesByItem.set(v.item_id as string, list)
  }

  const queue: QueueItem[] = (pending ?? []).map(i => {
    const concept = i.concept as any
    const card = (i.item_card ?? {}) as any
    return {
      id: i.id as string,
      stem: i.stem as string,
      options: (i.options ?? []) as string[],
      keyIndex: i.key_index as number | null,
      perOptionFeedback: (i.per_option_feedback ?? {}) as Record<string, string>,
      solution: card.solution ?? null,
      distractorDiagnoses: card.distractorDiagnoses ?? [],
      cognition: i.cognition as string | null,
      itemForm: i.item_form as string | null,
      difficulty: i.intended_difficulty as string | null,
      conceptName: concept?.name ?? null,
      conceptScope: concept?.scope_notes ?? null,
      conceptExclusions: concept?.excluded_or_superseded ?? null,
      conceptVerified: concept?.verification_status === 'verified',
      generatorModel: i.generator_model as string | null,
      verifierModel: i.verifier_model as string | null,
      gates: gatesByItem.get(i.id as string) ?? [],
    }
  })

  // Agreement so far, from the human_reviewer rows already written.
  const { data: decisions } = await admin
    .from('item_validations')
    .select('status')
    .eq('reviewer_role', 'human_reviewer')

  const approved = (decisions ?? []).filter(d => d.status === 'PASS').length
  const rejected = (decisions ?? []).filter(d => d.status === 'VOID').length
  const decided = approved + rejected
  const agreement = decided > 0 ? Math.round((approved / decided) * 100) : null

  const unverifiedConcepts = queue.filter(q => !q.conceptVerified).length

  return (
    <div className="page-content tests-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trust tier 2</p>
          <h1>Item review</h1>
          <p>
            Everything below already passed the verifier. Approving an item promotes it to gold, which is
            what a readiness-moving assessment is allowed to use. Rejecting one is not a loss — the reason
            you give is the signal that improves the verifier.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Link href="/app/tests/manifest" className="text-button">Manifest scope</Link>
          <Link href="/app/tests" className="text-button">&larr; Diagnostics</Link>
        </div>
      </header>

      <div className="review-stats">
        <div className="review-stat">
          <strong>{queue.length}</strong>
          <span>awaiting review</span>
        </div>
        <div className="review-stat">
          <strong>{approved}</strong>
          <span>promoted to gold</span>
        </div>
        <div className="review-stat">
          <strong>{rejected}</strong>
          <span>rejected</span>
        </div>
        <div className="review-stat review-stat--headline">
          <strong>{agreement === null ? '—' : `${agreement}%`}</strong>
          <span>verifier–human agreement</span>
        </div>
      </div>

      {unverifiedConcepts > 0 && (
        <div className="notice notice--info">
          <AlertTriangle size={16} />
          <span>
            {unverifiedConcepts} item{unverifiedConcepts === 1 ? '' : 's'} below sit on a curriculum concept
            that has not been signed off yet, so they cannot be promoted to gold.{' '}
            <Link href="/app/tests/manifest">Sign off the scope first</Link>.
          </span>
        </div>
      )}

      {queue.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing waiting</h2>
          <p>
            No verifier-passed items are awaiting review. Generate more with{' '}
            <code>npm run pilot</code>.
          </p>
        </div>
      ) : (
        <ItemReviewQueue items={queue} />
      )}
    </div>
  )
}

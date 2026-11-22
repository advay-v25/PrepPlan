import Link from 'next/link'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { requireReviewerPage } from '../../../../lib/diagnostic/reviewAccess'
import { ReviewNav } from '../../../../components/reviewer/ReviewNav'
import { conceptScopeHash } from '../../../../lib/diagnostic/conceptScope'
import { ConceptVerifyList, ConceptRow } from '../../../../components/diagnostic/ConceptVerifyList'

export const metadata = { title: 'Curriculum sign-off' }

export const dynamic = 'force-dynamic'

/**
 * Manifest sign-off (§2.2, §5.1).
 *
 * Everything downstream inherits a manifest error, and no automated gate can
 * catch it, because the manifest is what the gates check against. This page is
 * where a person reads the scope the generator was given and says whether it is
 * right. Nothing is published until they have.
 */
export default async function ManifestPage() {
  await requireReviewerPage('/app/tests/manifest')

  const admin = createAdminClient()

  const { data: concepts } = await admin
    .from('curriculum_concepts')
    .select('id, name, topic, module, lm_id, los, importance, scope_notes, excluded_or_superseded, verification_status, manifest_id')
    .order('lm_id')
    .order('los')

  const { data: itemCounts } = await admin
    .from('assessment_items')
    .select('concept_id, review_status')
    .in('review_status', ['verified', 'reviewed'])

  const pendingByConcept = new Map<string, number>()
  for (const i of itemCounts ?? []) {
    if (i.review_status !== 'verified' || !i.concept_id) continue
    pendingByConcept.set(i.concept_id as string, (pendingByConcept.get(i.concept_id as string) ?? 0) + 1)
  }

  const rows: ConceptRow[] = (concepts ?? []).map(c => ({
    id: c.id as string,
    name: c.name as string,
    topic: c.topic as string,
    module: (c.lm_id ?? c.module) as string,
    los: c.los as string,
    importance: c.importance as string,
    scopeNotes: (c.scope_notes ?? null) as string | null,
    exclusions: (c.excluded_or_superseded ?? null) as string | null,
    verified: c.verification_status === 'verified',
    scopeHash: conceptScopeHash(c as any),
    itemsAwaitingReview: pendingByConcept.get(c.id as string) ?? 0,
  }))

  const verified = rows.filter(r => r.verified).length
  const withScope = rows.filter(r => r.scopeNotes).length
  const blocked = rows.filter(r => !r.verified && r.itemsAwaitingReview > 0)
    .reduce((sum, r) => sum + r.itemsAwaitingReview, 0)

  return (
    <div className="page-content tests-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Curriculum manifest</p>
          <h1>Scope sign-off</h1>
          <p>
            This is what the generator was told a concept covers, and what it was told to stay out of. No
            automated check can catch an error here — every gate downstream measures against this text. Read
            it, then sign it off.
          </p>
        </div>
        <ReviewNav current="manifest" />
      </header>

      <div className="review-stats">
        <div className="review-stat">
          <strong>{rows.length}</strong>
          <span>concepts in the manifest</span>
        </div>
        <div className="review-stat">
          <strong>{withScope}</strong>
          <span>have a scope written</span>
        </div>
        <div className="review-stat">
          <strong>{verified}</strong>
          <span>signed off</span>
        </div>
        <div className={`review-stat ${blocked > 0 ? 'review-stat--headline' : ''}`}>
          <strong>{blocked}</strong>
          <span>items blocked from publication</span>
        </div>
      </div>

      <ConceptVerifyList rows={rows} />
    </div>
  )
}

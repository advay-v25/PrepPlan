import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireReviewerPage } from '../../../../../lib/diagnostic/reviewAccess'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { loadItemWorkspace } from '../../../../../lib/diagnostic/reviewService'
import { itemStateLabel } from '../../../../../lib/diagnostic/itemState'
import { ReviewNav } from '../../../../../components/reviewer/ReviewNav'
import { ItemWorkspace } from '../../../../../components/reviewer/ItemWorkspace'

export const metadata = { title: 'Review a question' }

export const dynamic = 'force-dynamic'

export default async function ItemReviewDetailPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  await requireReviewerPage(`/app/tests/review/${encodeURIComponent(itemId)}`)
  const ws = await loadItemWorkspace(decodeURIComponent(itemId))
  if (!ws) notFound()

  const admin = createAdminClient()
  const [{ data: outcomes }, { data: maps }, { data: concepts }, ack] = await Promise.all([
    admin.from('reading_los').select('id, code, title').eq('reading_id', ws.item.lm_id).order('sequence'),
    admin.from('concept_outcome_map').select('concept_id, outcome_id'),
    admin.from('curriculum_concepts').select('id, verification_status'),
    admin.rpc('item_publish_blockers', { p_item_id: ws.item.id, p_ack: true }).then(r => (r.data ?? []) as string[]),
  ])
  const conceptOf = new Map((maps ?? []).map(m => [m.outcome_id as string, m.concept_id as string]))
  const verified = new Map((concepts ?? []).map(c => [c.id as string, c.verification_status === 'verified']))
  const readingOutcomes = (outcomes ?? []).map(o => ({ id: o.id as string, label: `${o.code}. ${o.title}`, conceptId: conceptOf.get(o.id as string) ?? null, conceptVerified: verified.get(conceptOf.get(o.id as string) ?? '') ?? false }))

  return (
    <div className="page-content tests-page">
      <header className="page-header">
        <div>
          <p className="eyebrow"><Link href="/app/tests/review">← Queue</Link></p>
          <h1>{ws.item.id}</h1>
          <p>Version {ws.item.item_version} · {itemStateLabel(ws.item.review_status)}</p>
        </div>
        <ReviewNav current="item" />
      </header>
      <ItemWorkspace ws={JSON.parse(JSON.stringify(ws))} readingOutcomes={readingOutcomes} blockersIfAcknowledged={ack} />
    </div>
  )
}

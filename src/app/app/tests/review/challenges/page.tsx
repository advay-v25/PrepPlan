import Link from 'next/link'
import { requireReviewerPage } from '../../../../../lib/diagnostic/reviewAccess'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { ReviewNav } from '../../../../../components/reviewer/ReviewNav'
import { ChallengeResolver } from '../../../../../components/reviewer/ChallengeResolver'

export const metadata = { title: 'Question challenges' }

export const dynamic = 'force-dynamic'

/** Student challenges, oldest first. Resolution uses the existing evidence-invalidation command. */
export default async function ChallengesPage() {
  await requireReviewerPage('/app/tests/review/challenges')
  const admin = createAdminClient()
  const { data: rows } = await admin.from('item_challenges').select('id, item_id, status, reason_code, comment, created_at, resolved_at').order('status', { ascending: true }).order('created_at', { ascending: true }).limit(100)
  const ids = [...new Set((rows ?? []).map(r => r.item_id as string))]
  const { data: items } = ids.length ? await admin.from('assessment_items').select('id, stem, review_status').in('id', ids) : { data: [] as any[] }
  const stem = new Map((items ?? []).map(i => [i.id as string, i.stem as string]))
  const pending = (rows ?? []).filter(r => r.status === 'pending')

  return (
    <div className="page-content tests-page">
      <header className="page-header"><div><p className="eyebrow">Reviewer workspace</p><h1>Student challenges</h1>
        <p>{pending.length} waiting. Keeping a question restores the disputed evidence; calling it defective voids that evidence and reconciles the repairs built on it. Nothing is deleted.</p></div><ReviewNav current="challenges" /></header>
      {(rows ?? []).length === 0 ? <p className="notice notice--info">No challenges have been raised.</p> : (
        <div style={{ display: 'grid', gap: 12 }}>
          {(rows ?? []).map(r => (
            <section key={r.id as string} className="rv-panel">
              <p style={{ margin: 0 }}><strong>{r.status === 'pending' ? 'Waiting' : String(r.status).replace('resolved_', 'Resolved: ')}</strong> · {r.reason_code ?? 'other'} · {new Date(r.created_at as string).toLocaleDateString('en-GB')}</p>
              <p style={{ margin: 0 }}>“{r.comment as string}”</p>
              <p className="fine-print">Question: <Link href={`/app/tests/review/${encodeURIComponent(r.item_id as string)}`}>{r.item_id as string}</Link> — {(stem.get(r.item_id as string) ?? '').slice(0, 140)}</p>
              {r.status === 'pending' && <ChallengeResolver id={r.id as string} />}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

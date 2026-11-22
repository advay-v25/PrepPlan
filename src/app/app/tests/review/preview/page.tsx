import Link from 'next/link'
import { requireReviewerPage } from '../../../../../lib/diagnostic/reviewAccess'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { loadPreviewItems } from '../../../../../lib/diagnostic/previewItems'
import { ITEM_STATES, ITEM_STATE_LABEL } from '../../../../../lib/diagnostic/itemState'
import { ReviewNav } from '../../../../../components/reviewer/ReviewNav'
import { DraftPreview } from '../../../../../components/reviewer/DraftPreview'

export const metadata = { title: 'Preview a paper' }

export const dynamic = 'force-dynamic'
type Sp = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined

/** Candidate-paper preview: any selection of draft, checked or reviewed questions, rehearsed with nothing stored. */
export default async function PaperPreviewPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams
  await requireReviewerPage('/app/tests/review/preview')
  const admin = createAdminClient()
  const [{ data: batches }, { data: topics }] = await Promise.all([
    admin.from('item_batches').select('id, label').order('created_at', { ascending: false }).limit(30),
    admin.from('topics').select('id, name').order('id'),
  ])
  const batch = one(sp.batch), topic = one(sp.topic), state = one(sp.state)
  const n = Math.min(90, Math.max(1, Number(one(sp.n) ?? 20) || 20))
  const run = Boolean(batch || topic || state || one(sp.go))
  const items = run ? await loadPreviewItems({ batch, topic, states: state ? [state] : undefined, n }) : []

  return (
    <div className="page-content tests-page">
      <header className="page-header"><div><p className="eyebrow">Reviewer preview</p><h1>Preview a candidate paper</h1>
        <p>Pick a slice of the bank and take it as a student would. Nothing is saved, and the paper is not offered to anyone.</p></div><ReviewNav current="preview" /></header>
      <form method="get" className="rv-filters">
        <input type="hidden" name="go" value="1" />
        <label>Topic<select name="topic" defaultValue={topic ?? ''}><option value="">All topics</option>{(topics ?? []).map(t => <option key={t.id as string} value={t.id as string}>{t.name as string}</option>)}</select></label>
        <label>Batch<select name="batch" defaultValue={batch ?? ''}><option value="">Any source</option>{(batches ?? []).map(b => <option key={b.id as string} value={b.id as string}>{b.label as string}</option>)}</select></label>
        <label>State<select name="state" defaultValue={state ?? ''}><option value="">Draft, checked or reviewed</option>{ITEM_STATES.filter(s => s !== 'deprecated').map(s => <option key={s} value={s}>{ITEM_STATE_LABEL[s]}</option>)}</select></label>
        <label>Questions (max 90)<input name="n" type="number" min={1} max={90} defaultValue={n} style={{ minHeight: 38, border: '1px solid var(--line)', borderRadius: 6, padding: '0 10px' }} /></label>
        <button className="secondary-button" type="submit">Build preview</button>
      </form>
      {run && (items.length
        ? <DraftPreview items={items} title="Candidate paper" backHref="/app/tests/review" />
        : <p className="notice notice--warn">No questions match that selection. <Link href="/app/tests/review/preview">Change it</Link>.</p>)}
    </div>
  )
}

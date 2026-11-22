import { notFound } from 'next/navigation'
import { requireReviewerPage } from '../../../../../../lib/diagnostic/reviewAccess'
import { loadPreviewItems } from '../../../../../../lib/diagnostic/previewItems'
import { ReviewNav } from '../../../../../../components/reviewer/ReviewNav'
import { DraftPreview } from '../../../../../../components/reviewer/DraftPreview'

export const metadata = { title: 'Preview a question' }

export const dynamic = 'force-dynamic'

export default async function ItemPreviewPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  const id = decodeURIComponent(itemId)
  await requireReviewerPage(`/app/tests/review/${encodeURIComponent(id)}/preview`)
  const items = await loadPreviewItems({ ids: [id] })
  if (!items.length) notFound()
  return (
    <div className="page-content tests-page">
      <header className="page-header"><div><p className="eyebrow">Reviewer preview</p><h1>Preview {id}</h1></div><ReviewNav current="item" /></header>
      <DraftPreview items={items} title="Single question" backHref={`/app/tests/review/${encodeURIComponent(id)}`} />
    </div>
  )
}

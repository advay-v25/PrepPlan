import { NextResponse } from 'next/server'
import { reviewerRoute } from '../../../../../../lib/diagnostic/reviewApi'
import { reverifyItem } from '../../../../../../lib/diagnostic/reviewService'

export const maxDuration = 300

/** Re-run the automatic checks on the item's current version. The result is discarded if the item is edited while it runs. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await reviewerRoute()
  if (!auth.ok) return auth.response
  const { id } = await params
  const r = await reverifyItem(id)
  return NextResponse.json({ ...r, error: r.ok ? undefined : r.message }, { status: r.ok ? 200 : r.code === 'NOT_FOUND' ? 404 : 409 })
}

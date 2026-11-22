import { NextResponse } from 'next/server'
import { commandResponse, reviewerRoute } from '../../../../../../lib/diagnostic/reviewApi'

/**
 * A reviewer's decision on one item: approve, reject, return for correction, or retire.
 *
 * The decision is one database command (`decide_item_review`): it checks the reviewer role, the item version the reviewer saw,
 * the curriculum mapping, the automatic check results and the batch's source rights, then records the status change and the
 * named decision together. A repeat of the same decision is a no-op; a different or stale one is refused with its reason.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await reviewerRoute()
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await req.json().catch(() => ({} as any))
  const expectedVersion = Number(body.expectedVersion)
  if (!Number.isInteger(expectedVersion)) return NextResponse.json({ ok: false, error: 'expectedVersion is required' }, { status: 400 })
  const { data, error } = await auth.supabase.rpc('decide_item_review', {
    p_item_id: id, p_expected_version: expectedVersion, p_decision: String(body.decision ?? ''),
    p_note: typeof body.note === 'string' ? body.note.slice(0, 2000) : '', p_ack_disagreement: body.acknowledgeDisagreement === true,
  })
  return commandResponse(data, error)
}

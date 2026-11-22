import { NextResponse } from 'next/server'
import { createAdminClient } from '../../../../../../lib/supabase/admin'
import { commandResponse, reviewerRoute } from '../../../../../../lib/diagnostic/reviewApi'

/**
 * Family and hold-out decisions.
 *  { action: 'group', withItemIds: string[], familyId?: string }  — items that test the same underlying construction
 *  { action: 'confirm', expectedVersion: number, note: string }   — the reviewer states that THIS item is its own construction (confirms its provisional family)
 *  { action: 'holdout', held: boolean, reason?: string }          — hold out the item's family (or just this item while its family is unknown)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await reviewerRoute()
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await req.json().catch(() => ({} as any))
  if (body.action === 'group') {
    const ids = [...new Set([id, ...((Array.isArray(body.withItemIds) ? body.withItemIds : []) as unknown[]).map(String)])]
    const { data, error } = await auth.supabase.rpc('group_items_in_family', { p_item_ids: ids, p_family_id: typeof body.familyId === 'string' ? body.familyId : null, p_note: typeof body.note === 'string' ? body.note : '' })
    return commandResponse(data, error)
  }
  if (body.action === 'confirm') {
    const { data, error } = await auth.supabase.rpc('confirm_item_family', { p_item_id: id, p_expected_version: Number(body.expectedVersion), p_note: typeof body.note === 'string' ? body.note : '' })
    return commandResponse(data, error)
  }
  if (body.action === 'holdout') {
    const { data: item } = await createAdminClient().from('assessment_items').select('family_id').eq('id', id).maybeSingle()
    const { data, error } = await auth.supabase.rpc('set_item_holdout', { p_family_id: item?.family_id ?? null, p_item_id: item?.family_id ? null : id, p_held_out: body.held === true, p_reason: typeof body.reason === 'string' ? body.reason : '' })
    return commandResponse(data, error)
  }
  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}

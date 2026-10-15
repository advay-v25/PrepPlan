import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Confirm which outcomes a Calendar block actually covered. Needed when a block names a
 * reading but not an outcome, or was only partly done — outcomes are never guessed.
 * Body: { blockId, outcomeIds: string[] } (an empty list clears the confirmation). POST only.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.blockId !== 'string' || !Array.isArray(body.outcomeIds) || body.outcomeIds.length > 40 || body.outcomeIds.some((o: unknown) => typeof o !== 'string')) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  const admin = createAdminClient()
  const { data: block } = await admin.from('plan_blocks').select('id, user_id, lm_id, execution, cycle_id, cancelled_at').eq('id', body.blockId).eq('user_id', user.id).maybeSingle()
  const { data: cycle } = await admin.from('planning_cycles').select('id').eq('user_id', user.id).eq('status', 'active').maybeSingle()
  if (!block || block.cancelled_at || !cycle || block.cycle_id !== cycle.id) return NextResponse.json({ ok: false, error: 'That block is not in your open cycle.' }, { status: 404 })
  if (!['completed', 'partial'].includes(block.execution as string)) return NextResponse.json({ ok: false, error: 'Only completed or partly completed blocks can be confirmed.' }, { status: 409 })

  const ids = [...new Set(body.outcomeIds as string[])]
  if (ids.length) {
    const { data: los } = await admin.from('reading_los').select('id, reading_id').in('id', ids)
    if ((los ?? []).length !== ids.length || (los ?? []).some(l => l.reading_id !== block.lm_id)) {
      return NextResponse.json({ ok: false, error: 'Those outcomes are not part of this block’s reading.' }, { status: 400 })
    }
  }
  const requestId = crypto.randomUUID()
  // Replace this block's confirmations through the caller's own session (RLS = ownership).
  const del = await supabase.from('block_scope_confirmations').delete().eq('block_id', body.blockId)
  if (del.error) { console.error(`[tests/scope/confirm ${requestId}]`, del.error.message); return NextResponse.json({ ok: false, error: 'Could not save.', requestId }, { status: 500 }) }
  if (ids.length) {
    const ins = await supabase.from('block_scope_confirmations').insert(ids.map(outcome_id => ({ user_id: user.id, block_id: body.blockId, outcome_id })))
    if (ins.error) { console.error(`[tests/scope/confirm ${requestId}]`, ins.error.message); return NextResponse.json({ ok: false, error: 'Could not save.', requestId }, { status: 500 }) }
  }
  return NextResponse.json({ ok: true, confirmed: ids.length })
}

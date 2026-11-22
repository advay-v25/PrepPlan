import { routeFailure } from '../../../../../../lib/ops/routeFailure'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../../lib/supabase/admin'
import { checkIsReviewer } from '../../../../../../lib/diagnostic/reviewAccess'

/**
 * Authorized reviewer resolution of an item challenge.
 *
 * This restores or voids the disputed evidence, recalculates attempt scores,
 * and reconciles dependent repair threads/proposals atomically via RPC.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id: challengeId } = await params
  const body = await req.json().catch(() => ({} as any))
  const resolution = body.resolution

  if (resolution !== 'resolved_voided' && resolution !== 'resolved_kept') {
    return NextResponse.json({ ok: false, error: 'Invalid resolution status' }, { status: 400 })
  }

  const { data: result, error: rpcErr } = await supabase.rpc('resolve_item_challenge', {
    p_challenge_id: challengeId,
    p_resolution: resolution
  })

  if (rpcErr) {
    if (rpcErr.message.includes('Unauthorized')) {
       return NextResponse.json({ ok: false, error: 'You are not authorized to resolve challenges' }, { status: 403 })
    }
    if (rpcErr.message.includes('Challenge already resolved')) {
       return NextResponse.json({ ok: false, error: 'Challenge already resolved' }, { status: 409 })
    }
    return routeFailure('challenge.resolve', 'Could not confirm the review decision. Reload the challenge and try again.', rpcErr)
  }

  return NextResponse.json(result)
}

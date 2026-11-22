import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'

export const dynamic = 'force-dynamic'

const BANDS = ['repair', 'verify', 'maintain', 'untested']

/**
 * A manual change of an outcome's status. It is display-only: the evidence band,
 * the counts and the planner keep using the evidence, and the page shows the
 * change tagged "manual" beside what the evidence says. Setting one requires
 * the student to acknowledge that warning and give a reason.
 * Body: { action: 'set', outcomeId, band, reason, acknowledged: true } | { action: 'revoke', outcomeId }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user
  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.outcomeId !== 'string' || body.outcomeId.length > 60 || !['set', 'revoke'].includes(body.action)) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  const { data: outcome } = await createAdminClient().from('reading_los').select('id').eq('id', body.outcomeId).maybeSingle()
  if (!outcome) return NextResponse.json({ ok: false, error: 'Unknown outcome.' }, { status: 404 })

  const requestId = crypto.randomUUID()
  if (body.action === 'revoke') {
    const { error } = await supabase.from('evidence_overrides').update({ revoked_at: new Date().toISOString() })
      .eq('outcome_id', body.outcomeId).is('revoked_at', null)
    if (error) { console.error(`[curriculum/overrides ${requestId}]`, error.message); return NextResponse.json({ ok: false, error: 'Could not remove it.', requestId }, { status: 500 }) }
    return NextResponse.json({ ok: true })
  }

  if (!BANDS.includes(body.band) || typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.length > 500) {
    return NextResponse.json({ ok: false, error: 'Choose a status and give a short reason.' }, { status: 400 })
  }
  if (body.acknowledged !== true) {
    return NextResponse.json({ ok: false, code: 'warning_required', error: 'Confirm that you understand this is a manual change and that the evidence still shows what it shows.' }, { status: 409 })
  }
  // One active override per outcome: retire the previous one, then record this one.
  await supabase.from('evidence_overrides').update({ revoked_at: new Date().toISOString() }).eq('outcome_id', body.outcomeId).is('revoked_at', null)
  const { error } = await supabase.from('evidence_overrides').insert({
    user_id: user.id, outcome_id: body.outcomeId, overridden_band: body.band, reason: body.reason.trim(),
  })
  if (error) { console.error(`[curriculum/overrides ${requestId}]`, error.message); return NextResponse.json({ ok: false, error: 'Could not save it.', requestId }, { status: 500 }) }
  return NextResponse.json({ ok: true })
}

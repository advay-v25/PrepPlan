import { isAdmitted } from '../../../../../lib/beta/admission'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { confirmPreview } from '../../../../../lib/onboarding/previewService'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!user.email_confirmed_at || !(await isAdmitted(user.id))) return NextResponse.json({ ok: false, code: 'NOT_ADMITTED', error: 'PrepPlan is a private beta and this account has no valid invitation.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  
  if (!body.draftId || typeof body.expectedRevision !== 'number') {
    return NextResponse.json({ ok: false, error: 'draftId and expectedRevision are required' }, { status: 400 })
  }

  try {
    const accepted = await confirmPreview(user.id, body.draftId, body.expectedRevision)
    return NextResponse.json({ ok: true, cycleId: accepted?.cycle_id ?? null })
  } catch (error: any) {
    console.error('Plan confirmation failed:', error)
    // Acceptance is one transaction, so nothing was committed. Retire the draft
    // (a fresh one is regenerated on recovery) rather than writing a made-up
    // onboarding status — profiles.onboarding_status has no 'activation_failed' value.
    await createAdminClient().from('plan_drafts')
      .update({ status: 'failed' }).eq('id', body.draftId).eq('user_id', user.id).eq('status', 'ready')
    // Raw database text never reaches the student: a stale preview says what to do, anything else is a plain retry.
    const stale = error.code === 'STALE_PREVIEW' || /Stale revision|not ready/i.test(error.message ?? '')
    return NextResponse.json({
      ok: false, code: stale ? 'STALE_PREVIEW' : 'ACCEPT_FAILED',
      error: stale ? 'Your setup changed after this preview was prepared. Rebuild the preview to continue.' : 'We could not start your plan. Your answers are saved. Rebuild the preview and try again.',
      recoverable: true, recoverUrl: '/api/activation/recover',
    }, { status: stale ? 409 : 500 })
  }
}

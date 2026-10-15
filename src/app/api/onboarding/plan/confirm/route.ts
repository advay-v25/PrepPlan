import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { confirmPreview } from '../../../../../lib/onboarding/previewService'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  
  if (!body.draftId || typeof body.expectedRevision !== 'number') {
    return NextResponse.json({ ok: false, error: 'draftId and expectedRevision are required' }, { status: 400 })
  }

  try {
    await confirmPreview(user.id, body.draftId, body.expectedRevision)
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Plan confirmation failed:', error)
    // Acceptance is one transaction, so nothing was committed. Retire the draft
    // (a fresh one is regenerated on recovery) rather than writing a made-up
    // onboarding status — profiles.onboarding_status has no 'activation_failed' value.
    await createAdminClient().from('plan_drafts')
      .update({ status: 'failed' }).eq('id', body.draftId).eq('user_id', user.id).eq('status', 'ready')
    return NextResponse.json({
      ok: false, error: error.message, recoverable: true, recoverUrl: '/api/activation/recover',
    }, { status: 500 })
  }
}

import { isAdmitted } from '../../../../../lib/beta/admission'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { confirmPreview } from '../../../../../lib/onboarding/previewService'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!user.email_confirmed_at || !(await isAdmitted(user.id))) return NextResponse.json({ ok: false, code: 'NOT_ADMITTED', error: 'PrepPlan needs an invitation and this account has none.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  
  if (!body.draftId || typeof body.expectedRevision !== 'number') {
    return NextResponse.json({ ok: false, error: 'draftId and expectedRevision are required' }, { status: 400 })
  }

  try {
    const accepted = await confirmPreview(user.id, body.draftId, body.expectedRevision)
    return NextResponse.json({ ok: true, cycleId: accepted?.cycle_id ?? null })
  } catch (error: any) {
    console.error('Plan confirmation failed:', error)
    const code: string = ['STALE_PREVIEW', 'ALREADY_ACCEPTED', 'ACCEPT_REJECTED'].includes(error.code) ? error.code : 'UNCONFIRMED'
    // The draft is retired only when the database has ruled it unusable (a fresh one is regenerated on recovery). While the outcome is unknown it is
    // left as it is, so the same confirmation can be repeated and answered truthfully.
    if (code === 'STALE_PREVIEW' || code === 'ACCEPT_REJECTED') await createAdminClient().from('plan_drafts')
      .update({ status: 'failed' }).eq('id', body.draftId).eq('user_id', user.id).eq('status', 'ready')
    // Messages for these codes are written for the student; anything else never reaches them as database text.
    return NextResponse.json({
      ok: false, code,
      error: code === 'UNCONFIRMED' ? 'We could not confirm whether your plan was saved. Press Accept again: if it already saved, you will not get a second copy.' : error.message,
      recoverable: true, recoverUrl: '/api/activation/recover', ...(code === 'ALREADY_ACCEPTED' ? { nextUrl: '/app/calendar' } : {}),
    }, { status: code === 'UNCONFIRMED' ? 503 : code === 'ACCEPT_REJECTED' ? 500 : 409 })
  }
}

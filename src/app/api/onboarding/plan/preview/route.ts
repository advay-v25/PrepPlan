import { isAdmitted } from '../../../../../lib/beta/admission'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { getOrCreateReadyDraft } from '../../../../../lib/planning/activation/draftService'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!user.email_confirmed_at || !(await isAdmitted(user.id))) return NextResponse.json({ ok: false, code: 'NOT_ADMITTED', error: 'PrepPlan needs an invitation and this account has none.' }, { status: 403 })

  try {
    // Idempotent: the same setup and week always resolve to the same draft.
    const { draftId, revision, tasks, paper, cycle } = await getOrCreateReadyDraft(user.id)
    return NextResponse.json({
      ok: true,
      // Everything about the week comes from the draft itself: a context computed now could already describe a different one.
      data: { draftId, tasks, revision, paper, cycle: { start: cycle.start, end: cycle.end }, timezone: cycle.timezone, closingDay: cycle.closingDay, classLed: cycle.classLed, initialCycle: cycle.initialCycle, reviewNote: cycle.reviewNote },
    })
  } catch (error: any) {
    // The cause is logged; the student gets a sentence they can act on, never database text.
    console.error('Onboarding preview failed:', error)
    const message = 'We could not prepare your first week just now. Your answers are saved. Rebuild the preview to try again.'
    return NextResponse.json({ ok: false, code: 'PREVIEW_FAILED', error: message, message }, { status: 500 })
  }
}

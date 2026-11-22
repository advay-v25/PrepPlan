import { isAdmitted } from '../../../../../lib/beta/admission'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { getOrCreateReadyDraft } from '../../../../../lib/planning/activation/draftService'
import { getStudyWeekContext } from '../../../../../lib/planning/schedule'
import { initialCycleNote } from '../../../../../lib/planning/pulse/firstCycle'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!user.email_confirmed_at || !(await isAdmitted(user.id))) return NextResponse.json({ ok: false, code: 'NOT_ADMITTED', error: 'PrepPlan is a private beta and this account has no valid invitation.' }, { status: 403 })

  try {
    // Idempotent: the same setup and week always resolve to the same draft.
    const { draftId, revision, tasks, paper } = await getOrCreateReadyDraft(user.id)
    // deriveWeekClosing is this same context's anchor and class flag; asking it separately recomputed the whole context.
    const ctx = await getStudyWeekContext(user.id)
    return NextResponse.json({
      ok: true,
      data: { draftId, tasks, revision, paper, cycle: { start: ctx.week.startDate, end: ctx.week.endDate }, timezone: ctx.timezone, closingDay: ctx.anchorDay, classLed: ctx.classLed, initialCycle: ctx.initialCycle ? { advanced: ctx.initialCycle.advanced, reason: ctx.initialCycle.reason, note: initialCycleNote(ctx.initialCycle) } : null },
    })
  } catch (error: any) {
    // The cause is logged; the student gets a sentence they can act on, never database text.
    console.error('Onboarding preview failed:', error)
    const message = 'We could not prepare your first week just now. Your answers are saved. Rebuild the preview to try again.'
    return NextResponse.json({ ok: false, code: 'PREVIEW_FAILED', error: message, message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { getOrCreateReadyDraft } from '../../../../../lib/planning/activation/draftService'
import { getStudyWeekContext } from '../../../../../lib/planning/schedule'
import { deriveWeekClosing } from '../../../../../lib/onboarding/service'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    // Idempotent: the same setup and week always resolve to the same draft.
    const { draftId, revision, tasks, paper } = await getOrCreateReadyDraft(user.id)
    const [ctx, closing] = await Promise.all([getStudyWeekContext(user.id), deriveWeekClosing(user.id)])
    return NextResponse.json({
      ok: true,
      data: { draftId, tasks, revision, paper, cycle: { start: ctx.week.startDate, end: ctx.week.endDate }, timezone: ctx.timezone, closingDay: closing.closingDay, classLed: closing.hasClasses },
    })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message, message: error.message }, { status: 500 })
  }
}

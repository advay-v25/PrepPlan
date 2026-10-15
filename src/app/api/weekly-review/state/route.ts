import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { getWeeklyReviewState } from '../../../../lib/planning/weeklyReview/service'

export const dynamic = 'force-dynamic'

/** Read-only view of the week's closure state and the next-week preview. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, state: await getWeeklyReviewState(user.id) })
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error(`[weekly-review/state ${requestId}]`, error)
    return NextResponse.json({ ok: false, error: 'Could not load the weekly review.', requestId }, { status: 500 })
  }
}

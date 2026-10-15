import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { getLosTracker } from '../../../../lib/curriculum/losTrackerService'

/** Per-LOS readiness for the signed-in student. Read-only. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, tracker: await getLosTracker(user.id) })
  } catch (error: any) {
    console.error('[curriculum/readiness]', error)
    return NextResponse.json({ ok: false, error: 'Could not load readiness.' }, { status: 500 })
  }
}

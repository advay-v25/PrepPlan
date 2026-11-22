import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { getLosTracker } from '../../../../lib/curriculum/losTrackerService'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'

/** Per-LOS readiness for the signed-in student. Read-only. */
export async function GET() {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  try {
    return NextResponse.json({ ok: true, tracker: await getLosTracker(access.user.id) })
  } catch (error: any) {
    console.error('[curriculum/readiness]', error)
    return NextResponse.json({ ok: false, error: 'Could not load readiness.' }, { status: 500 })
  }
}

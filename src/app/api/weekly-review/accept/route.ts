import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { acceptWeeklyTransition } from '../../../../lib/planning/weeklyReview/service'

export const dynamic = 'force-dynamic'

const STATUS = { stale: 409, unavailable: 409, already_closed: 409, access: 403, not_found: 404, invalid: 400, failed: 503 } as const

/**
 * Explicit confirmation. POST only: no render or prefetch can close a week.
 * Body: { draftId }. The request names a saved review and never carries task rows.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response

  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.draftId !== 'string') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })

  const requestId = crypto.randomUUID()
  try {
    const result = await acceptWeeklyTransition(supabase, body.draftId)
    if (result.ok) return NextResponse.json({ ...result, requestId, nextUrl: '/app/calendar?reviewed=1' })
    return NextResponse.json({ ...result, requestId }, { status: STATUS[result.code] })
  } catch (error) {
    console.error(`[weekly-review/accept ${requestId}]`, error)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Save not confirmed. Check your current week before trying again.', requestId }, { status: 503 })
  }
}

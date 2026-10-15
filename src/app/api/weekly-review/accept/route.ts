import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { acceptWeeklyReview, RESOLUTIONS, type Resolution } from '../../../../lib/planning/weeklyReview/service'

export const dynamic = 'force-dynamic'

/**
 * Explicit confirmation. POST only — no render or prefetch can close a week.
 * Body: { cycleId, resolutions: {taskId: 'completed'|'skipped'|'deferred'|'unknown'},
 *         previewFingerprint, acknowledgeNoPaper? }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as any
  const resolutions = body?.resolutions
  const valid = body && typeof body.cycleId === 'string' && typeof body.previewFingerprint === 'string'
    && resolutions && typeof resolutions === 'object' && !Array.isArray(resolutions)
    && Object.values(resolutions).every(v => RESOLUTIONS.includes(v as Resolution))
  if (!valid) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })

  const requestId = crypto.randomUUID()
  try {
    const result = await acceptWeeklyReview(supabase, user.id, {
      cycleId: body.cycleId, resolutions, previewFingerprint: body.previewFingerprint,
      acknowledgeNoPaper: body.acknowledgeNoPaper === true,
    })
    if (result.ok) return NextResponse.json({ ...result, requestId, nextUrl: '/app/calendar' })
    const status = result.code === 'failed' ? 500 : result.code === 'invalid' ? 400 : 409
    return NextResponse.json({ ...result, requestId }, { status })
  } catch (error) {
    console.error(`[weekly-review/accept ${requestId}]`, error)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Could not close the week. Nothing was changed.', requestId }, { status: 500 })
  }
}

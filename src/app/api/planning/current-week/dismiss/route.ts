import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { currentWeekCommandError } from '../../../../../lib/planning/currentWeek/commandError'

export const dynamic = 'force-dynamic'

/** "Keep this week empty": the open proposal is discarded; nothing in the week changes. */
export async function POST(req: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const body = await req.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || typeof body.draftId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.draftId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 || body.expectedRevision > 2147483647) {
    return NextResponse.json({ ok: false, error: 'draftId and expectedRevision are required' }, { status: 400 })
  }
  if (body.reason !== undefined && body.reason !== 'class_change') return NextResponse.json({ ok: false, code: 'BAD_REQUEST', error: 'Unknown plan reason.' }, { status: 400 })
  const { data, error } = await supabase.rpc(body.reason === 'class_change' ? 'dismiss_class_recovery' : 'dismiss_current_week_plan', {
    p_draft_id: body.draftId, p_expected_revision: body.expectedRevision,
  })
  if (error || !data?.ok) {
    const failure = currentWeekCommandError(error?.message ?? data?.code ?? '')
    return NextResponse.json(failure, { status: failure.status })
  }
  return NextResponse.json(data)
}

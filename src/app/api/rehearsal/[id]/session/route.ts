import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { settleRehearsal, startSession } from '../../../../../lib/rehearsal/service'

export const dynamic = 'force-dynamic'

/**
 * Two commands, both authenticated and idempotent.
 *  - { action: 'settle' }: finalise any session whose SERVER deadline has passed (never earlier; ownership is checked). Page reads never do this.
 * Explicit start of one session's clock. Body: { session: 1 | 2 }. The deadline is set once, by the server; a repeat, a refresh or a
 * concurrent request returns the same attempt and the same deadline. Session 2 only starts after session 1 has ended.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  if (/^[0-9a-f-]{36}$/i.test(id) && body?.action === 'settle') {
    try { await settleRehearsal(supabase, access.user.id, id); return NextResponse.json({ ok: true }) }
    catch (e) { console.error('[rehearsal settle]', e); return NextResponse.json({ ok: false, code: 'failed', message: 'Could not finish the session.' }, { status: 500 }) }
  }
  if (!/^[0-9a-f-]{36}$/i.test(id) || ![1, 2].includes(body?.session)) return NextResponse.json({ ok: false, code: 'bad_request', message: 'Choose session 1 or 2.' }, { status: 400 })
  try {
    // A previous session that ran out of time is finalised before the next one can start.
    await settleRehearsal(supabase, access.user.id, id)
    const { data: a } = await createAdminClient().from('assessment_attempts').select('id').eq('rehearsal_id', id).eq('user_id', access.user.id).eq('session_no', body.session).maybeSingle()
    if (!a) return NextResponse.json({ ok: false, code: 'not_found', message: 'That session could not be found.' }, { status: 404 })
    const r = await startSession(access.user.id, a.id as string)
    return r.ok ? NextResponse.json({ ...r, url: `/app/tests/${r.attemptId}` }) : NextResponse.json(r, { status: r.code === 'failed' ? 500 : 409 })
  } catch (e) { console.error('[rehearsal session]', e); return NextResponse.json({ ok: false, code: 'failed', message: 'Could not start the session.' }, { status: 500 }) }
}

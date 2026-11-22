import { trace } from '../../../../lib/ops/trace'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { startRehearsal } from '../../../../lib/rehearsal/service'
import { rateLimit } from '../../../../lib/auth/securityServer'

export const dynamic = 'force-dynamic'

/**
 * Reserves a full rehearsal: BOTH 90-question forms are pinned in one transaction, or nothing is. No clock starts here.
 * Body: { appointmentId }. The body cannot name questions, a pool or a hold-out setting; those are decided on the server.
 */
export async function POST(request: Request) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.appointmentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.appointmentId)) return NextResponse.json({ ok: false, code: 'bad_request', message: 'Choose the rehearsal appointment.' }, { status: 400 })
  const limited = await rateLimit('paper_start', access.user.id)
  if (limited) return limited
  const requestId = crypto.randomUUID()
  try {
    const r = await startRehearsal(access.user.id, body.appointmentId)
    trace('paper', 'rehearsal_start', { ok: r.ok, code: r.ok ? null : r.code, requestId })
    if (r.ok) return NextResponse.json({ ...r, requestId, url: `/app/tests/rehearsal/${r.rehearsalId}` })
    return NextResponse.json({ ...r, requestId }, { status: r.code === 'failed' ? 500 : 409 })
  } catch (e) { console.error(`[rehearsal/start ${requestId}]`, e); return NextResponse.json({ ok: false, code: 'failed', message: 'Could not start.', requestId }, { status: 500 }) }
}

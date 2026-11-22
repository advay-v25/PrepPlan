import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../../lib/auth/applicationAccess'
import { nextAdaptive } from '../../../../../../lib/tests/adaptivePractice'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

/** Explicitly reserves ONE next set. Body: { expectedRevision, requestKey }. The previous set must be terminal; a retry with the same key returns the same set. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const { id } = await params
  const body = await request.json().catch(() => null) as any
  if (!UUID.test(id) || !Number.isInteger(body?.expectedRevision) || typeof body?.requestKey !== 'string' || body.requestKey.length < 8 || body.requestKey.length > 80)
    return NextResponse.json({ ok: false, code: 'bad_request', message: 'Reload the run and try again.' }, { status: 400 })
  const r = await nextAdaptive(access.user.id, id, body.expectedRevision, body.requestKey)
  return r.ok ? NextResponse.json({ ...r, url: `/app/tests/${r.attemptId}` }) : NextResponse.json(r, { status: r.code === 'failed' ? 500 : r.code === 'not_found' ? 404 : 409 })
}

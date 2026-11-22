import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import { decideRehearsal } from '../../../lib/rehearsal/service'

export const dynamic = 'force-dynamic'

/** The one capability decision for a full rehearsal (Calendar, Tests, Coach and Settings read this). GET ?appointmentId=… Never returns question ids. */
export async function GET(request: Request) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const appointmentId = new URL(request.url).searchParams.get('appointmentId')
  if (appointmentId && !/^[0-9a-f-]{36}$/i.test(appointmentId)) return NextResponse.json({ ok: false, error: 'That appointment reference is not valid.' }, { status: 400 })
  try { return NextResponse.json({ ok: true, decision: (await decideRehearsal(access.user.id, appointmentId)).decision }) }
  catch (e) { console.error('[rehearsal GET]', e); return NextResponse.json({ ok: false, error: 'Could not check the rehearsal.' }, { status: 500 }) }
}

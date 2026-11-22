import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { getRehearsal } from '../../../../lib/rehearsal/service'

export const dynamic = 'force-dynamic'

/** The rehearsal's state with the server clock. READ-ONLY: an elapsed session shows as timed out here; finalising it is the authenticated POST /session { action: 'settle' }. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  try {
    const state = await getRehearsal(access.user.id, id)
    return state ? NextResponse.json({ ok: true, rehearsal: state }) : NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  } catch (e) { console.error('[rehearsal GET id]', e); return NextResponse.json({ ok: false, error: 'Could not load the rehearsal.' }, { status: 500 }) }
}

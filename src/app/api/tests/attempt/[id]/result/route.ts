import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'
import { getAttemptResult } from '../../../../../../lib/tests/resultService'
import { requireApplicationAccess } from '../../../../../../lib/auth/applicationAccess'

export const dynamic = 'force-dynamic'

/** The scored attempt's full analysis (owner only; never available before scoring). Read-only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user
  const { id } = await params
  try {
    const result = await getAttemptResult(user.id, id)
    if (!result) return NextResponse.json({ ok: false, error: 'No scored attempt found.' }, { status: 404 })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error(`[tests/result ${requestId}]`, error)
    return NextResponse.json({ ok: false, error: 'Could not build the result.', requestId }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { getRepairState } from '../../../../lib/repairs/service'

export const dynamic = 'force-dynamic'

/** Read-only: the follow-up state for a result. It never proposes, schedules or changes anything. */
export async function GET(req: Request) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const attemptId = new URL(req.url).searchParams.get('attemptId')
  if (!attemptId) return NextResponse.json({ ok: false, error: 'Missing attemptId' }, { status: 400 })
  const also = (new URL(req.url).searchParams.get('also') ?? '').split(',').filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 2)
  const state = await getRepairState(access.user.id, attemptId, also)
  return NextResponse.json(state, { status: state.ok ? 200 : state.code === 'not_found' ? 404 : state.code === 'failed' ? 500 : 409 })
}

/** Retired. It recomputed a proposal and applied it, so a student could accept something they had not seen. Use /preview then /accept. */
export async function POST() {
  return NextResponse.json({ ok: false, code: 'RETIRED', error: 'Review the follow-up first: POST /api/diagnostic/repair/preview, then /accept.' }, { status: 410 })
}

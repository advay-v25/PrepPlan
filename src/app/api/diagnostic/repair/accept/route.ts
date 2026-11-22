import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { acceptRepairFollowUp } from '../../../../../lib/repairs/service'

export const dynamic = 'force-dynamic'
const STATUS = { stale: 409, unavailable: 409, cycle_changed: 409, already_accepted: 409, access: 403, not_found: 404, invalid: 400, failed: 503 } as const

/** Accepts a saved proposal by id + retry key. Never takes task rows. Body: { proposalId, idempotencyKey } */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.proposalId !== 'string' || typeof body.idempotencyKey !== 'string') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  const requestId = crypto.randomUUID()
  try {
    const r = await acceptRepairFollowUp(supabase, body.proposalId, body.idempotencyKey)
    return NextResponse.json({ ...r, requestId }, { status: r.ok ? 200 : STATUS[r.code] })
  } catch (e) {
    console.error(`[repair/accept ${requestId}]`, e)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Save not confirmed. Check your calendar before saving again.', requestId }, { status: 503 })
  }
}

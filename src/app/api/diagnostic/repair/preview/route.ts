import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { previewRepairFollowUp } from '../../../../../lib/repairs/service'

export const dynamic = 'force-dynamic'

/** Saves a follow-up proposal for the student to review. Changes no task. Body: { attemptId, overrides?, keepForLater? } */
export async function POST(request: Request) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.attemptId !== 'string') return NextResponse.json({ ok: false, error: 'Missing attemptId' }, { status: 400 })
  const overrides = body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)
    ? Object.fromEntries(Object.entries(body.overrides).filter(([, v]) => typeof v === 'string')) as Record<string, string> : undefined
  const keepForLater = Array.isArray(body.keepForLater) ? body.keepForLater.filter((x: unknown) => typeof x === 'string') : undefined
  const requestId = crypto.randomUUID()
  try {
    const also = Array.isArray(body.alsoAttemptIds) ? body.alsoAttemptIds.filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 2) : undefined
    const limit = Number.isInteger(body.limit) && body.limit >= 1 && body.limit <= 10 ? body.limit : undefined
    const r = await previewRepairFollowUp(access.user.id, { attemptId: body.attemptId, overrides, keepForLater, alsoAttemptIds: also, limit })
    return NextResponse.json({ ...r, requestId }, { status: r.ok ? 200 : r.code === 'failed' ? 500 : r.code === 'not_found' ? 404 : 409 })
  } catch (e) {
    console.error(`[repair/preview ${requestId}]`, e)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Could not prepare the follow-up. Nothing was changed.', requestId }, { status: 500 })
  }
}

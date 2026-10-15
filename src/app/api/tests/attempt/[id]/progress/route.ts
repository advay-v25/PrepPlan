import { NextResponse } from 'next/server'
import { withOwnedAttempt } from '../../../../../../lib/tests/attemptAccess'
import { acceptProgress, firstReportWindow } from '../../../../../../lib/tests/attemptTiming'

export const dynamic = 'force-dynamic'

/** Heartbeat: active/interrupted seconds and the flag for one question, so time survives a refresh. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await withOwnedAttempt(id)
  if (!a.ok) return a.response
  const { admin, userId, attempt } = a
  if (!['ready', 'in_progress'].includes(attempt.status)) return NextResponse.json({ ok: false, code: 'closed', error: 'This attempt is closed.' }, { status: 409 })
  const body = await req.json().catch(() => null) as any
  if (!body || typeof body.itemId !== 'string') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  const { data: inForm } = await admin.from('form_items').select('item_id').eq('form_id', attempt.form_id).eq('item_id', body.itemId).maybeSingle()
  if (!inForm) return NextResponse.json({ ok: false, error: 'Item not in this attempt.' }, { status: 400 })

  const now = new Date()
  const { data: prev } = await admin.from('attempt_item_progress').select('active_seconds, interrupted_seconds, last_seen_at, visits, flagged').eq('attempt_id', id).eq('item_id', body.itemId).maybeSingle()
  const wall = prev ? (now.getTime() - new Date(prev.last_seen_at as string).getTime()) / 1000 : firstReportWindow(a.attempt.started_at, now)
  const accepted = acceptProgress({ activeSeconds: (prev?.active_seconds as number) ?? 0, interruptedSeconds: (prev?.interrupted_seconds as number) ?? 0 },
    { activeSeconds: Number(body.activeSeconds), interruptedSeconds: Number(body.interruptedSeconds) }, wall)
  const { error } = await admin.from('attempt_item_progress').upsert({
    attempt_id: id, item_id: body.itemId, user_id: userId, active_seconds: accepted.activeSeconds, interrupted_seconds: accepted.interruptedSeconds,
    visits: ((prev?.visits as number) ?? 0) + (body.visit === true ? 1 : prev ? 0 : 1),
    flagged: typeof body.flagged === 'boolean' ? body.flagged : (prev?.flagged as boolean) ?? false, last_seen_at: now.toISOString(),
  }, { onConflict: 'attempt_id,item_id' })
  if (error) { const requestId = crypto.randomUUID(); console.error(`[tests/progress ${requestId}]`, error.message); return NextResponse.json({ ok: false, error: 'Could not save progress.', requestId }, { status: 500 }) }
  // Keep a flag on an already-answered question in step with its response.
  if (typeof body.flagged === 'boolean') await admin.from('assessment_responses').update({ flagged: body.flagged }).eq('attempt_id', id).eq('item_id', body.itemId)
  return NextResponse.json({ ok: true, activeSeconds: accepted.activeSeconds, interruptedSeconds: accepted.interruptedSeconds })
}

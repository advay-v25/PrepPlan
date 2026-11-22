import { NextResponse } from 'next/server'
import { withOwnedAttempt } from '../../../../../../lib/tests/attemptAccess'

export const dynamic = 'force-dynamic'

/**
 * Pause / resume an UNTIMED attempt. Paused time is recorded and excluded from speed diagnosis.
 * A timed mock has a strict exam-style clock and cannot be paused. Body: { action: 'pause' | 'resume' }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await withOwnedAttempt(id)
  if (!a.ok) return a.response
  const { admin, attempt } = a
  const body = await req.json().catch(() => null) as any
  if (!body || !['pause', 'resume'].includes(body.action)) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  if (!['ready', 'in_progress'].includes(attempt.status)) return NextResponse.json({ ok: false, code: 'closed', error: 'This attempt is closed.' }, { status: 409 })
  if (attempt.deadline_at || attempt.time_limit_minutes) return NextResponse.json({ ok: false, code: 'timed', error: 'A timed session cannot be paused.' }, { status: 409 })

  const now = new Date()
  if (body.action === 'pause') {
    if (attempt.paused_at) return NextResponse.json({ ok: true, paused: true })
    await admin.from('assessment_attempts').update({ paused_at: now.toISOString() }).eq('id', id).is('paused_at', null)
    return NextResponse.json({ ok: true, paused: true })
  }
  if (!attempt.paused_at) return NextResponse.json({ ok: true, paused: false, pausedSeconds: attempt.paused_seconds })
  const add = Math.max(0, Math.round((now.getTime() - new Date(attempt.paused_at).getTime()) / 1000))
  const { data } = await admin.from('assessment_attempts').update({ paused_at: null, paused_seconds: attempt.paused_seconds + add }).eq('id', id).eq('paused_at', attempt.paused_at).select('paused_seconds')
  return NextResponse.json({ ok: true, paused: false, pausedSeconds: data?.[0]?.paused_seconds ?? attempt.paused_seconds })
}

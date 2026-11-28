import { trace } from '../../../../lib/ops/trace'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { startAssessment, type StartKind } from '../../../../lib/tests/startAssessment'
import { startAdaptive } from '../../../../lib/tests/adaptivePractice'
import { startAdaptiveItem } from '../../../../lib/tests/adaptiveItemPractice'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { rateLimit } from '../../../../lib/auth/securityServer'

export const dynamic = 'force-dynamic'
const KINDS: StartKind[] = ['weekly', 'reading', 'subject', 'repair', 'practice']

/**
 * Starts (or resumes) an assessment. POST only — no page render can create a test.
 * Body: { kind, expectedRevision?, paperKind?, readingId?, subjectId?, baseline? }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { user } = access
  const body = await request.json().catch(() => null) as any
  // The single-paper mock is retired: a full mock is two linked sessions reserved together from the appointment (POST /api/rehearsal/start).
  if (body?.kind === 'mock') return NextResponse.json({ ok: false, code: 'retired', message: 'A full mock is now two linked 90-question sessions. Plan a rehearsal and start it from Tests.', url: '/app/tests#mock-h' }, { status: 410 })
  if (!body || !KINDS.includes(body.kind)) return NextResponse.json({ ok: false, error: 'Unknown assessment type.' }, { status: 400 })
  const limited = await rateLimit('paper_start', user.id)
  if (limited) return limited
  const requestId = crypto.randomUUID()
  try {
    if (body.kind === 'practice' && body.mode === 'adaptive_item') {
      if (typeof body.readingId !== 'string' || typeof body.requestKey !== 'string' || body.requestKey.length < 8 || body.requestKey.length > 80) {
        return NextResponse.json({ ok: false, code: 'bad_request', message: 'Choose a reading and retry the start.' }, { status: 400 })
      }
      const a = await startAdaptiveItem(
        user.id,
        { readingId: body.readingId, outcomeIds: Array.isArray(body.outcomeIds) ? body.outcomeIds.filter((x: unknown) => typeof x === 'string').slice(0, 40) : undefined },
        body.requestKey
      )
      trace('paper', 'start', { kind: 'practice', mode: 'adaptive_item', ok: a.ok, code: a.ok ? null : a.code, requestId })
      return a.ok ? NextResponse.json({ ...a, requestId, url: `/app/tests/adaptive/${a.runId}` }) : NextResponse.json({ ...a, requestId }, { status: a.code === 'failed' ? 500 : 409 })
    }
    if (body.kind === 'practice' && body.mode === 'adaptive') {
      if (typeof body.readingId !== 'string' || typeof body.requestKey !== 'string' || body.requestKey.length < 8 || body.requestKey.length > 80) return NextResponse.json({ ok: false, code: 'bad_request', message: 'Choose a reading and retry the start.' }, { status: 400 })
      const a = await startAdaptive(user.id, { readingId: body.readingId, outcomeIds: Array.isArray(body.outcomeIds) ? body.outcomeIds.filter((x: unknown) => typeof x === 'string').slice(0, 40) : undefined, cap: body.cap === 20 ? 20 : 10 }, body.requestKey, typeof body.expectedDecision === 'string' ? body.expectedDecision : undefined)
      trace('paper', 'start', { kind: 'practice', mode: 'adaptive', ok: a.ok, code: a.ok ? null : a.code, requestId })
      return a.ok ? NextResponse.json({ ...a, requestId, url: `/app/tests/${a.attemptId}` }) : NextResponse.json({ ...a, requestId }, { status: a.code === 'failed' ? 500 : 409 })
    }
    const r = await startAssessment(supabase, user.id, {
      kind: body.kind, expectedDecision: typeof body.expectedDecision === 'string' ? body.expectedDecision : undefined, expectedRevision: typeof body.expectedRevision === 'string' ? body.expectedRevision : undefined,
      paperKind: ['diagnostic', 'revisionary', 'mixed'].includes(body.paperKind) ? body.paperKind : undefined,
      part: Number.isInteger(body.part) && body.part > 0 && body.part <= 20 ? body.part : undefined,
      outcomeIds: Array.isArray(body.outcomeIds) ? body.outcomeIds.filter((x: unknown) => typeof x === 'string').slice(0, 40) : undefined,
      readingId: typeof body.readingId === 'string' ? body.readingId : undefined, subjectId: typeof body.subjectId === 'string' ? body.subjectId : undefined,
      baseline: body.baseline === true, checkTaskId: typeof body.checkTaskId === 'string' ? body.checkTaskId : undefined,
    })
    trace('paper', 'start', { kind: body.kind, ok: r.ok, code: r.ok ? null : r.code, requestId })
    if (r.ok) return NextResponse.json({ ...r, requestId, url: `/app/tests/${r.attemptId}` })
    return NextResponse.json({ ...r, preview: undefined, requestId }, { status: r.code === 'failed' ? 500 : r.code === 'bad_request' ? 400 : 409 })
  } catch (error) {
    console.error(`[tests/start ${requestId}]`, error)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Could not start.', requestId }, { status: 500 })
  }
}

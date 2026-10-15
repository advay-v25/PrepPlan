import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { startAssessment, type StartKind } from '../../../../lib/tests/startAssessment'

export const dynamic = 'force-dynamic'
const KINDS: StartKind[] = ['weekly', 'reading', 'subject', 'repair', 'mock']

/**
 * Starts (or resumes) an assessment. POST only — no page render can create a test.
 * Body: { kind, expectedRevision?, paperKind?, readingId?, subjectId?, baseline? }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as any
  if (!body || !KINDS.includes(body.kind)) return NextResponse.json({ ok: false, error: 'Unknown assessment type.' }, { status: 400 })
  const requestId = crypto.randomUUID()
  try {
    const r = await startAssessment(supabase, user.id, {
      kind: body.kind, expectedRevision: typeof body.expectedRevision === 'string' ? body.expectedRevision : undefined,
      paperKind: ['diagnostic', 'revisionary', 'mixed'].includes(body.paperKind) ? body.paperKind : undefined,
      readingId: typeof body.readingId === 'string' ? body.readingId : undefined, subjectId: typeof body.subjectId === 'string' ? body.subjectId : undefined,
      baseline: body.baseline === true,
    })
    if (r.ok) return NextResponse.json({ ...r, requestId, url: `/app/tests/${r.attemptId}` })
    return NextResponse.json({ ...r, requestId }, { status: r.code === 'failed' ? 500 : r.code === 'bad_request' ? 400 : 409 })
  } catch (error) {
    console.error(`[tests/start ${requestId}]`, error)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Could not start.', requestId }, { status: 500 })
  }
}

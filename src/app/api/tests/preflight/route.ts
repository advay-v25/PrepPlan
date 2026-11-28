import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { decideAssessment, type DecisionKind } from '../../../../lib/tests/assessmentDecision'
import { previewAdaptive } from '../../../../lib/tests/adaptivePractice'
import { previewAdaptiveItem } from '../../../../lib/tests/adaptiveItemPractice'
import { rateLimit } from '../../../../lib/auth/securityServer'

export const dynamic = 'force-dynamic'
const KINDS: DecisionKind[] = ['weekly', 'reading', 'subject', 'repair', 'practice']

/**
 * Read-only: can this paper start, how many questions, what stays pending and what to do next. Creates nothing.
 * It is the same decision `/api/tests/start` reserves from. Body: { kind, checkTaskId?, paperKind?, part?, readingId?, subjectId?, baseline?, expectedRevision? }
 */
export async function POST(request: Request) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  if (!body || !KINDS.includes(body.kind)) return NextResponse.json({ ok: false, error: 'Unknown assessment type.' }, { status: 400 })
  if (body.kind === 'repair' && typeof body.checkTaskId !== 'string') return NextResponse.json({ ok: false, error: 'A re-check preflight needs its Calendar task.' }, { status: 400 })
  const limited = await rateLimit('paper_preflight', access.user.id)
  if (limited) return limited
  const str = (v: unknown) => typeof v === 'string' ? v : undefined
  try {
    if (body.kind === 'practice' && body.mode === 'adaptive_item') {
      if (typeof body.readingId !== 'string') return NextResponse.json({ ok: false, error: 'Choose a reading.' }, { status: 400 })
      return NextResponse.json({
        ok: true,
        adaptiveItem: await previewAdaptiveItem(access.user.id, {
          readingId: body.readingId,
          outcomeIds: Array.isArray(body.outcomeIds) ? body.outcomeIds.filter((x: unknown) => typeof x === 'string').slice(0, 40) : undefined,
        }),
      })
    }
    if (body.kind === 'practice' && body.mode === 'adaptive') {
      if (typeof body.readingId !== 'string') return NextResponse.json({ ok: false, error: 'Choose a reading.' }, { status: 400 })
      // Read-only: no run, form, reservation or exposure is written.
      return NextResponse.json({ ok: true, adaptive: await previewAdaptive(access.user.id, { readingId: body.readingId, outcomeIds: Array.isArray(body.outcomeIds) ? body.outcomeIds.filter((x: unknown) => typeof x === 'string').slice(0, 40) : undefined, cap: body.cap === 20 ? 20 : 10 }) })
    }
    const { decision } = await decideAssessment(access.user.id, {
      kind: body.kind, checkTaskId: str(body.checkTaskId), outcomeIds: Array.isArray(body.outcomeIds) ? body.outcomeIds.filter((x: unknown) => typeof x === 'string').slice(0, 40) : undefined, readingId: str(body.readingId), subjectId: str(body.subjectId), baseline: body.baseline === true,
      paperKind: ['diagnostic', 'revisionary', 'mixed'].includes(body.paperKind) ? body.paperKind : undefined,
      part: Number.isInteger(body.part) && body.part > 0 && body.part <= 20 ? body.part : undefined, expectedRevision: str(body.expectedRevision), expectedDecision: str(body.expectedDecision),
    })
    return NextResponse.json({ ok: true, decision })
  } catch (error) {
    console.error('[tests/preflight]', error)
    return NextResponse.json({ ok: false, error: 'Could not check this paper.' }, { status: 500 })
  }
}

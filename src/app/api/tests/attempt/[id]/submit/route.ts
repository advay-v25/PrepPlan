import { NextResponse } from 'next/server'
import { withOwnedAttempt } from '../../../../../../lib/tests/attemptAccess'
import { EVIDENCE_POLICY_VERSION } from '../../../../../../lib/diagnostic/evidencePolicy'

export const dynamic = 'force-dynamic'

/**
 * Idempotent submission. Refuses unanswered questions unless the student explicitly allows them
 * (or the timed session has expired). A repeat submit returns the same scored attempt — it never
 * duplicates evidence or repair. Body: { allowUnanswered?: boolean }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await withOwnedAttempt(id)
  if (!a.ok) return a.response
  const { supabase, admin, attempt } = a
  const body = await req.json().catch(() => ({})) as any

  if (attempt.status === 'scored') return NextResponse.json({ ok: true, alreadyScored: true, resultUrl: `/app/tests/${id}/result` })

  const [{ data: formItems }, { data: responses }] = await Promise.all([
    admin.from('form_items').select('item_id, sequence_number').eq('form_id', attempt.form_id).order('sequence_number'),
    supabase.from('assessment_responses').select('item_id, self_reported_confidence').eq('attempt_id', id),
  ])
  const answered = new Set((responses ?? []).map(r => r.item_id as string))
  const unanswered = (formItems ?? []).filter(f => !answered.has(f.item_id as string)).map(f => f.sequence_number as number)
  const expired = attempt.deadline_at !== null && Date.now() > new Date(attempt.deadline_at).getTime()
  if ((responses ?? []).some(r => r.self_reported_confidence === null)) {
    return NextResponse.json({ ok: false, code: 'confidence_required', error: 'Every answer needs a confidence level.' }, { status: 409 })
  }
  if (unanswered.length > 0 && body?.allowUnanswered !== true && !expired) {
    return NextResponse.json({ ok: false, code: 'unanswered', error: `${unanswered.length} question${unanswered.length === 1 ? ' is' : 's are'} unanswered.`, unanswered }, { status: 409 })
  }
  if (attempt.paused_at) await admin.from('assessment_attempts').update({ paused_at: null, paused_seconds: attempt.paused_seconds + Math.max(0, Math.round((Date.now() - new Date(attempt.paused_at).getTime()) / 1000)) }).eq('id', id)

  const { data: result, error } = await supabase.rpc('finalize_assessment_attempt', { p_attempt_id: id, p_scoring_policy: '1.0', p_evidence_policy: EVIDENCE_POLICY_VERSION })
  if (error) {
    if (/No responses found/.test(error.message)) return NextResponse.json({ ok: false, error: 'Nothing has been answered yet.' }, { status: 400 })
    const requestId = crypto.randomUUID(); console.error(`[tests/submit ${requestId}]`, error.message)
    return NextResponse.json({ ok: false, error: 'Could not score this attempt.', requestId }, { status: 500 })
  }
  await admin.from('assessment_attempts').update({ submitted_at: new Date().toISOString() }).eq('id', id).is('submitted_at', null)
  return NextResponse.json({ ...(result as object), ok: true, resultUrl: `/app/tests/${id}/result` })
}

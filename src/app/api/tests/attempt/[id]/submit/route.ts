import { trace } from '../../../../../../lib/ops/trace'
import { NextResponse } from 'next/server'
import { withOwnedAttempt } from '../../../../../../lib/tests/attemptAccess'
import { settleRehearsal, syncRehearsalStatus } from '../../../../../../lib/rehearsal/service'
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

  // A rehearsal session returns to its hub (break / next session / combined result), never straight to a single result.
  const hub = attempt.rehearsal_id ? `/app/tests/rehearsal/${attempt.rehearsal_id}` : null
  if (attempt.rehearsal_id) {
    if (attempt.deadline_at === null) return NextResponse.json({ ok: false, code: 'not_started', error: 'This session has not been started.' }, { status: 409 })
    // Out of time: the saved answers are scored and the rest are recorded as omitted (settle is idempotent and shared with the hub).
    await settleRehearsal(supabase, a.userId, attempt.rehearsal_id)
    const { data: now } = await admin.from('assessment_attempts').select('status').eq('id', id).maybeSingle()
    if (now && now.status !== 'in_progress' && now.status !== 'ready') return NextResponse.json({ ok: true, alreadyScored: true, resultUrl: hub })
  }
  if (attempt.status === 'scored') return NextResponse.json({ ok: true, alreadyScored: true, resultUrl: hub ?? `/app/tests/${id}/result` })

  const [{ data: formItems, error: formError }, { data: responses, error: responseError }] = await Promise.all([
    admin.from('form_items').select('item_id, sequence_number').eq('form_id', attempt.form_id).order('sequence_number'),
    supabase.from('assessment_responses').select('item_id, self_reported_confidence').eq('attempt_id', id),
  ])
  if (formError || responseError) {
    return NextResponse.json({ ok: false, code: 'review_unavailable', error: 'Could not read the paper or its saved answers. Try submitting again.' }, { status: 503 })
  }
  const answered = new Set((responses ?? []).map(r => r.item_id as string))
  const unanswered = (formItems ?? []).filter(f => !answered.has(f.item_id as string)).map(f => f.sequence_number as number)
  const expired = attempt.deadline_at !== null && Date.now() > new Date(attempt.deadline_at).getTime()
  // Out of time, saved work is finalised whatever is missing: the confidence gate cannot trap an expired paper.
  if (!expired && (responses ?? []).some(r => r.self_reported_confidence === null)) {
    return NextResponse.json({ ok: false, code: 'confidence_required', error: 'Every answer needs a confidence level.' }, { status: 409 })
  }
  if (unanswered.length > 0 && body?.allowUnanswered !== true && !expired) {
    return NextResponse.json({ ok: false, code: 'unanswered', error: `${unanswered.length} question${unanswered.length === 1 ? ' is' : 's are'} unanswered.`, unanswered }, { status: 409 })
  }
  if (attempt.paused_at) await admin.from('assessment_attempts').update({ paused_at: null, paused_seconds: attempt.paused_seconds + Math.max(0, Math.round((Date.now() - new Date(attempt.paused_at).getTime()) / 1000)) }).eq('id', id)

  trace('paper', 'submit', { attemptId: id, rehearsal: Boolean(attempt.rehearsal_id) })
  const { data: result, error } = await supabase.rpc('finalize_assessment_attempt', { p_attempt_id: id, p_scoring_policy: '1.0', p_evidence_policy: EVIDENCE_POLICY_VERSION })
  if (error) {
    if (/No responses found/.test(error.message)) return NextResponse.json({ ok: false, error: 'Nothing has been answered yet.' }, { status: 400 })
    const requestId = crypto.randomUUID(); console.error(`[tests/submit ${requestId}]`, error.message)
    return NextResponse.json({ ok: false, error: 'Could not score this attempt.', requestId }, { status: 500 })
  }
  await admin.from('assessment_attempts').update({ submitted_at: new Date().toISOString() }).eq('id', id).is('submitted_at', null)
  if (attempt.rehearsal_id) await syncRehearsalStatus(a.userId, attempt.rehearsal_id)
  return NextResponse.json({ ...(result as object), ok: true, resultUrl: hub ?? `/app/tests/${id}/result` })
}

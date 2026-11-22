import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import { loadExamStatus } from '../../../lib/exam/status'
import { addDays } from '../../../lib/planning/studyWeek'
import { prepareRetake } from '../../../lib/exam/retake'

export const dynamic = 'force-dynamic'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const real = (d: string) => { const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d }
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const refusal: Record<string, string> = {
  NOT_SAT: 'Tell us you sat the exam first.',
  NO_RETAKE_REQUEST: 'Ask for a retake first.',
  NO_NEW_SITTING: 'Choose a new exam date after the one you sat.',
  DRAFT_UNAVAILABLE: 'This preparation preview is unavailable. Prepare a new one.',
  STALE_RETAKE: 'The exam date or your study plan changed. Prepare a new preview before starting.',
  STALE_EXAM: 'Your exam status changed in another tab. Refresh and review it before saving.',
}

function rejected(code: string, status = 409) {
  return NextResponse.json({ ok: false, code, error: refusal[code] ?? 'Could not save the change. Try again.' }, { status })
}

export async function GET() {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  return NextResponse.json({ ok: true, status: await loadExamStatus(access.user.id) })
}

/**
 * The student's own statement about the exam. One command, server-validated, replay-safe (the same request twice has the same effect).
 *   { action: 'sat', satOn }            "I sat the exam" — pauses study prompts, keeps all history
 *   { action: 'undo' }                  "I did not sit it after all" — study prompts resume
 *   { action: 'preview_retake' }      one owned preparation draft for the saved new date
 *   { action: 'activate_retake' | 'cancel_retake', draftId, revision }  apply or dismiss the reviewed draft
 *   { action: 'follow_up', result?, psm?, retakeNote? }  optional: a result you were given (your words), PSM status, a retake request
 * Nothing here is inferred from a date, a window or an internal score; an internal score is never described as a pass or fail.
 */
export async function POST(request: Request) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  const uid = access.user.id
  const status = await loadExamStatus(uid).catch(() => null)
  if (!status) return NextResponse.json({ ok: false, code: 'UNAVAILABLE', error: 'Your exam status could not be read. Nothing was changed; try again.' }, { status: 503 })
  const action = body?.action
  if (action === 'preview_retake') {
    try {
      const prepared = await prepareRetake(uid, status)
      return prepared.ok ? NextResponse.json(prepared) : rejected(prepared.code)
    } catch (error) {
      console.error('[exam retake preview]', error)
      return NextResponse.json({ ok: false, code: 'UNAVAILABLE', error: 'Could not prepare this study plan. Try again.' }, { status: 503 })
    }
  }
  if (body?.version !== undefined && (!Number.isSafeInteger(body.version) || body.version < 1)) {
    return rejected('INVALID_VERSION', 400)
  }
  let command = 'record_exam_status_checked'
  let args: Record<string, unknown> = { p_user: uid, p_action: action, p_version: body?.version ?? status.version }
  if (action === 'sat') {
    const satOn = typeof body.satOn === 'string' ? body.satOn : status.today
    if (!DATE.test(satOn) || !real(satOn) || satOn > status.today || satOn < addDays(status.today, -400)) return NextResponse.json({ ok: false, code: 'INVALID_DATE', error: 'Choose the day you sat the exam. It cannot be in the future.' }, { status: 400 })
    Object.assign(args, { p_sat_on: satOn, p_today: status.today })
  } else if (action === 'follow_up') {
    const result = typeof body.result === 'string' ? body.result.trim().slice(0, 80) : null
    const note = typeof body.retakeNote === 'string' ? body.retakeNote.trim().slice(0, 500) : null
    if (body.psm != null && !['done', 'not_done', 'unsure'].includes(body.psm)) return NextResponse.json({ ok: false, code: 'INVALID_PSM', error: 'Choose done, not done or unsure.' }, { status: 400 })
    Object.assign(args, { p_result: result || null, p_psm: body.psm ?? null, p_retake_note: body.retake === true ? (note ?? '') : null })
  } else if (action === 'activate_retake' || action === 'cancel_retake') {
    if (typeof body.draftId !== 'string' || !UUID.test(body.draftId) || !Number.isSafeInteger(body.revision) || body.revision < 1) {
      return rejected('DRAFT_UNAVAILABLE', 400)
    }
    command = 'review_exam_retake'
    args = { p_user: uid, p_draft: body.draftId, p_revision: body.revision, p_action: action === 'activate_retake' ? 'accept' : 'cancel' }
  } else if (action !== 'undo') return NextResponse.json({ ok: false, code: 'UNKNOWN_ACTION', error: 'Unknown action.' }, { status: 400 })
  const result = await createAdminClient().rpc(command, args).then(value => value, () => null)
  // An error carrying a SQLSTATE was answered by the database (rolled back). Anything else may have come after the commit: say so, never "nothing was changed".
  if (!result || (result.error && !/^[0-9A-Z]{5}$/.test(result.error.code ?? ''))) return NextResponse.json({ ok: false, code: 'OUTCOME_UNKNOWN', error: 'We could not confirm whether that was saved. Check this page, then try again.' }, { status: 502 })
  const { data, error } = result
  if (error || !(data as any)?.ok) {
    if (error) console.error('[exam]', error.message)
    return rejected((data as any)?.code ?? 'FAILED', error ? 500 : 409)
  }
  // The write is committed. A failed re-read must not turn it into a failure.
  const fresh = await loadExamStatus(uid).catch(() => null)
  return NextResponse.json({ ok: true, committed: true, status: fresh, statusUnavailable: fresh === null, alreadyActive: (data as any).already_active === true, receipt: action === 'activate_retake' ? data : undefined })
}

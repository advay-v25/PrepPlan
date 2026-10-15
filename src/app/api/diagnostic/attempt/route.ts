import { clampQuestions } from '../../../../lib/tests/limits'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import {
  AssemblyError,
  AssessmentPurpose,
  BlueprintInput,
  PURPOSE_LENGTHS,
  createBlueprintAndForm,
} from '../../../../lib/diagnostic/blueprint'
import { checkDiagnosticSufficiency } from '../../../../lib/diagnostic/sufficiency'
import { isPersistedPaperScope, recheckPersistedPaper } from '../../../../lib/planning/pulse/paper'
import { createAdminClient } from '../../../../lib/supabase/admin'

/**
 * Starts a diagnostic: builds a blueprint, assembles a form, opens an attempt.
 *
 * Accepts both a JSON body and a plain HTML form post. The form path returns a
 * redirect so the tests page works without client-side JavaScript, and starting
 * an attempt stays a POST — the previous version did this on GET, which meant a
 * link prefetch could silently create attempts.
 */

const VALID_PURPOSES: AssessmentPurpose[] = ['weekly_cumulative', 'module_diagnostic', 'repair_recheck', 'concept_check']

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const contentType = req.headers.get('content-type') ?? ''
  const isFormPost = contentType.includes('form')

  const fail = (message: string, status: number) =>
    isFormPost
      ? NextResponse.redirect(new URL(`/app/tests?error=${encodeURIComponent(message)}`, req.url), 303)
      : NextResponse.json({ ok: false, error: message }, { status })

  if (!user) {
    return isFormPost
      ? NextResponse.redirect(new URL('/login?next=/app/tests', req.url), 303)
      : NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let purpose: string | undefined
  let manifestId: string | undefined
  let modules: string[] | undefined
  let maxQuestions: number | undefined
  let paperTaskId: string | undefined

  if (isFormPost) {
    const form = await req.formData()
    purpose = String(form.get('purpose') ?? '')
    manifestId = String(form.get('manifestId') ?? '')
    const moduleValue = form.get('module')
    if (moduleValue && String(moduleValue) !== 'all') modules = [String(moduleValue)]
    const length = form.get('length')
    if (length) maxQuestions = Number(length)
  } else {
    const body = await req.json().catch(() => ({} as any))
    purpose = body.purpose
    manifestId = body.manifestId
    modules = body.requestedScope?.modules
    maxQuestions = body.constraints?.maxQuestions
    paperTaskId = typeof body.paperTaskId === 'string' ? body.paperTaskId : undefined
  }

  // A weekly paper is reserved from its scheduled task, not from a free-form
  // scope: the persisted scope is re-checked against the bank right now, and
  // the attempt is linked to the task so the reservation is idempotent.
  if (paperTaskId) return reservePaper(supabase, user.id, paperTaskId, fail)

  if (!manifestId) return fail('No curriculum was selected.', 400)
  if (!purpose || !VALID_PURPOSES.includes(purpose as AssessmentPurpose)) {
    return fail(`Unknown assessment purpose: ${purpose}`, 400)
  }

  const typedPurpose = purpose as AssessmentPurpose
  const requestedLength = Number.isFinite(maxQuestions) && (maxQuestions as number) > 0
    ? clampQuestions(maxQuestions as number)
    : PURPOSE_LENGTHS[typedPurpose]

  const input: BlueprintInput = {
    manifestId,
    purpose: typedPurpose,
    requestedScope: modules?.length ? { modules } : {},
    constraints: { maxQuestions: requestedLength },
  }

  const sufficiency = await checkDiagnosticSufficiency(user.id, manifestId, typedPurpose, modules)
  if (!sufficiency.isSufficient) {
    return fail(`Cannot deliver diagnostic: ${sufficiency.reason} Have ${sufficiency.availableCount}, need ${sufficiency.requiredCount}.`, 400)
  }

  let formId: string
  let itemCount: number
  try {
    const result = await createBlueprintAndForm(user.id, input)
    formId = result.formId
    itemCount = result.itemCount
  } catch (error: any) {
    const message = error instanceof AssemblyError ? error.message : 'Could not assemble this diagnostic.'
    if (!(error instanceof AssemblyError)) console.error('Blueprint assembly failed:', error)
    return fail(message, 400)
  }

  const { data: attempt, error: attemptErr } = await supabase
    .from('assessment_attempts')
    .insert({ user_id: user.id, form_id: formId, delivery_mode: 'fixed', status: 'ready' })
    .select('id')
    .single()

  if (attemptErr || !attempt) {
    console.error('Attempt creation failed:', attemptErr)
    return fail('Could not start the attempt.', 500)
  }

  return isFormPost
    ? NextResponse.redirect(new URL(`/app/tests/${attempt.id}`, req.url), 303)
    : NextResponse.json({ ok: true, attemptId: attempt.id, itemCount })
}


/**
 * Reserve the attempt for a scheduled weekly paper (plan_blocks row with a
 * persisted paper scope). Re-checks sufficiency at reservation time and is
 * idempotent: the task's attempt_id is claimed exactly once.
 */
async function reservePaper(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  taskId: string,
  fail: (message: string, status: number) => NextResponse,
) {
  const admin = createAdminClient()
  const { data: block } = await admin.from('plan_blocks')
    .select('id, task_type, assessment_scope, attempt_id')
    .eq('id', taskId).eq('user_id', userId).maybeSingle()
  if (!block || block.task_type !== 'diagnostic' || !isPersistedPaperScope(block.assessment_scope)) {
    return fail('That task is not a weekly paper.', 400)
  }
  const scope = block.assessment_scope

  if (block.attempt_id) {
    const { data: existing } = await admin.from('assessment_attempts')
      .select('id, status').eq('id', block.attempt_id).eq('user_id', userId).maybeSingle()
    if (existing && ['ready', 'in_progress'].includes(existing.status as string)) {
      return NextResponse.json({ ok: true, attemptId: existing.id, reused: true })
    }
    return fail('This paper has already been taken.', 409)
  }

  const check = await recheckPersistedPaper(userId, scope)
  if (!check.ok) return fail(check.reason, 400)

  let formId: string
  let itemCount: number
  try {
    const result = await createBlueprintAndForm(userId, {
      manifestId: scope.manifestId,
      // Papers move demonstrated understanding, so they use the readiness-moving
      // (reviewed-only) tier policy — the same one the scope was checked under.
      purpose: 'weekly_cumulative',
      requestedScope: { modules: check.moduleIds },
      constraints: { maxQuestions: check.targetItems },
    })
    formId = result.formId
    itemCount = result.itemCount
  } catch (error: any) {
    if (!(error instanceof AssemblyError)) console.error('Paper assembly failed:', error)
    return fail(error instanceof AssemblyError ? error.message : 'Could not assemble this paper.', 400)
  }

  const { data: attempt, error: attemptErr } = await supabase
    .from('assessment_attempts')
    .insert({ user_id: userId, form_id: formId, delivery_mode: 'fixed', status: 'ready' })
    .select('id').single()
  if (attemptErr || !attempt) {
    console.error('Paper attempt creation failed:', attemptErr)
    return fail('Could not start the attempt.', 500)
  }

  // Claim the task for this attempt. A concurrent reservation loses here and
  // its attempt is discarded, so one task never holds two attempts.
  const { data: claimed } = await admin.from('plan_blocks')
    .update({ attempt_id: attempt.id }).eq('id', taskId).eq('user_id', userId).is('attempt_id', null).select('id')
  if (!claimed || claimed.length === 0) {
    await admin.from('assessment_attempts').delete().eq('id', attempt.id).eq('user_id', userId)
    const { data: winner } = await admin.from('plan_blocks').select('attempt_id').eq('id', taskId).maybeSingle()
    return winner?.attempt_id
      ? NextResponse.json({ ok: true, attemptId: winner.attempt_id, reused: true })
      : fail('Could not reserve this paper.', 409)
  }

  return NextResponse.json({ ok: true, attemptId: attempt.id, itemCount, reused: false })
}

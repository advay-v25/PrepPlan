import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { taskScopeCommand } from '../../../../../lib/planning/taskScopeCommands'
import { ExecutionCommandError, RevisionMismatchError } from '../../../../../lib/planning/executionCommand'
import { readAll } from '../../../../../lib/supabase/readAll'
import { getScopeGroups } from '../../../../../lib/planning/taskScopeService'

export const dynamic = 'force-dynamic'

/** Owned Calendar task -> exact reading/LOS choices. Reading completion is never guessed. */
export async function GET(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const id = new URL(request.url).searchParams.get('blockId')
  if (!id || id.length > 180) return NextResponse.json({ ok: false, error: 'Choose a study task.' }, { status: 400 })
  try {
    const { data: task } = await supabase.from('plan_blocks').select('id,lm_id,outcome_id,execution,cycle_id,revision,cancelled_at,scope_group_id').eq('id', id).eq('user_id', access.user.id).maybeSingle().throwOnError()
    if (!task) return NextResponse.json({ ok: false, error: 'Task not found.' }, { status: 404 })
    if (task.cancelled_at || !['completed', 'partial'].includes(task.execution)) return NextResponse.json({ ok: false, error: 'Record your study progress before confirming coverage.' }, { status: 409 })
    const { data: cycle } = await supabase.from('planning_cycles').select('id').eq('id', task.cycle_id).eq('user_id', access.user.id).eq('status', 'active').maybeSingle().throwOnError()
    if (!cycle) return NextResponse.json({ ok: false, error: 'This record belongs to an earlier week.' }, { status: 409 })
    let readingId = task.lm_id
    if (task.outcome_id) {
      const { data: outcome } = await supabase.from('reading_los').select('reading_id').eq('id', task.outcome_id).maybeSingle().throwOnError()
      readingId = outcome?.reading_id ?? null
    }
    const { data: reading } = readingId ? await supabase.from('curriculum_readings').select('id,title,topic_id,structure_pending').eq('id', readingId).eq('is_active', true).maybeSingle().throwOnError() : { data: null }
    if (!reading || reading.structure_pending) return NextResponse.json({ ok: true, unmapped: true })
    const [outcomes, { data: confirmations }] = await Promise.all([
      readAll<any>((a, z) => supabase.from('reading_los').select('id,code,title').eq('reading_id', reading.id).order('sequence').order('id').range(a, z)),
      supabase.from('block_scope_confirmations').select('outcome_id').eq('block_id', id).eq('user_id', access.user.id).throwOnError(),
    ])
    const groups = task.scope_group_id ? await getScopeGroups(access.user.id, [task.scope_group_id]) : null
    const automatic = task.execution === 'completed' && task.outcome_id && (!task.scope_group_id || groups?.get(task.scope_group_id)?.complete)
    return NextResponse.json({ ok: true, reading, revision: task.revision, automatic: Boolean(automatic),
      outcomes: outcomes.filter(o => !task.outcome_id || o.id === task.outcome_id),
      confirmed: (confirmations ?? []).map(c => c.outcome_id) })
  } catch {
    return NextResponse.json({ ok: false, error: 'Covered outcomes could not be loaded. Try again.' }, { status: 503 })
  }
}

/**
 * Confirm which outcomes a Calendar block actually covered. Needed when a block names a
 * reading but not an outcome, or was only partly done — outcomes are never guessed.
 * Body: { blockId, outcomeIds: string[] } (an empty list clears the confirmation). POST only.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { user } = access
  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.blockId !== 'string' || !Array.isArray(body.outcomeIds) || body.outcomeIds.length > 40 || body.outcomeIds.some((o: unknown) => typeof o !== 'string')) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  try {
    // Old clients may omit the revision. Resolve it once; the RPC still locks
    // and compares it. Current forms send the revision they actually displayed.
    let revision = body.expectedRevision
    if (revision === undefined) {
      const { data, error } = await supabase.from('plan_blocks').select('revision').eq('id', body.blockId).eq('user_id', user.id).maybeSingle()
      if (error) return NextResponse.json({ ok: false, error: 'Could not check this task.' }, { status: 503 })
      if (!data) return NextResponse.json({ ok: false, error: 'Task not found.' }, { status: 404 })
      revision = data.revision
    }
    if (!Number.isInteger(revision) || revision < 1) return NextResponse.json({ ok: false, error: 'A valid task revision is required.' }, { status: 400 })
    const result = await taskScopeCommand(supabase, 'confirm_task_scope', {
      p_user_id: user.id, p_task_id: body.blockId, p_expected_revision: revision, p_outcome_ids: [...new Set(body.outcomeIds)],
    })
    return NextResponse.json({ ok: true, confirmed: result.confirmed })
  } catch (error) {
    if (error instanceof RevisionMismatchError) return NextResponse.json({ ok: false, code: 'REVISION_MISMATCH', current: error.current, error: error.message }, { status: 409 })
    if (error instanceof ExecutionCommandError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status })
    return NextResponse.json({ ok: false, error: 'Could not confirm the save. Refresh before trying again.' }, { status: 503 })
  }
}

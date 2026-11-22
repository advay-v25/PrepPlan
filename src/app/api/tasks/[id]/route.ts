import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { ExecutionCommandError } from '../../../../lib/planning/executionCommand'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { getTaskLineage } from '../../../../lib/planning/taskLineageService'
import {
  RevisionMismatchError, TaskConflictError,
  deleteTask, moveTask, setExecution, splitExisting, undoLast,
} from '../../../../lib/planning/taskService'

/**
 * One task, one endpoint.
 *
 * Every write carries `expectedRevision`. A 409 means the task changed
 * elsewhere and the response includes the current row, so the client can show
 * what happened instead of overwriting it.
 */

const EXECUTIONS = ['not_started', 'in_progress', 'partial', 'completed', 'skipped', 'deferred']

function handle(error: unknown) {
  if (error instanceof ExecutionCommandError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message, ...(error.nextUrl ? { nextUrl: error.nextUrl } : {}) }, { status: error.status })
  }
  if (error instanceof RevisionMismatchError) {
    return NextResponse.json(
      { ok: false, code: 'REVISION_MISMATCH', error: error.message, current: error.current },
      { status: 409 }
    )
  }
  if (error instanceof TaskConflictError) {
    return NextResponse.json(
      { ok: false, code: 'CONFLICT', error: error.message, conflicts: error.conflicts, suggestions: error.suggestions },
      { status: 409 }
    )
  }
  if (error && typeof error === 'object' && 'code' in error) return NextResponse.json({ ok: false, error: 'Your schedule could not be checked. Nothing was changed; try again.', code: 'SCHEDULE_UNAVAILABLE' }, { status: 503 })
  const message = error instanceof Error ? error.message : 'Something went wrong'
  return NextResponse.json({ ok: false, error: message }, { status: 400 })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { user } = access

  const { id } = await params
  const admin = createAdminClient()

  const { data: task, error: taskError } = await admin
    .from('plan_blocks').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (taskError) return NextResponse.json({ ok: false, error: 'Your task could not be loaded. Try again shortly.' }, { status: 503 })
  if (!task) return NextResponse.json({ ok: false, error: 'Task not found' }, { status: 404 })

  const { data: history, error: historyError } = await admin
    .from('task_events')
    .select('id, event_type, payload, previous, actual_duration_minutes, notes, created_at')
    .eq('task_id', id).eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(25)
  if (historyError) return NextResponse.json({ ok: false, error: 'Your task history could not be loaded. Try again shortly.' }, { status: 503 })

  const lineage = (await getTaskLineage(user.id, id).catch(() => null))?.info ?? null
  return NextResponse.json({ ok: true, task, history: history ?? [], lineage })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { user } = access

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Send a task action as a JSON object.' }, { status: 400 })
  }
  const action: string = body.action ?? ''
  const expectedRevision = Number(body.expectedRevision)

  if (action !== 'undo' && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
    return NextResponse.json(
      { ok: false, error: 'expectedRevision is required — it is what stops two devices overwriting each other' },
      { status: 400 }
    )
  }

  try {
    switch (action) {
      case 'move': {
        if (typeof body.date !== 'string') return NextResponse.json({ ok: false, error: 'A date is required' }, { status: 400 })
        const startMinutes = body.startMinutes === null || body.startMinutes === undefined ? null : Number(body.startMinutes)
        const result = await moveTask(user.id, id, {
          date: body.date,
          startMinutes,
          durationMinutes: body.durationMinutes === undefined ? undefined : Number(body.durationMinutes),
          expectedRevision,
          acceptWarnings: Boolean(body.acceptWarnings),
        })
        if (result.needsConfirmation) {
          return NextResponse.json({ ok: false, code: 'NEEDS_CONFIRMATION', warnings: result.warnings }, { status: 409 })
        }
        return NextResponse.json({ ok: true, task: result.task, outcome: result.outcome ?? null, reopened: result.reopened ?? false })
      }

      case 'execution': {
        if (!EXECUTIONS.includes(body.execution)) {
          return NextResponse.json({ ok: false, error: `execution must be one of ${EXECUTIONS.join(', ')}` }, { status: 400 })
        }
        const result = await setExecution(user.id, id, {
          execution: body.execution,
          expectedRevision,
          actualDurationMinutes: body.actualDurationMinutes == null ? undefined : body.actualDurationMinutes,
          note: body.note == null ? undefined : body.note,
        })
        return NextResponse.json({ ok: true, task: result.task, outcome: result.outcome })
      }

      case 'split': {
        const result = await splitExisting(user.id, id, expectedRevision, body.at === undefined ? undefined : Number(body.at))
        return NextResponse.json({ ok: true, task: result.first, secondId: result.secondId })
      }

      case 'undo': {
        const result = await undoLast(user.id, id)
        return NextResponse.json({ ok: true, task: result.task, outcome: result.outcome })
      }

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action "${action}". Expected move, execution, split, or undo.` },
          { status: 400 }
        )
    }
  } catch (error) {
    return handle(error)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { user } = access

  const { id } = await params
  const expectedRevision = Number(new URL(req.url).searchParams.get('expectedRevision'))
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return NextResponse.json({ ok: false, error: 'expectedRevision is required' }, { status: 400 })
  }

  try {
    const result = await deleteTask(user.id, id, expectedRevision)
    return NextResponse.json({ ok: true, deleted: result.deleted, cancelled: result.cancelled })
  } catch (error) {
    return handle(error)
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import { createManualTask, TaskConflictError } from '../../../lib/planning/taskService'
import { ExecutionCommandError } from '../../../lib/planning/executionCommand'

/** Adds a task the student chose to add. One database command writes it and its history; the same `key` replays instead of duplicating. */
export async function POST(req: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, error: 'Send the task as a JSON object.' }, { status: 400 })
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length < 2) return NextResponse.json({ ok: false, error: 'Give the task a name' }, { status: 400 })
  if (typeof body.date !== 'string') return NextResponse.json({ ok: false, error: 'A valid date is required' }, { status: 400 })
  if (typeof body.key !== 'string' || !/^[0-9a-f-]{36}$/.test(body.key)) return NextResponse.json({ ok: false, error: 'Reload the page and try again.' }, { status: 400 })

  try {
    const r = await createManualTask(access.user.id, {
      key: `task-${body.key}`, title, detail: typeof body.detail === 'string' ? body.detail : undefined,
      taskType: typeof body.taskType === 'string' ? body.taskType : 'study', priority: body.priority === 'optional' ? 'optional' : 'core',
      date: body.date, startMinutes: body.startMinutes === null || body.startMinutes === undefined ? null : Number(body.startMinutes),
      durationMinutes: Number(body.durationMinutes ?? 45), acceptWarnings: Boolean(body.acceptWarnings),
    })
    if (r.needsConfirmation) return NextResponse.json({ ok: false, code: 'NEEDS_CONFIRMATION', warnings: r.warnings }, { status: 409 })
    return NextResponse.json({ ok: true, task: r.task, current: r.current, replayed: r.replayed })
  } catch (error) {
    if (error instanceof ExecutionCommandError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status })
    if (error instanceof TaskConflictError) return NextResponse.json({ ok: false, code: 'CONFLICT', error: error.message, conflicts: error.conflicts, suggestions: error.suggestions }, { status: 409 })
    return NextResponse.json({ ok: false, code: 'SCHEDULE_UNAVAILABLE', error: 'Your schedule could not be checked. Nothing was added; try again.' }, { status: 503 })
  }
}

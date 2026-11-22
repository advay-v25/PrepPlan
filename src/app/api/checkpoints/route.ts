import { NextResponse } from 'next/server'
import { recordFailure } from '../../../lib/ops/routeFailure'
import { createClient } from '../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import {
  CheckpointError, addSuggestion, cancelCheckpoint, getCheckpointView, keepRelatedTask, parseCheckpointInput, parseMeta,
  recordMockOutcome, removeRelatedTask, saveCheckpoint, setAssessmentChoice, addAppointment,
} from '../../../lib/planning/checkpointService'

export const dynamic = 'force-dynamic'

/**
 * The student's mock / checkpoint: one record, read and changed here for Calendar, Home, the roadmap and Coach.
 *   GET     the checkpoint (with id and version), its week, assessment choice, conflicts, suggestions and related tasks
 *   PUT     create, edit or move  { key, checkpointId?, expectedVersion?, date, kind, label?, startTime?, durationMinutes? }
 *   DELETE  cancel it             { key, checkpointId, expectedVersion }
 *   POST    { key, action: 'add', date, kind, ... } adds ANOTHER appointment; GET ?appointment=<id> shows one
 *   POST    { key, checkpointId, expectedVersion, action: 'choice' | 'outcome' | 'addSuggestion' | 'removeRelated' | 'keepRelated', ... }
 * Every write is ONE database transaction with a per-student request key: repeating a key returns the original receipt, reusing it
 * for a different request is refused, and a request for an older version of the checkpoint cannot change a newer one.
 * All methods need application access and act only on the signed-in student's own record.
 */
async function guard() {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  return access.ok ? { user: access.user } : { response: access.response }
}

async function failure(userId: string | null, e: unknown) {
  if (e instanceof CheckpointError) {
    // A stale request gets the current checkpoint back, so the page can refresh in one round trip.
    const current = e.code === 'CHECKPOINT_CHANGED' && userId ? await getCheckpointView(userId).catch(() => null) : undefined
    return NextResponse.json({ ok: false, code: e.code, error: e.message, ...(e.extra ?? {}), ...(current !== undefined ? { checkpoint: current } : {}) }, { status: e.status })
  }
  const requestId = recordFailure('checkpoint.command', e)
  return NextResponse.json({ ok: false, code: 'FAILED', error: 'PrepPlan could not confirm the change. Retry the same request safely.', requestId }, { status: 500 })
}

async function saved(userId: string, receipt: Record<string, unknown>, appointmentId: string | null = null) {
  try {
    return NextResponse.json({ ok: true, ...receipt, checkpoint: await getCheckpointView(userId, new Date(), appointmentId) })
  } catch (cause) {
    const requestId = recordFailure('checkpoint.after_save', cause, 503)
    return NextResponse.json({ ok: true, ...receipt, checkpoint: null, projectionUnavailable: true, requestId })
  }
}

export async function GET(request: Request) {
  const g = await guard(); if (g.response) return g.response
  const id = new URL(request.url).searchParams.get('appointment')
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, code: 'INVALID', error: 'That appointment reference is not valid.' }, { status: 400 })
  try { return NextResponse.json({ ok: true, checkpoint: await getCheckpointView(g.user!.id, new Date(), id) }) } catch (e) { return failure(g.user!.id, e) }
}

export async function PUT(request: Request) {
  const g = await guard(); if (g.response) return g.response
  const body = await request.json().catch(() => null) as any
  try {
    const receipt = await saveCheckpoint(g.user!.id, parseMeta(body), parseCheckpointInput(body))
    return saved(g.user!.id, { receipt }, typeof receipt.checkpointId === 'string' ? receipt.checkpointId : null)
  } catch (e) { return failure(g.user!.id, e) }
}

export async function DELETE(request: Request) {
  const g = await guard(); if (g.response) return g.response
  const body = await request.json().catch(() => null) as any
  try {
    const receipt = await cancelCheckpoint(g.user!.id, parseMeta(body))
    return saved(g.user!.id, receipt)
  } catch (e) { return failure(g.user!.id, e) }
}

export async function POST(request: Request) {
  const g = await guard(); if (g.response) return g.response
  const body = await request.json().catch(() => null) as any
  const uid = g.user!.id
  try {
    const meta = parseMeta(body)
    let receipt: Record<string, unknown>
    switch (body?.action) {
      case 'add': receipt = await addAppointment(uid, meta, parseCheckpointInput(body)); break
      case 'choice': receipt = await setAssessmentChoice(uid, meta, body.choice, body.paperAction); break
      case 'outcome': receipt = await recordMockOutcome(uid, meta, body); break
      case 'addSuggestion': receipt = await addSuggestion(uid, meta, body.suggestionId); break
      case 'removeRelated': receipt = await removeRelatedTask(uid, meta, body.taskId, body.expectedRevision); break
      case 'keepRelated': receipt = await keepRelatedTask(uid, meta, body.taskId); break
      default: return NextResponse.json({ ok: false, code: 'INVALID', error: 'Unknown action.' }, { status: 400 })
    }
    const keep = ['add', 'choice', 'addSuggestion', 'removeRelated', 'keepRelated'].includes(body?.action) ? (typeof receipt.checkpointId === 'string' ? receipt.checkpointId : meta.checkpointId) : null
    return saved(uid, receipt, keep)
  } catch (e) { return failure(uid, e) }
}

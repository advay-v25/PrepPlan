import { NextResponse } from 'next/server'
import { withOwnedAttempt } from '../../../../../../lib/tests/attemptAccess'

export const dynamic = 'force-dynamic'

/**
 * Heartbeat: active/interrupted seconds and the flag for one question, so time survives a refresh. The write is ONE atomic, monotonic
 * database command (record_item_progress): an older or overlapping heartbeat can never lower saved time, and nothing is written to an attempt
 * that has closed. Every response carries a machine-readable `code` and a request id; stage timings go to the server log and the
 * Server-Timing header. No cookie, token or answer content is ever logged.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t0 = performance.now(), requestId = crypto.randomUUID(), stages: Record<string, number> = {}
  const mark = (name: string, from: number) => { stages[name] = Math.round(performance.now() - from) }
  const finish = (status: number, code: string, body: Record<string, unknown>, attemptId?: string) => {
    mark('total', t0)
    // Only identifiers, the outcome and timings. A slow stage is visible without a debugger.
    console.info(JSON.stringify({ event: 'tests.progress', requestId, attemptId: attemptId ?? null, status, code, ms: stages }))
    return NextResponse.json({ ...body, code, requestId }, { status, headers: { 'x-request-id': requestId, 'Server-Timing': Object.entries(stages).map(([k, v]) => `${k};dur=${v}`).join(', ') } })
  }
  const { id } = await params
  const tAccess = performance.now()
  const a = await withOwnedAttempt(id)
  mark('access_and_ownership', tAccess)
  if (!a.ok) {
    const b = await a.response.json().catch(() => ({} as any))
    const status = a.response.status
    return finish(status, b.code ?? (status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'error'), { ok: false, error: b.error ?? 'Not allowed.' }, id)
  }
  const { admin, userId, attempt } = a
  if (!['ready', 'in_progress'].includes(attempt.status)) return finish(409, 'closed', { ok: false, error: 'This attempt is closed.' }, id)
  const body = await req.json().catch(() => null) as any
  if (!body || typeof body.itemId !== 'string') return finish(400, 'bad_request', { ok: false, error: 'Invalid request.' }, id)

  const tWrite = performance.now()
  const { data, error } = await admin.rpc('record_item_progress', {
    p_attempt: id, p_user: userId, p_item: body.itemId, p_active: Math.floor(Number(body.activeSeconds) || 0), p_interrupted: Math.floor(Number(body.interruptedSeconds) || 0),
    p_visit: body.visit === true, p_flagged: typeof body.flagged === 'boolean' ? body.flagged : null,
  })
  mark('progress_write', tWrite)
  if (error) { console.error(`[tests/progress ${requestId}]`, error.message); return finish(500, 'write_failed', { ok: false, error: 'Could not save progress.' }, id) }
  const r = data as { ok: boolean; code?: string; activeSeconds?: number; interruptedSeconds?: number }
  if (!r.ok) return finish(r.code === 'closed' ? 409 : r.code === 'not_found' ? 404 : 400, r.code ?? 'error', { ok: false, error: r.code === 'closed' ? 'This attempt is closed.' : 'Item not in this attempt.' }, id)
  return finish(200, 'ok', { ok: true, activeSeconds: r.activeSeconds, interruptedSeconds: r.interruptedSeconds }, id)
}

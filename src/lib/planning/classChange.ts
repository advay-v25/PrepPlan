import { createAdminClient } from '../supabase/admin'
import { commitmentConflict, isBookingConflict } from './bookingConflict'

/**
 * One protocol for changing a class: preview (read-only) then confirm (atomic, keyed, bound to the previewed state).
 * The database owns validation and the write (migration 20261224); this file only shapes the request and the HTTP outcome.
 */
export const CLASS_ACTIONS = ['occurrence_move', 'occurrence_cancel', 'occurrence_restore', 'series_from'] as const
export type ClassAction = (typeof CLASS_ACTIONS)[number]

type Body = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** Request body (camelCase) -> command parameters (snake_case). Unknown actions and wrong types are refused, never defaulted. */
export function toCommand(body: Body): { ok: true; action: ClassAction; params: Record<string, unknown> } | { ok: false; error: string } {
  const action = body.action
  if (typeof action !== 'string' || !(CLASS_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: 'Choose what to change.' }
  for (const k of ['occurrenceDate', 'newDate', 'newStartTime', 'newEndTime', 'effectiveFrom', 'startTime', 'endTime', 'note']) {
    if (body[k] !== undefined && body[k] !== null && typeof body[k] !== 'string') return { ok: false, error: `${k} must be text.` }
  }
  if (body.weekdays !== undefined && !(Array.isArray(body.weekdays) && body.weekdays.every(d => typeof d === 'number' || typeof d === 'string'))) return { ok: false, error: 'weekdays must be a list.' }
  const params: Record<string, unknown> = {}
  const put = (to: string, v: unknown) => { if (v !== undefined && v !== null) params[to] = v }
  put('occurrence_date', str(body.occurrenceDate)); put('new_date', str(body.newDate)); put('new_start_time', str(body.newStartTime)); put('new_end_time', str(body.newEndTime))
  put('effective_from', str(body.effectiveFrom)); put('start_time', str(body.startTime)); put('end_time', str(body.endTime)); put('note', str(body.note))
  if (body.weekdays !== undefined) params.weekdays = (body.weekdays as (number | string)[]).map(String)
  if (body.acknowledgeExceptions === true) params.acknowledge_exceptions = true
  return { ok: true, action: action as ClassAction, params }
}

const STATUS: Record<string, number> = { NOT_FOUND: 404, STALE_SOURCE: 409, STALE_PREVIEW: 409, CONFLICT: 409, KEY_REUSED: 409, EXCEPTIONS_UNRESOLVED: 409, NO_CHANGE: 409, USE_RESTORE: 409, OVERLAPS_SERIES: 409, SERIES_FINISHED: 409 }
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

export type ClassChangeOutcome = { status: number; body: Record<string, unknown> }

const refuse = (r: Record<string, any>): ClassChangeOutcome => ({ status: STATUS[r.code as string] ?? 400, body: { ...r, error: r.message } })
/** An infrastructure failure: nothing is claimed about whether the change happened. */
const unavailable = (): ClassChangeOutcome => ({ status: 503, body: { ok: false, code: 'UNAVAILABLE', error: 'Could not reach your calendar just now. Nothing was changed that we can confirm — retry, and the same request will not apply twice.' } })

export async function previewClassChange(userId: string, commitmentId: string, body: Body): Promise<ClassChangeOutcome> {
  if (!isUuid(commitmentId)) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: 'That class is no longer available.' } }
  const cmd = toCommand(body); if (!cmd.ok) return { status: 400, body: { ok: false, code: 'INVALID_INPUT', error: cmd.error } }
  const { data, error } = await createAdminClient().rpc('class_change_preview', {
    p_user: userId, p_commitment: commitmentId, p_action: cmd.action, p_params: cmd.params, p_expected_token: typeof body.expectedToken === 'string' ? body.expectedToken : null,
  })
  if (error || !data) return unavailable()
  return data.ok ? { status: 200, body: data } : refuse(data)
}

export async function applyClassChange(userId: string, commitmentId: string, body: Body): Promise<ClassChangeOutcome> {
  if (!isUuid(commitmentId)) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: 'That class is no longer available.' } }
  const cmd = toCommand(body); if (!cmd.ok) return { status: 400, body: { ok: false, code: 'INVALID_INPUT', error: cmd.error } }
  if (typeof body.operationKey !== 'string' || typeof body.fingerprint !== 'string') return { status: 400, body: { ok: false, code: 'INVALID_INPUT', error: 'Preview the change first, then confirm it.' } }
  const { data, error } = await createAdminClient().rpc('class_change_apply', {
    p_user: userId, p_key: body.operationKey, p_action: cmd.action, p_commitment: commitmentId, p_params: cmd.params, p_fingerprint: body.fingerprint,
    p_expected_token: typeof body.expectedToken === 'string' ? body.expectedToken : null,
  })
  // A booking refused inside the transaction: everything rolled back, the series and its exceptions are as they were.
  if (error && isBookingConflict(error)) return { status: 409, body: commitmentConflict(error) }
  if (error || !data) return unavailable()
  return data.ok ? { status: 200, body: data } : refuse(data)
}

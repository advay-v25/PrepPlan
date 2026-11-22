import { isCalendarDate } from '../../../../lib/format/date'
import { routeFailure } from '../../../../lib/ops/routeFailure'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { commitmentConflict, isBookingConflict } from '../../../../lib/planning/bookingConflict'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { applyClassChange } from '../../../../lib/planning/classChange'

const KINDS = ['class', 'work', 'personal', 'travel', 'other']

/**
 * Editing a commitment, and editing a single occurrence of one.
 *
 * "My Wednesday class is cancelled this week" must not delete the series, and
 * "it moved to Sunday" must not move every future Wednesday. Both are recorded
 * as exceptions against one date.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  const { id } = await params
  const body = await req.json().catch(() => null) as Record<string, any> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, error: 'The change is incomplete.' }, { status: 400 })

  // One class, or this and future classes: the previewed, keyed, atomic protocol (see classChange.ts). It is the only writer of occurrence exceptions.
  if (body.action !== undefined) {
    const r = await applyClassChange(user.id, id, body)
    return NextResponse.json(r.body, { status: r.status })
  }
  if (body.scope === 'occurrence') {
    return NextResponse.json({ ok: false, code: 'USE_CHANGE_PROTOCOL', error: 'Preview the change, then confirm it (action occurrence_move, occurrence_cancel or occurrence_restore).' }, { status: 400 })
  }

  const { data: commitment, error: readError } = await supabase
    .from('calendar_commitments').select('id, kind, recurrence, start_time, end_time').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (readError) return routeFailure('commitment.load', 'Your commitment could not be loaded. Try again.', readError)
  if (!commitment) return NextResponse.json({ ok: false, error: 'Commitment not found' }, { status: 404 })

  // A change to the whole series. A recurring class's days and times never rewrite classes that already happened: use "this and future classes".
  const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 })
  const updates: Record<string, unknown> = {}
  if (body.label !== undefined) { if (typeof body.label !== 'string' || body.label.trim().length < 2) return bad('Give the commitment a name'); updates.label = body.label.trim() }
  if (body.kind !== undefined) { if (!KINDS.includes(body.kind)) return bad('Choose a valid kind'); updates.kind = body.kind }
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/
  if (body.startTime !== undefined) { if (typeof body.startTime !== 'string' || !hhmm.test(body.startTime)) return bad('Start time must be HH:MM'); updates.start_time = body.startTime }
  if (body.endTime !== undefined) { if (typeof body.endTime !== 'string' || !hhmm.test(body.endTime)) return bad('End time must be HH:MM'); updates.end_time = body.endTime }
  if (body.weekdays !== undefined) {
    if (!Array.isArray(body.weekdays) || body.weekdays.length === 0 || !body.weekdays.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) return bad('Choose at least one valid day of the week')
    updates.weekdays = [...new Set(body.weekdays as number[])]
  }
  if (body.isProtected !== undefined) { if (typeof body.isProtected !== 'boolean') return bad('isProtected must be true or false'); updates.is_protected = body.isProtected }
  if (body.endsOn !== undefined) { if (body.endsOn !== null && !(typeof body.endsOn === 'string' && isCalendarDate(body.endsOn))) return bad('Choose a valid end date'); updates.ends_on = body.endsOn }

  if (commitment.kind === 'class' && commitment.recurrence === 'weekly' && ['start_time', 'end_time', 'weekdays', 'ends_on'].some(k => k in updates)) {
    return NextResponse.json({ ok: false, code: 'USE_FUTURE_EDIT', error: 'Change a class pattern from a chosen date (this and future classes) so earlier classes keep their record.' }, { status: 400 })
  }
  const mergedStart = String(updates.start_time ?? commitment.start_time ?? '').slice(0, 5), mergedEnd = String(updates.end_time ?? commitment.end_time ?? '').slice(0, 5)
  if ((updates.start_time || updates.end_time) && mergedStart && mergedEnd && mergedEnd <= mergedStart) return bad('It has to end after it starts')
  if (Object.keys(updates).length === 0) return bad('Nothing to change')

  const { data, error } = await createAdminClient()
    .from('calendar_commitments').update(updates).eq('id', id).eq('user_id', user.id).select('*').single()

  if (error && isBookingConflict(error)) return NextResponse.json(commitmentConflict(error), { status: 409 })
  if (error) return routeFailure('commitment', 'Could not confirm this change. Check Calendar before trying again.', error)
  return NextResponse.json({ ok: true, commitment: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  const { id } = await params
  // Archived, not deleted: history that references it stays readable.
  const { data, error } = await createAdminClient()
    .from('calendar_commitments').update({ status: 'archived' }).eq('id', id).eq('user_id', user.id).select('id').maybeSingle()

  if (error && isBookingConflict(error)) return NextResponse.json(commitmentConflict(error), { status: 409 })
  if (error) return routeFailure('commitment', 'Could not confirm the archive. Check Calendar before trying again.', error)
  if (!data) return NextResponse.json({ ok: false, error: 'Commitment not found' }, { status: 404 })
  return NextResponse.json({ ok: true, archived: true })
}

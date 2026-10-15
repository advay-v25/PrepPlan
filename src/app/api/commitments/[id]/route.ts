import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'

/**
 * Editing a commitment, and editing a single occurrence of one.
 *
 * "My Wednesday class is cancelled this week" must not delete the series, and
 * "it moved to Sunday" must not move every future Wednesday. Both are recorded
 * as exceptions against one date.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({} as any))

  const { data: commitment } = await supabase
    .from('calendar_commitments').select('id, recurrence').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!commitment) return NextResponse.json({ ok: false, error: 'Commitment not found' }, { status: 404 })

  // A change to one occurrence.
  if (body.scope === 'occurrence') {
    if (commitment.recurrence !== 'weekly') {
      return NextResponse.json({ ok: false, error: 'This commitment does not repeat, so it has no single occurrence to change' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.occurrenceDate)) {
      return NextResponse.json({ ok: false, error: 'Which date is being changed?' }, { status: 400 })
    }
    const kind = body.kind === 'moved' ? 'moved' : 'skipped'
    if (kind === 'moved' && !/^\d{4}-\d{2}-\d{2}$/.test(body.newDate)) {
      return NextResponse.json({ ok: false, error: 'A new date is required to move an occurrence' }, { status: 400 })
    }

    const { data, error } = await supabase.from('commitment_exceptions').upsert({
      user_id: user.id,
      commitment_id: id,
      occurrence_date: body.occurrenceDate,
      kind,
      new_date: kind === 'moved' ? body.newDate : null,
      new_start_time: kind === 'moved' && /^\d{2}:\d{2}$/.test(body.newStartTime ?? '') ? body.newStartTime : null,
      new_end_time: kind === 'moved' && /^\d{2}:\d{2}$/.test(body.newEndTime ?? '') ? body.newEndTime : null,
      note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
    }, { onConflict: 'commitment_id,occurrence_date' }).select('*').single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, exception: data })
  }

  // A change to the whole series.
  const updates: Record<string, unknown> = {}
  if (typeof body.label === 'string' && body.label.trim().length >= 2) updates.label = body.label.trim()
  if (['class', 'work', 'personal', 'travel', 'other'].includes(body.kind)) updates.kind = body.kind
  if (/^\d{2}:\d{2}$/.test(body.startTime ?? '')) updates.start_time = body.startTime
  if (/^\d{2}:\d{2}$/.test(body.endTime ?? '')) updates.end_time = body.endTime
  if (Array.isArray(body.weekdays)) {
    updates.weekdays = [...new Set(body.weekdays.map(Number).filter((d: number) => d >= 0 && d <= 6))]
  }
  if (typeof body.isProtected === 'boolean') updates.is_protected = body.isProtected
  if (typeof body.endsOn === 'string' || body.endsOn === null) updates.ends_on = body.endsOn

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: 'Nothing to change' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('calendar_commitments').update(updates).eq('id', id).eq('user_id', user.id).select('*').single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, commitment: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  // Archived, not deleted: history that references it stays readable.
  const { error } = await supabase
    .from('calendar_commitments').update({ status: 'archived' }).eq('id', id).eq('user_id', user.id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, archived: true })
}

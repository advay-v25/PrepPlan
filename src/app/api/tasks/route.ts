import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { getStudyWeekContext } from '../../../lib/planning/schedule'
import { occupantsFor } from '../../../lib/planning/taskService'
import { findConflicts, suggestSlots, validateDuration, validateStart } from '../../../lib/planning/mutations'
import { zonedTimeToUtc } from '../../../lib/planning/studyWeek'

/** Creates a task the student added themselves. */
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const date = typeof body.date === 'string' ? body.date : ''

  if (title.length < 2) return NextResponse.json({ ok: false, error: 'Give the task a name' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: 'A valid date is required' }, { status: 400 })

  const duration = validateDuration(Number(body.durationMinutes ?? 45))
  if (!duration.ok) return NextResponse.json({ ok: false, error: duration.error }, { status: 400 })

  const ctx = await getStudyWeekContext(user.id)
  let startsAt: string | null = null
  let placement: 'timed' | 'day_preferred' = 'day_preferred'

  if (body.startMinutes !== null && body.startMinutes !== undefined) {
    const start = validateStart(Number(body.startMinutes))
    if (!start.ok) return NextResponse.json({ ok: false, error: start.error }, { status: 400 })

    const candidate = { date, start: start.value, durationMinutes: duration.value }
    const occupants = await occupantsFor(user.id, [date], ctx.timezone)
    const blocking = findConflicts(candidate, occupants, { protectedOnly: true })
    if (blocking.length > 0) {
      return NextResponse.json({
        ok: false, code: 'CONFLICT',
        error: `${blocking[0].occupant.title} is already there, and it is protected.`,
        conflicts: blocking.map(c => ({ title: c.occupant.title, overlapMinutes: c.overlapMinutes })),
        suggestions: suggestSlots(candidate, occupants),
      }, { status: 409 })
    }

    const time = `${String(Math.floor(start.value / 60)).padStart(2, '0')}:${String(start.value % 60).padStart(2, '0')}`
    startsAt = zonedTimeToUtc(date, time, ctx.timezone).toISOString()
    placement = 'timed'
  }

  const admin = createAdminClient()
  const { data: cycle } = await admin
    .from('planning_cycles').select('id').eq('user_id', user.id).eq('status', 'active').maybeSingle()

  const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const { data, error } = await admin.from('plan_blocks').insert({
    id,
    user_id: user.id,
    cycle_id: (cycle?.id as string) ?? null,
    title,
    detail: typeof body.detail === 'string' && body.detail.trim() ? body.detail.trim() : 'Added by you.',
    task_type: ['study', 'review', 'repair', 'recheck', 'mock', 'admin', 'other'].includes(body.taskType) ? body.taskType : 'study',
    origin: 'student',
    priority: body.priority === 'optional' ? 'optional' : 'core',
    placement,
    execution: 'not_started',
    local_date: date,
    day: date,
    starts_at: startsAt,
    duration_minutes: duration.value,
    duration: String(duration.value),
    rationale: 'You added this yourself.',
    is_protected_commitment: false,
    created_by: 'student',
  }).select('*').single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  await admin.from('task_events').insert({
    user_id: user.id, task_id: id, event_type: 'created',
    payload: { title, date, startMinutes: body.startMinutes ?? null, durationMinutes: duration.value },
    previous: {},
  })

  return NextResponse.json({ ok: true, task: data })
}

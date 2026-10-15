import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { getStudyWeekContext } from '../../../lib/planning/schedule'
import { zonedTimeToUtc } from '../../../lib/planning/studyWeek'

/**
 * Recurring and one-off commitments — classes, work, life.
 *
 * A weekly commitment stores local wall-clock times, so a 6pm class stays at
 * 6pm across a daylight-saving change rather than drifting an hour.
 */

const KINDS = ['class', 'work', 'personal', 'travel', 'other']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('calendar_commitments')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, commitments: data ?? [] })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const kind = KINDS.includes(body.kind) ? body.kind : 'other'
  const recurrence: 'none' | 'weekly' = body.recurrence === 'weekly' ? 'weekly' : 'none'
  // Only the dedicated "Add next class" control ever sends this: a one-off class that stands for the whole
  // week's boundary, the way a variable schedule has no recurring weekday to derive it from otherwise (see
  // resolvePulseWeek's anchor rule). An ad-hoc class — a doubt session, a makeup — goes through the ordinary
  // path below with this left false: it blocks the time and can be logged for coverage, but does not move
  // the week's paper day.
  const isNextClass = body.isNextClass === true && kind === 'class' && recurrence === 'none'
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const effectiveLabel = label || (isNextClass ? 'Class' : '')

  if (effectiveLabel.length < 2) return NextResponse.json({ ok: false, error: 'Give the commitment a name' }, { status: 400 })

  const ctx = await getStudyWeekContext(user.id)
  const timeShape = /^\d{2}:\d{2}$/

  if (recurrence === 'weekly') {
    const weekdays: number[] = Array.isArray(body.weekdays)
      ? Array.from(new Set(
          (body.weekdays as unknown[])
            .map(Number)
            .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
        ))
      : []
    if (weekdays.length === 0) return NextResponse.json({ ok: false, error: 'Choose at least one day of the week' }, { status: 400 })
    if (!timeShape.test(body.startTime) || !timeShape.test(body.endTime)) {
      return NextResponse.json({ ok: false, error: 'Start and end time are required, as HH:MM' }, { status: 400 })
    }
    if (body.endTime <= body.startTime) {
      return NextResponse.json({ ok: false, error: 'It has to end after it starts' }, { status: 400 })
    }

    const startsOn = typeof body.startsOn === 'string' ? body.startsOn : ctx.week.startDate
    // starts_at/ends_at remain NOT NULL; a series anchors them to its first occurrence.
    const anchorStart = zonedTimeToUtc(startsOn, body.startTime, ctx.timezone)
    const anchorEnd = zonedTimeToUtc(startsOn, body.endTime, ctx.timezone)

    const { data, error } = await supabase.from('calendar_commitments').insert({
      user_id: user.id, label: effectiveLabel, kind, recurrence: 'weekly', weekdays,
      start_time: body.startTime, end_time: body.endTime,
      starts_on: startsOn, ends_on: typeof body.endsOn === 'string' ? body.endsOn : null,
      timezone: ctx.timezone,
      starts_at: anchorStart.toISOString(), ends_at: anchorEnd.toISOString(),
      is_protected: body.isProtected !== false,
      source: 'student', status: 'active',
    }).select('*').single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, commitment: data })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !timeShape.test(body.startTime) || !timeShape.test(body.endTime)) {
    return NextResponse.json({ ok: false, error: 'A date, start time and end time are required' }, { status: 400 })
  }
  if (body.endTime <= body.startTime) {
    return NextResponse.json({ ok: false, error: 'It has to end after it starts' }, { status: 400 })
  }

  const { data, error } = await supabase.from('calendar_commitments').insert({
    user_id: user.id, label: effectiveLabel, kind, recurrence: 'none',
    starts_at: zonedTimeToUtc(body.date, body.startTime, ctx.timezone).toISOString(),
    ends_at: zonedTimeToUtc(body.date, body.endTime, ctx.timezone).toISOString(),
    timezone: ctx.timezone,
    is_protected: body.isProtected !== false,
    defines_cycle: isNextClass,
    source: 'student', status: 'active',
  }).select('*').single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, commitment: data })
}

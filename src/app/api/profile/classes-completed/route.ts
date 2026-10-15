import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { todayInZone } from '../../../../lib/planning/studyWeek'

/**
 * Manual fallback for "my classes have finished" — the only signal of this kind
 * a class-led/hybrid student can give when no weekly class series carries an
 * `ends_on`. It moves the roadmap out of its class-anchored first pass and into
 * the same consolidation/revision structure a self-study student reaches on
 * their own (see roadmap.ts's classesCompletedDate). The roadmap rebuilds live
 * on next read, so nothing else needs to happen here.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const done = body.done !== false

  const { data: profile } = await supabase
    .from('profiles')
    .select('prep_mode, timezone')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.prep_mode !== 'instructor_led' && profile?.prep_mode !== 'hybrid') {
    return NextResponse.json({ ok: false, error: 'Only class-led or hybrid preparation has classes to finish' }, { status: 400 })
  }

  const classesCompletedAt = done ? todayInZone(profile.timezone ?? 'UTC', new Date()) : null
  const { error } = await supabase
    .from('profiles')
    .update({ classes_completed_at: classesCompletedAt })
    .eq('id', user.id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, classesCompletedAt })
}

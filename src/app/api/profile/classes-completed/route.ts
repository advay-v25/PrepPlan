import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { todayInZone } from '../../../../lib/planning/studyWeek'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { createAdminClient } from '../../../../lib/supabase/admin'

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
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  const body = await req.json().catch(() => null)
  if (typeof body?.done !== 'boolean') return NextResponse.json({ ok: false, error: 'Choose whether your classes have finished.' }, { status: 400 })
  const done = body.done

  const { data: profile } = await supabase
    .from('profiles')
    .select('prep_mode, timezone')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.prep_mode !== 'instructor_led' && profile?.prep_mode !== 'hybrid') {
    return NextResponse.json({ ok: false, error: 'Only class-led or hybrid preparation has classes to finish' }, { status: 400 })
  }

  const classesCompletedAt = done ? todayInZone(profile.timezone ?? 'UTC', new Date()) : null
  // One transaction: the profile date AND the future of the weekly class series (see set_classes_finished). Past classes, logs and the accepted cycle are untouched.
  const { data: result, error } = await createAdminClient().rpc('set_classes_finished', { p_user: user.id, p_done: done, p_date: classesCompletedAt ?? todayInZone(profile.timezone ?? 'UTC', new Date()) })

  if (error) { console.error('[classes-completed]', error.message); return NextResponse.json({ ok: false, error: 'Could not save this. Nothing was changed; try again.' }, { status: 500 }) }
  const r = result as { ok: boolean; code?: string; conflicts?: { series: string; date: string; mock: string }[] }
  if (!r.ok && r.code === 'UNDO_CONFLICT') {
    // Nothing was changed. Restoring the classes would put one over a booked mock; the student reviews the mock (or keeps classes finished).
    return NextResponse.json({ ok: false, code: 'UNDO_CONFLICT', conflicts: r.conflicts ?? [], error: 'Your classes were not restored: a class would land on a mock you booked. Nothing was changed. Move or cancel that mock in Calendar, then undo again, or keep your classes finished.', reviewHref: '/app/calendar' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, classesCompletedAt: done ? classesCompletedAt : null, ...(result as object) })
}

import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { todayInZone } from '../../../../../lib/planning/studyWeek'

export const dynamic = 'force-dynamic'

/**
 * "I studied this": records extra learning as a COMPLETED, curriculum-mapped Calendar block in the
 * open cycle, so it joins the paper's scope and stays visible on Calendar. Idempotent per key.
 * Body: { idempotencyKey, outcomeIds: string[], minutes?: 5..180 }. POST only.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as any
  const key = body?.idempotencyKey
  if (!body || typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,60}$/.test(key) || !Array.isArray(body.outcomeIds) || body.outcomeIds.length < 1 || body.outcomeIds.length > 20
    || body.outcomeIds.some((o: unknown) => typeof o !== 'string')) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  const minutes = body.minutes === undefined ? 30 : Number(body.minutes)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) return NextResponse.json({ ok: false, error: 'Minutes must be between 5 and 180.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: cycle } = await admin.from('planning_cycles').select('id, timezone, starts_at_local, ends_at_local').eq('user_id', user.id).eq('status', 'active').maybeSingle()
  if (!cycle) return NextResponse.json({ ok: false, code: 'no_cycle', error: 'There is no open week to add this to. Prepare your week in Calendar first.' }, { status: 409 })

  const ids = [...new Set(body.outcomeIds as string[])]
  const { data: los } = await admin.from('reading_los').select('id, title, reading_id').in('id', ids)
  const { data: readings } = await admin.from('curriculum_readings').select('id, reading_no, structure_pending').in('id', [...new Set((los ?? []).map(l => l.reading_id as string))])
  const rmap = new Map((readings ?? []).map(r => [r.id as string, r]))
  if ((los ?? []).length !== ids.length || (los ?? []).some(l => rmap.get(l.reading_id as string)?.structure_pending)) {
    return NextResponse.json({ ok: false, error: 'One of those outcomes is not part of the syllabus list yet.' }, { status: 400 })
  }

  const today = todayInZone((cycle.timezone as string | null) ?? 'UTC')
  const rows = (los ?? []).map(l => ({
    id: `qs-${key}-${l.id}`, user_id: user.id, cycle_id: cycle.id, title: `Studied: ${l.title} (Reading ${rmap.get(l.reading_id as string)!.reading_no})`,
    detail: '', task_type: 'study', origin: 'student', priority: 'core', placement: 'day_preferred', execution: 'completed',
    local_date: today, day: today, duration_minutes: minutes, duration: String(minutes), lm_id: l.reading_id, outcome_id: l.id,
    rationale: 'Extra learning you recorded yourself.', created_by: 'student',
  }))
  // Deterministic ids make a repeat of the same key a no-op.
  const { error } = await admin.from('plan_blocks').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  if (error) {
    const requestId = crypto.randomUUID()
    console.error(`[tests/scope/quick-study ${requestId}]`, error.message)
    return NextResponse.json({ ok: false, error: 'Could not record it.', requestId }, { status: 500 })
  }
  return NextResponse.json({ ok: true, blocks: rows.length })
}

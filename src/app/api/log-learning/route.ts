import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '../../../lib/supabase/server'
import { todayInZone } from '../../../lib/planning/studyWeek'

export const dynamic = 'force-dynamic'

/**
 * The curriculum as the log picker needs it: subject → reading → outcomes.
 * `modules` is the older flat shape, kept for existing callers.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [topicsRes, readingsRes, losRes] = await Promise.all([
    supabase.from('topics').select('id, name, default_sequence').order('default_sequence'),
    supabase.from('curriculum_readings').select('id, reading_no, topic_id, title').eq('is_active', true).order('reading_no'),
    supabase.from('reading_los').select('id, reading_id, code, title, sequence').order('sequence'),
  ])
  if (topicsRes.error || readingsRes.error || losRes.error) {
    return NextResponse.json({ error: 'Could not load the curriculum.' }, { status: 500 })
  }

  const outcomesByReading = new Map<string, { id: string; code: string; title: string }[]>()
  for (const l of losRes.data ?? []) {
    const list = outcomesByReading.get(l.reading_id as string) ?? []
    list.push({ id: l.id as string, code: (l.code ?? '') as string, title: l.title as string })
    outcomesByReading.set(l.reading_id as string, list)
  }
  const readings = (readingsRes.data ?? []).map(r => ({
    id: r.id as string, no: r.reading_no as number, title: r.title as string, topicId: r.topic_id as string,
    outcomes: outcomesByReading.get(r.id as string) ?? [],
  }))
  const topicName = new Map((topicsRes.data ?? []).map(t => [t.id as string, t.name as string]))

  return NextResponse.json({
    topics: (topicsRes.data ?? []).map(t => ({
      id: t.id as string, name: t.name as string,
      readings: readings.filter(r => r.topicId === t.id).map(({ topicId: _t, ...r }) => r),
    })),
    modules: readings.map(r => ({ id: r.id, name: r.title, topic: topicName.get(r.topicId) ?? r.topicId })),
  })
}

const legacySchema = z.object({
  activity_type: z.enum(['class', 'independent_study', 'external_practice']),
  description: z.string().min(1).max(1000),
  lm_id: z.string().optional(),
  related_task_id: z.string().min(1).optional(),
  duration_minutes: z.number().int().min(1).max(720).optional(),
  self_reported_confidence: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
})

const entrySchema = z.object({
  activity_type: z.enum(['class', 'independent_study', 'external_practice']),
  reading_id: z.string().min(1),
  outcome_ids: z.array(z.string().min(1)).min(1).max(40),
  duration_minutes: z.number().int().min(5).max(720).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(1000).optional(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,60}$/),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const json = await request.json().catch(() => null)
  if (!json) return NextResponse.json({ error: 'Invalid data' }, { status: 400 })

  // Outcome-level log: activity + coverage + completed Calendar blocks, atomically.
  if (Array.isArray(json.outcome_ids)) {
    const parsed = entrySchema.safeParse(json)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid data', issues: parsed.error.issues }, { status: 400 })
    const e = parsed.data
    const { data: profile } = await supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle()
    const date = e.date ?? todayInZone((profile?.timezone as string | null) ?? 'UTC')
    const kindLabel = e.activity_type === 'class' ? 'Class' : e.activity_type === 'external_practice' ? 'Practice' : 'Study'
    const description = e.note?.trim() || `${kindLabel}: ${e.outcome_ids.length} outcome${e.outcome_ids.length === 1 ? '' : 's'}`

    const { data, error } = await supabase.rpc('log_learning_entry', {
      p_activity_type: e.activity_type,
      p_description: description,
      p_lm_id: e.reading_id,
      p_outcome_ids: e.outcome_ids,
      p_duration_minutes: e.duration_minutes ?? null,
      p_local_date: date,
      p_idempotency_key: e.idempotency_key,
    })
    if (error) {
      const known = /not all part of this reading|Choose a current curriculum module|within the last two weeks|Choose between/.exec(error.message)
      return NextResponse.json({ error: known ? known[0] : 'Could not save that. Nothing was recorded.' }, { status: known ? 400 : 500 })
    }
    const result = data as { blocks: number; inCycle?: boolean; replayed: boolean }
    return NextResponse.json({ ok: true, outcomes: result.blocks, inCycle: result.inCycle ?? true, replayed: result.replayed, date, evidenceRecorded: false })
  }

  // Older contract: activity + optional module coverage, no Calendar blocks.
  const parsed = legacySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid data', issues: parsed.error.issues }, { status: 400 })
  const { activity_type, description, lm_id, related_task_id, duration_minutes, self_reported_confidence } = parsed.data
  const { data: activityId, error: insertError } = await supabase.rpc('log_learning_with_coverage', {
    p_activity_type: activity_type,
    p_description: description,
    p_lm_id: lm_id || null,
    p_related_task_id: related_task_id || null,
    p_duration_minutes: duration_minutes ?? null,
    p_self_reported_confidence: self_reported_confidence || null,
  })
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
  return NextResponse.json({ activityId, coverageUpdated: Boolean(lm_id), evidenceRecorded: false })
}

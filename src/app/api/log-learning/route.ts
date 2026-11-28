import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { todayInZone } from '../../../lib/planning/studyWeek'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import { LearningLogError, learningLogSchema, recordLearning } from '../../../lib/learning/log'

export const dynamic = 'force-dynamic'

const STUDY_TYPES = ['study', 'review', 'class_consolidation', 'verification']
type Db = Awaited<ReturnType<typeof createClient>>

async function readingWithOutcomes(db: Db, readingId: string) {
  // Independent reads, one round trip. An unstructured reading simply discards its outcomes.
  const [{ data: reading }, { data: outcomes }] = await Promise.all([
    db.from('curriculum_readings').select('id,reading_no,topic_id,title,structure_pending').eq('id', readingId).eq('is_active', true).maybeSingle().throwOnError(),
    db.from('reading_los').select('id,code,title').eq('reading_id', readingId).order('sequence').order('id').limit(80).throwOnError(),
  ])
  if (!reading) return null
  return { id: reading.id, no: reading.reading_no, topicId: reading.topic_id, title: reading.title,
    outcomes: reading.structure_pending ? [] : (outcomes ?? []).map(o => ({ id: o.id, code: o.code, title: o.title })) }
}

/**
 * Bounded reads, one purpose each. No mode loads the whole curriculum:
 *   (none)        open blocks of the active week and a few recent readings
 *   ?task=ID      one owned block and only its outstanding outcomes
 *   ?reading=ID   one reading and its outcomes
 *   ?q=text       up to 12 matching readings, without outcomes
 */
export async function GET(request: Request) {
  const db = await createClient()
  const access = await requireApplicationAccess(db)
  if (!access.ok) return access.response
  const params = new URL(request.url).searchParams
  const fail = () => NextResponse.json({ ok: false, error: 'This could not be loaded. Try again.' }, { status: 503 })
  try {
    const { data: profile } = await db.from('profiles').select('timezone').eq('id', access.user.id).maybeSingle().throwOnError()
    const base = { ownerId: access.user.id, today: todayInZone(profile?.timezone ?? 'UTC') }

    const readingId = params.get('reading')
    if (readingId) {
      const reading = await readingWithOutcomes(db, readingId.slice(0, 180))
      return reading ? NextResponse.json({ ok: true, ...base, reading }) : NextResponse.json({ ok: false, error: 'That reading was not found.' }, { status: 404 })
    }

    const q = params.get('q')?.trim()
    if (q) {
      const term = q.slice(0, 60).replace(/[%,()*\\]/g, ' ').trim()
      let query = db.from('curriculum_readings').select('id,reading_no,topic_id,title').eq('is_active', true).eq('structure_pending', false)
      query = /^\d{1,4}$/.test(term) ? query.eq('reading_no', Number(term)) : query.ilike('title', `%${term}%`)
      const { data } = await query.order('reading_no').limit(12).throwOnError()
      return NextResponse.json({ ok: true, ...base, readings: (data ?? []).map(r => ({ id: r.id, no: r.reading_no, topicId: r.topic_id, title: r.title })) })
    }

    const taskId = params.get('task')
    if (taskId) {
      const { data: task } = await db.from('plan_blocks')
        .select('id,title,local_date,duration_minutes,execution,revision,task_type,lm_id,outcome_id,cycle_id,cancelled_at,learning_activity_id,is_protected_commitment')
        .eq('id', taskId.slice(0, 180)).eq('user_id', access.user.id).maybeSingle().throwOnError()
      if (!task) return NextResponse.json({ ok: false, error: 'That block was not found.' }, { status: 404 })
      // Everything below depends only on the task row, so it is one parallel round trip.
      const [{ data: cycle }, { data: next }, { data: saved }, viaOutcome] = await Promise.all([
        task.cycle_id ? db.from('planning_cycles').select('id').eq('id', task.cycle_id).eq('user_id', access.user.id).eq('status', 'active').maybeSingle().throwOnError() : Promise.resolve({ data: null }),
        db.from('plan_blocks').select('id').eq('user_id', access.user.id).eq('continued_from_task_id', task.id).limit(1).throwOnError(),
        db.from('block_scope_confirmations').select('outcome_id').eq('block_id', task.id).eq('user_id', access.user.id).throwOnError(),
        !task.lm_id && task.outcome_id ? db.from('reading_los').select('reading_id').eq('id', task.outcome_id).maybeSingle().throwOnError() : Promise.resolve({ data: null }),
      ])
      const reason = task.cancelled_at || task.is_protected_commitment || !STUDY_TYPES.includes(task.task_type ?? '') ? 'This block cannot be logged as study.'
        : task.learning_activity_id ? 'This is recorded learning.'
        : next?.length ? 'This task continues in a later week. Open the continuation instead.'
        : !cycle ? 'This block belongs to an earlier week. Log a separate session instead.' : null
      const readingKey = task.lm_id ?? (viaOutcome.data as any)?.reading_id ?? null
      const reading = readingKey ? await readingWithOutcomes(db, readingKey) : null
      return NextResponse.json({ ok: true, ...base, blocked: reason,
        task: { id: task.id, title: task.title, date: task.local_date, minutes: task.duration_minutes, execution: task.execution, revision: task.revision, outcomeId: task.outcome_id },
        reading: reading && { ...reading, outcomes: reading.outcomes.filter(o => !task.outcome_id || o.id === task.outcome_id) },
        confirmed: (saved ?? []).map(s => s.outcome_id) })
    }

    const { data: cycle } = await db.from('planning_cycles').select('id').eq('user_id', access.user.id).eq('status', 'active').maybeSingle().throwOnError()
    const [{ data: blocks }, { data: recent }] = await Promise.all([
      cycle ? db.from('plan_blocks').select('id,title,local_date,duration_minutes,execution,revision')
        .eq('user_id', access.user.id).eq('cycle_id', cycle.id).is('cancelled_at', null).is('learning_activity_id', null).eq('is_protected_commitment', false)
        .in('task_type', STUDY_TYPES).in('execution', ['not_started', 'in_progress', 'partial']).order('local_date').order('starts_at').limit(40).throwOnError()
        : Promise.resolve({ data: [] as any[] }),
      db.from('learning_activities').select('lm_id').eq('user_id', access.user.id).not('lm_id', 'is', null).order('created_at', { ascending: false }).limit(20).throwOnError(),
    ])
    const ids = (blocks ?? []).map(b => b.id)
    const { data: continued } = ids.length ? await db.from('plan_blocks').select('continued_from_task_id').eq('user_id', access.user.id).in('continued_from_task_id', ids).throwOnError() : { data: [] as any[] }
    const gone = new Set((continued ?? []).map(c => c.continued_from_task_id))
    const recentIds = [...new Set((recent ?? []).map(r => r.lm_id as string))].slice(0, 5)
    const { data: recentReadings } = recentIds.length ? await db.from('curriculum_readings').select('id,reading_no,topic_id,title').in('id', recentIds).eq('is_active', true).eq('structure_pending', false).throwOnError() : { data: [] as any[] }
    return NextResponse.json({ ok: true, ...base,
      blocks: (blocks ?? []).filter(b => !gone.has(b.id)).map(b => ({ id: b.id, title: b.title, date: b.local_date, minutes: b.duration_minutes, execution: b.execution })),
      recent: recentIds.map(id => (recentReadings ?? []).find(r => r.id === id)).filter(Boolean).map((r: any) => ({ id: r.id, no: r.reading_no, topicId: r.topic_id, title: r.title })) })
  } catch { return fail() }
}

export async function POST(request: Request) {
  const db = await createClient()
  const access = await requireApplicationAccess(db)
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null)
  if (body && !Array.isArray(body.outcome_ids)) return NextResponse.json({ok:false,code:'OUTCOMES_REQUIRED',error:'Choose the outcomes you covered in the current learning form. Whole-reading logging has been retired.'},{status:409})
  const parsed = learningLogSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ok:false,error:'Choose a reading, covered outcomes and valid optional minutes (1–720).'}, {status:400})
  try { return NextResponse.json({ action: 'separate', ...(await recordLearning(db,parsed.data)) }) }
  catch (error) {
    return NextResponse.json({ok:false,code:error instanceof LearningLogError ? error.code : 'SAVE_UNCONFIRMED',
      error:error instanceof LearningLogError ? error.message : 'Could not confirm the save. Retry the same log to check safely.'}, {status:error instanceof LearningLogError ? error.status : 503})
  }
}

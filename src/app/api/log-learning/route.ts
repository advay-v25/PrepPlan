import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { todayInZone } from '../../../lib/planning/studyWeek'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import { LearningLogError, learningLogSchema, recordLearning } from '../../../lib/learning/log'
import { readAll } from '../../../lib/supabase/readAll'

export const dynamic = 'force-dynamic'

/** The shared picker uses the student's local date and the canonical full outcome list. */
export async function GET() {
  const db = await createClient()
  const access = await requireApplicationAccess(db)
  if (!access.ok) return access.response
  try {
    const [{ data: topics }, { data: readings }, outcomes, { data: profile }] = await Promise.all([
      db.from('topics').select('id,name,default_sequence').order('default_sequence').throwOnError(),
      db.from('curriculum_readings').select('id,reading_no,topic_id,title,structure_pending').eq('is_active',true).order('reading_no').throwOnError(),
      readAll<any>((a,z) => db.from('reading_los').select('id,reading_id,code,title,sequence').order('sequence').order('id').range(a,z)),
      db.from('profiles').select('timezone').eq('id', access.user.id).maybeSingle().throwOnError(),
    ])
    const byReading = new Map<string, typeof outcomes>()
    for (const o of outcomes) byReading.set(o.reading_id, [...(byReading.get(o.reading_id) ?? []), o])
    const list = (readings ?? []).map(r => ({ id:r.id,no:r.reading_no,title:r.title,topicId:r.topic_id,
      outcomes:r.structure_pending ? [] : (byReading.get(r.id) ?? []).map(o => ({id:o.id,code:o.code,title:o.title})) }))
    return NextResponse.json({ ownerId:access.user.id, today:todayInZone(profile?.timezone ?? 'UTC'),
      topics:(topics ?? []).map(t => ({id:t.id,name:t.name,readings:list.filter(r => r.topicId===t.id)})),
      modules:list.map(r => ({id:r.id,name:r.title,topic:topics?.find(t => t.id===r.topicId)?.name ?? r.topicId})),
    })
  } catch { return NextResponse.json({ ok:false,error:'The curriculum could not be loaded. Try again.' },{status:503}) }
}

export async function POST(request: Request) {
  const db = await createClient()
  const access = await requireApplicationAccess(db)
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null)
  if (body && !Array.isArray(body.outcome_ids)) return NextResponse.json({ok:false,code:'OUTCOMES_REQUIRED',error:'Choose the outcomes you covered in the current learning form. Whole-reading logging has been retired.'},{status:409})
  const parsed = learningLogSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ok:false,error:'Choose a reading, covered outcomes and valid optional minutes (1–720).'}, {status:400})
  try { return NextResponse.json(await recordLearning(db,parsed.data)) }
  catch (error) {
    return NextResponse.json({ok:false,code:error instanceof LearningLogError ? error.code : 'SAVE_UNCONFIRMED',
      error:error instanceof LearningLogError ? error.message : 'Could not confirm the save. Retry the same log to check safely.'}, {status:error instanceof LearningLogError ? error.status : 503})
  }
}

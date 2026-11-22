import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { LearningLogError, learningLogSchema, recordLearning } from '../../../../../lib/learning/log'

export const dynamic = 'force-dynamic'

/** Compatibility adapter. The UI now opens the same learning sheet as Home and Calendar. */
export async function POST(request: Request) {
  const db = await createClient()
  const access = await requireApplicationAccess(db)
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null)
  const parsed = learningLogSchema.omit({ reading_id: true }).safeParse({
    activity_type: 'independent_study', outcome_ids: body?.outcomeIds,
    duration_minutes: body?.minutes, idempotency_key: body?.idempotencyKey,
  })
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Choose covered outcomes and optional whole minutes (1–720).' }, { status: 400 })
  try {
    const { data: outcomes } = await db.from('reading_los').select('id,reading_id').in('id', [...new Set(parsed.data.outcome_ids)]).throwOnError()
    const readings = new Set((outcomes ?? []).map(o => o.reading_id as string))
    if (readings.size !== 1 || outcomes?.length !== new Set(parsed.data.outcome_ids).size) return NextResponse.json({ ok: false, error: 'Log one reading per sitting, choosing its covered outcomes.' }, { status: 400 })
    return NextResponse.json(await recordLearning(db, { ...parsed.data, reading_id: [...readings][0] }))
  } catch (error) {
    return NextResponse.json({ ok: false, code: error instanceof LearningLogError ? error.code : 'SAVE_UNCONFIRMED',
      error: error instanceof LearningLogError ? error.message : 'Could not confirm the save. Retry the same log to check safely.' }, { status: error instanceof LearningLogError ? error.status : 503 })
  }
}

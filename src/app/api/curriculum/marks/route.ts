import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { SELF_MARKS, type SelfMark } from '../../../../lib/curriculum/confidence'

export const dynamic = 'force-dynamic'

/**
 * The student's own overall confidence mark for an outcome or a reading.
 * Self-report: stored beside the evidence and verified against it; it never
 * changes evidence or a band. POST only.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as any
  if (!body || !['outcome', 'reading'].includes(body.scopeType) || typeof body.scopeId !== 'string'
    || body.scopeId.length > 60 || !SELF_MARKS.includes(body.level as SelfMark)) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const exists = body.scopeType === 'outcome'
    ? await admin.from('reading_los').select('id').eq('id', body.scopeId).maybeSingle()
    : await admin.from('curriculum_readings').select('id').eq('id', body.scopeId).eq('structure_pending', false).maybeSingle()
  if (!exists.data) return NextResponse.json({ ok: false, error: 'Unknown outcome or reading.' }, { status: 404 })

  // Own-row upsert through the caller's session, so RLS is the ownership check.
  const { data: current } = await supabase.from('confidence_marks').select('revision')
    .eq('scope_type', body.scopeType).eq('scope_id', body.scopeId).maybeSingle()
  const { error } = await supabase.from('confidence_marks').upsert({
    user_id: user.id, scope_type: body.scopeType, scope_id: body.scopeId, level: body.level,
    revision: ((current?.revision as number | undefined) ?? 0) + 1, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,scope_type,scope_id' })
  if (error) {
    const requestId = crypto.randomUUID()
    console.error(`[curriculum/marks ${requestId}]`, error.message)
    return NextResponse.json({ ok: false, error: 'Could not save your mark.', requestId }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

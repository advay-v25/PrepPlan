import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'

/**
 * Where the student says they already are.
 *
 * A self-report is context, never evidence — it is stored with its source so
 * nothing downstream can mistake "I ticked studied" for "a diagnostic showed
 * this holds". Only a diagnostic writes 'verified'.
 */
const SELF_REPORTABLE = ['not_started', 'taught', 'studied', 'decaying']

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const updates: { lmId: string; state: string }[] = Array.isArray(body.updates)
    ? body.updates
    : body.lmId ? [{ lmId: body.lmId, state: body.state }] : []

  if (updates.length === 0) return NextResponse.json({ ok: false, error: 'Nothing to record' }, { status: 400 })

  for (const u of updates) {
    if (!u.lmId || !SELF_REPORTABLE.includes(u.state)) {
      return NextResponse.json(
        { ok: false, error: `"${u.state}" is not something you can set yourself. Only a diagnostic marks a module verified.` },
        { status: 400 }
      )
    }
  }

  const admin = createAdminClient()
  const ids = updates.map(u => u.lmId)
  const { data: known } = await admin.from('learning_modules').select('id').in('id', ids)
  const knownIds = new Set((known ?? []).map(m => m.id as string))
  const unknown = ids.filter(id => !knownIds.has(id))
  if (unknown.length > 0) {
    return NextResponse.json({ ok: false, error: `Unknown module: ${unknown[0]}` }, { status: 400 })
  }

  const { error } = await admin.from('user_module_state').upsert(
    updates.map(u => ({
      user_id: user.id,
      lm_id: u.lmId,
      coverage_state: u.state,
      source: 'self_report',
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'user_id,lm_id' }
  )
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, updated: updates.length })
}

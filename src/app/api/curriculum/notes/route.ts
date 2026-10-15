import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { validateNoteDoc } from '../../../../lib/curriculum/notes/doc'
import { isScopeType, scopeExists } from '../../../../lib/curriculum/scope'

export const dynamic = 'force-dynamic'

/** Read one note (own rows only, via RLS). */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const scopeType = url.searchParams.get('scopeType'), scopeId = url.searchParams.get('scopeId') ?? ''
  if (!isScopeType(scopeType) || !(await scopeExists(scopeType, scopeId))) return NextResponse.json({ ok: false, error: 'Unknown subject or reading.' }, { status: 404 })
  const { data } = await supabase.from('curriculum_notes').select('doc, revision, updated_at').eq('scope_type', scopeType).eq('scope_id', scopeId).maybeSingle()
  return NextResponse.json({ ok: true, doc: data?.doc ?? null, revision: (data?.revision as number | undefined) ?? 0 })
}

/**
 * Autosave with a revision guard. Body: { scopeType, scopeId, doc, expectedRevision }.
 * expectedRevision 0 means "no note yet". A stale revision is a 409 carrying the
 * current note, so the editor can offer to reload instead of overwriting.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as any
  if (!body || !isScopeType(body.scopeType) || typeof body.scopeId !== 'string' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  if (!(await scopeExists(body.scopeType, body.scopeId))) return NextResponse.json({ ok: false, error: 'Unknown subject or reading.' }, { status: 404 })
  const checked = validateNoteDoc(body.doc)
  if (!checked.ok) return NextResponse.json({ ok: false, error: checked.reason }, { status: 400 })

  const requestId = crypto.randomUUID()
  const stale = async () => {
    const { data } = await supabase.from('curriculum_notes').select('doc, revision').eq('scope_type', body.scopeType).eq('scope_id', body.scopeId).maybeSingle()
    return NextResponse.json({ ok: false, code: 'stale_revision', error: 'This note changed somewhere else.', doc: data?.doc ?? null, revision: (data?.revision as number | undefined) ?? 0 }, { status: 409 })
  }

  if (body.expectedRevision === 0) {
    const { error } = await supabase.from('curriculum_notes').insert({ user_id: user.id, scope_type: body.scopeType, scope_id: body.scopeId, doc: checked.doc, revision: 1 })
    if (error) {
      if (error.code === '23505') return stale()
      console.error(`[curriculum/notes ${requestId}]`, error.message)
      return NextResponse.json({ ok: false, error: 'Could not save.', requestId }, { status: 500 })
    }
    return NextResponse.json({ ok: true, revision: 1 })
  }
  const { data, error } = await supabase.from('curriculum_notes')
    .update({ doc: checked.doc, revision: body.expectedRevision + 1, updated_at: new Date().toISOString() })
    .eq('scope_type', body.scopeType).eq('scope_id', body.scopeId).eq('revision', body.expectedRevision).select('revision')
  if (error) { console.error(`[curriculum/notes ${requestId}]`, error.message); return NextResponse.json({ ok: false, error: 'Could not save.', requestId }, { status: 500 }) }
  if (!data || data.length === 0) return stale()
  return NextResponse.json({ ok: true, revision: data[0].revision })
}

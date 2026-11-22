import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { canonicalJson, MAX_DOC_BYTES, validateNoteDoc } from '../../../../lib/curriculum/notes/doc'
import { checkScope, isScopeType, scopeProblem } from '../../../../lib/curriculum/scope'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { JsonInputError, readBoundedJson } from '../../../../lib/auth/requestSecurity'

export const dynamic = 'force-dynamic'

/** Read one note (own rows only, via RLS). */
export async function GET(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const url = new URL(request.url)
  const scopeType = url.searchParams.get('scopeType'), scopeId = url.searchParams.get('scopeId') ?? ''
  if (!isScopeType(scopeType)) return NextResponse.json({ ok: false, error: 'Unknown subject or reading.' }, { status: 404 })
  const sc = await checkScope(scopeType, scopeId); if (sc !== 'ok') { const p = scopeProblem(sc); return NextResponse.json(p.body, { status: p.status }) }
  const { data, error } = await supabase.from('curriculum_notes').select('doc, revision, updated_at').eq('scope_type', scopeType).eq('scope_id', scopeId).maybeSingle()
  // A failed read is not "no note yet": the editor must not start a blank replacement.
  if (error) return NextResponse.json({ ok: false, code: 'unavailable', error: 'Your note could not be loaded. Nothing was changed; try again shortly.' }, { status: 503 })
  return NextResponse.json({ ok: true, doc: data?.doc ?? null, revision: (data?.revision as number | undefined) ?? 0 })
}

/**
 * Autosave with a revision guard. Body: { scopeType, scopeId, doc, expectedRevision }.
 * expectedRevision 0 means "no note yet". A stale revision is a 409 carrying the
 * current note, so the editor can offer to reload instead of overwriting.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user
  let body: { scopeType?: unknown; scopeId?: unknown; expectedRevision?: unknown; doc?: unknown } | null
  try { body = await readBoundedJson(request, MAX_DOC_BYTES + 4096) as typeof body }
  catch (error) {
    if (error instanceof JsonInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  if (!body || typeof body.scopeType !== 'string' || !isScopeType(body.scopeType) || typeof body.scopeId !== 'string'
    || typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= 2_147_483_647) {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  const { scopeType, scopeId, expectedRevision } = body
  const sc = await checkScope(scopeType, scopeId); if (sc !== 'ok') { const p = scopeProblem(sc); return NextResponse.json(p.body, { status: p.status }) }
  const checked = validateNoteDoc(body.doc)
  if (!checked.ok) return NextResponse.json({ ok: false, error: checked.reason }, { status: 400 })

  const requestId = crypto.randomUUID()
  // Write authority is server-only. Every operation is explicitly tied to the verified owner.
  const admin = createAdminClient()
  const stale = async () => {
    const { data, error } = await supabase.from('curriculum_notes').select('doc, revision').eq('user_id', user.id).eq('scope_type', scopeType).eq('scope_id', scopeId).maybeSingle()
    if (error) return NextResponse.json({ ok: false, code: 'unavailable', error: 'The current note could not be checked. Keep your draft and try again.' }, { status: 503 })
    // A retry after a committed save (the response was lost): the stored note IS this document, so the save already happened.
    if (data && canonicalJson(data.doc) === canonicalJson(checked.doc)) return NextResponse.json({ ok: true, revision: data.revision as number, replayed: true })
    return NextResponse.json({ ok: false, code: 'stale_revision', error: 'This note changed somewhere else.', doc: data?.doc ?? null, revision: (data?.revision as number | undefined) ?? 0 }, { status: 409 })
  }

  if (expectedRevision === 0) {
    const { error } = await admin.from('curriculum_notes').insert({ user_id: user.id, scope_type: scopeType, scope_id: scopeId, doc: checked.doc, revision: 1 })
    if (error) {
      if (error.code === '23505') return stale()
      console.error(`[curriculum/notes ${requestId}]`, error.message)
      return NextResponse.json({ ok: false, error: 'Could not save.', requestId }, { status: 500 })
    }
    return NextResponse.json({ ok: true, revision: 1 })
  }
  const { data, error } = await admin.from('curriculum_notes')
    .update({ doc: checked.doc, revision: expectedRevision + 1, updated_at: new Date().toISOString() })
    .eq('user_id', user.id).eq('scope_type', scopeType).eq('scope_id', scopeId).eq('revision', expectedRevision).select('revision')
  if (error) { console.error(`[curriculum/notes ${requestId}]`, error.message); return NextResponse.json({ ok: false, error: 'Could not save.', requestId }, { status: 500 }) }
  if (!data || data.length === 0) return stale()
  return NextResponse.json({ ok: true, revision: data[0].revision })
}

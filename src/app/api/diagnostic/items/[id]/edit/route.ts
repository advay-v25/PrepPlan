import { NextResponse } from 'next/server'
import { commandResponse, reviewerRoute } from '../../../../../../lib/diagnostic/reviewApi'
import { createAdminClient } from '../../../../../../lib/supabase/admin'
import { semanticFingerprint } from '../../../../../../lib/diagnostic/generator'

const FIELDS = ['stem', 'options', 'key_index', 'per_option_feedback', 'item_card', 'outcome_id', 'concept_id', 'cognition', 'item_form', 'intended_difficulty'] as const

/** Edit an item. A published or used item gets a NEW candidate version; an unpublished one changes in place and must be re-checked. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await reviewerRoute()
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await req.json().catch(() => ({} as any))
  const expectedVersion = Number(body.expectedVersion)
  if (!Number.isInteger(expectedVersion) || typeof body.patch !== 'object' || !body.patch) return NextResponse.json({ ok: false, error: 'expectedVersion and patch are required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  for (const f of FIELDS) if (f in body.patch) patch[f] = body.patch[f]
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: 'Nothing to change' }, { status: 400 })
  if (typeof patch.stem === 'string' || Array.isArray(patch.options)) {
    const { data: cur } = await createAdminClient().from('assessment_items').select('stem, options').eq('id', id).maybeSingle()
    patch.semantic_fingerprint = semanticFingerprint(String(patch.stem ?? cur?.stem ?? ''), (patch.options as string[] | undefined) ?? (cur?.options as string[]) ?? [])
  }
  const { data, error } = await auth.supabase.rpc('edit_item', { p_item_id: id, p_expected_version: expectedVersion, p_patch: patch, p_note: typeof body.note === 'string' ? body.note.slice(0, 2000) : '' })
  return commandResponse(data, error)
}

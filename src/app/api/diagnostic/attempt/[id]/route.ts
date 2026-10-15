import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../lib/supabase/admin'

/**
 * Serves the next unanswered item on an attempt, plus progress.
 *
 * The key, the per-option feedback, and the item card never appear in this
 * response. They are read on the result page, after the attempt is scored.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id: attemptId } = await params

  // Ownership is enforced here, through the user's own client.
  const { data: attempt, error: attemptErr } = await supabase
    .from('assessment_attempts')
    .select(`
      id, status, delivery_mode, started_at, form_id,
      form:assessment_forms (
        id,
        blueprint:assessment_blueprints ( purpose, requested_scope )
      )
    `)
    .eq('id', attemptId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (attemptErr) return NextResponse.json({ ok: false, error: attemptErr.message }, { status: 500 })
  if (!attempt) return NextResponse.json({ ok: false, error: 'Attempt not found' }, { status: 404 })

  const { data: responses } = await supabase
    .from('assessment_responses')
    .select('item_id')
    .eq('attempt_id', attemptId)

  // form_items is deliberately not readable from a browser — it maps a form to
  // its questions — so it is read with the service role after the ownership
  // check above has already passed.
  const admin = createAdminClient()
  const { data: formItemRows } = await admin
    .from('form_items')
    .select('item_id, sequence_number')
    .eq('form_id', attempt.form_id)

  const answered = new Set((responses ?? []).map(r => r.item_id as string))
  const form = attempt.form as any
  const formItems = ((formItemRows ?? []) as { item_id: string; sequence_number: number }[])
    .slice()
    .sort((a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0))

  const nextRef = formItems.find(fi => !answered.has(fi.item_id))

  let nextItem: any = null
  if (nextRef) {
    const { data: item } = await admin
      .from('assessment_items')
      .select('id, stem, options, cognition, item_form, intended_difficulty, concept:curriculum_concepts ( name )')
      .eq('id', nextRef.item_id)
      .maybeSingle()

    if (item) {
      nextItem = {
        id: item.id,
        stem: item.stem,
        options: item.options,
        cognition: item.cognition,
        itemForm: item.item_form,
        intendedDifficulty: item.intended_difficulty,
        conceptName: (item.concept as any)?.name ?? null,
        sequenceNumber: nextRef.sequence_number,
      }
    }
  }

  return NextResponse.json({
    ok: true,
    attempt: {
      id: attempt.id,
      status: attempt.status,
      deliveryMode: attempt.delivery_mode,
      purpose: form?.blueprint?.purpose ?? null,
      answeredCount: answered.size,
      totalCount: formItems.length,
    },
    nextItem,
  })
}

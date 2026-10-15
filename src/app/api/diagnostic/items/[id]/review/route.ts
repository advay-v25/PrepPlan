import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../../lib/supabase/admin'
import { checkIsReviewer } from '../../../../../../lib/diagnostic/reviewAccess'

/**
 * Promotes a verifier-passed item to reviewed (gold), or retires it.
 *
 * Every decision is written to item_validations as a human_reviewer row, which
 * is what makes verifier–human agreement measurable: for each item the verifier
 * passed, there is now a record of whether a person agreed.
 *
 * §5.1: an item cannot be promoted while the concept behind it is itself
 * unverified, because the manifest is the verifier's ground truth. Approving an
 * item against an unverified concept would launder an unchecked scope claim
 * into gold.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const isRev = await checkIsReviewer(user.id)
  if (!isRev) {
    return NextResponse.json({ ok: false, error: 'You are not a reviewer for this curriculum' }, { status: 403 })
  }

  const { id: itemId } = await params
  const body = await req.json().catch(() => ({} as any))
  const decision: string = body.decision
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''

  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ ok: false, error: 'decision must be "approve" or "reject"' }, { status: 400 })
  }
  if (decision === 'reject' && note.length < 3) {
    return NextResponse.json({ ok: false, error: 'Rejecting an item needs a reason — it is the training signal' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: item } = await admin
    .from('assessment_items')
    .select('id, review_status, concept_id')
    .eq('id', itemId)
    .maybeSingle()

  if (!item) return NextResponse.json({ ok: false, error: 'Unknown item' }, { status: 404 })
  if (item.review_status !== 'verified') {
    return NextResponse.json(
      { ok: false, error: `This item is "${item.review_status}", not awaiting review` },
      { status: 409 }
    )
  }

  if (decision === 'approve') {
    if (!item.concept_id) {
      return NextResponse.json({ ok: false, error: 'This item is not mapped to a curriculum concept' }, { status: 409 })
    }
    const { data: concept } = await admin
      .from('curriculum_concepts')
      .select('verification_status, name')
      .eq('id', item.concept_id)
      .maybeSingle()

    if (concept?.verification_status !== 'verified') {
      return NextResponse.json(
        {
          ok: false,
          error: `The concept "${concept?.name ?? item.concept_id}" has not been verified yet. Verify the manifest entry before promoting items against it.`,
          code: 'CONCEPT_UNVERIFIED',
        },
        { status: 409 }
      )
    }
  }

  const now = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('assessment_items')
    .update(
      decision === 'approve'
        ? { review_status: 'reviewed', reviewed_at: now }
        : { review_status: 'deprecated', reviewed_at: now }
    )
    .eq('id', itemId)

  if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 })

  await admin.from('item_validations').insert({
    item_id: itemId,
    reviewer_role: 'human_reviewer',
    status: decision === 'approve' ? 'PASS' : 'VOID',
    defect_codes: decision === 'reject' ? ['HUMAN_REJECTED'] : [],
    detail: { decision, note, reviewerId: user.id, at: now },
  })

  return NextResponse.json({ ok: true, itemId, reviewStatus: decision === 'approve' ? 'reviewed' : 'deprecated' })
}

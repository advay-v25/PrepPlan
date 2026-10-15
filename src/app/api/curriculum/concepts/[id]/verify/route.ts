import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../../lib/supabase/admin'
import { checkIsReviewer } from '../../../../../../lib/diagnostic/reviewAccess'

/**
 * Signs off one manifest concept (§5.1).
 *
 * The manifest is the verifier's ground truth: a scope error here is invisible
 * to every automated gate downstream, because the gates check against it. So a
 * concept must be read by a person before any item written against it can
 * become gold — and until that happens, item review is deliberately blocked.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const isRev = await checkIsReviewer(user.id)
  if (!isRev) {
    return NextResponse.json({ ok: false, error: 'You are not a reviewer for this curriculum' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({} as any))
  const verified = body.verified !== false

  const admin = createAdminClient()
  const { data: concept } = await admin
    .from('curriculum_concepts')
    .select('id, name, scope_notes, verification_status')
    .eq('id', id)
    .maybeSingle()

  if (!concept) return NextResponse.json({ ok: false, error: 'Unknown concept' }, { status: 404 })

  // Verifying a concept with no written scope would sign off on nothing.
  if (verified && !concept.scope_notes) {
    return NextResponse.json(
      { ok: false, error: 'This concept has no scope written for it yet. There is nothing to verify.' },
      { status: 409 }
    )
  }

  const { error } = await admin
    .from('curriculum_concepts')
    .update({ verification_status: verified ? 'verified' : 'drafted' })
    .eq('id', id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id, verificationStatus: verified ? 'verified' : 'drafted' })
}

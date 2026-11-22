import { NextResponse } from 'next/server'
import { withOwnedAttempt } from '../../../../../../lib/tests/attemptAccess'

export const dynamic = 'force-dynamic'

/** Records that the student opened their scored result (once). It completes the "see your result" step Home recommends; it changes no score or evidence. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await withOwnedAttempt(id)
  if (!a.ok) return a.response
  if (a.attempt.status !== 'scored') return NextResponse.json({ ok: true, recorded: false })
  await a.admin.from('assessment_attempts').update({ result_viewed_at: new Date().toISOString() }).eq('id', id).eq('user_id', a.userId).is('result_viewed_at', null)
  return NextResponse.json({ ok: true, recorded: true })
}

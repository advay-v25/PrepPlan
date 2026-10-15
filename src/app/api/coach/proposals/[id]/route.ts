import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { decideProposal } from '../../../../../lib/coach/service'

export const dynamic = 'force-dynamic'

/** POST only. The student's confirmation (or dismissal) is the one thing that changes anything. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({} as any))
  if (body.decision !== 'accept' && body.decision !== 'reject') return NextResponse.json({ ok: false, error: 'decision must be accept or reject' }, { status: 400 })

  const r = await decideProposal(user.id, id, body.decision)
  if (r.ok) return NextResponse.json(r)
  return NextResponse.json(r, { status: r.code === 'NOT_FOUND' ? 404 : r.code === 'STALE' ? 409 : 400 })
}

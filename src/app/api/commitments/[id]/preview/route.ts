import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { previewClassChange } from '../../../../../lib/planning/classChange'

export const dynamic = 'force-dynamic'

/** Read-only: what a class change would do (old/new sessions, booked-mock conflicts, affected timed work). Writes nothing. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, code: 'INVALID_INPUT', error: 'The change is incomplete.' }, { status: 400 })
  const r = await previewClassChange(access.user.id, id, body as Record<string, unknown>)
  return NextResponse.json(r.body, { status: r.status })
}

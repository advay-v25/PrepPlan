import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../../lib/auth/applicationAccess'
import { stopAdaptive } from '../../../../../../lib/tests/adaptivePractice'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

/** Idempotent boundary stop: only between sets. An open set is left or submitted, never discarded or secretly scored by this button. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const { id } = await params
  const body = await request.json().catch(() => null) as any
  if (!UUID.test(id)) return NextResponse.json({ ok: false, code: 'not_found', message: 'Not found.' }, { status: 404 })
  const r = await stopAdaptive(access.user.id, id, Number.isInteger(body?.expectedRevision) ? body.expectedRevision : null)
  return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: r.code === 'failed' ? 500 : r.code === 'not_found' ? 404 : 409 })
}

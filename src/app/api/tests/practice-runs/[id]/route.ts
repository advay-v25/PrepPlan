import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { runState } from '../../../../../lib/tests/adaptivePractice'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

/** Owned state of an adaptive practice run: completed sets, the pending next-set preview and the permitted action. Read-only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 })
  const s = await runState(access.user.id, id)
  return s ? NextResponse.json({ ok: true, run: s }) : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 })
}

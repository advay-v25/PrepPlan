import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { placeRepairCheck } from '../../../../../lib/repairs/service'

export const dynamic = 'force-dynamic'

/** Adds the re-check for finished repairs to the open week. Body: { threadIds, idempotencyKey } */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const b = await request.json().catch(() => null) as any
  if (!b || !Array.isArray(b.threadIds) || b.threadIds.some((x: unknown) => typeof x !== 'string') || typeof b.idempotencyKey !== 'string') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  const r = await placeRepairCheck(supabase, b.threadIds, b.idempotencyKey)
  return NextResponse.json(r, { status: r.ok ? 200 : 409 })
}

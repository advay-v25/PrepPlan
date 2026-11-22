import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { clearHistory, loadHistory } from '../../../../lib/coach/service'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  return NextResponse.json({ ok: true, messages: await loadHistory(access.user.id) })
}

/** Clears the conversation. Confirmed changes already made to the plan stay. */
export async function DELETE() {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  await clearHistory(access.user.id)
  return NextResponse.json({ ok: true })
}

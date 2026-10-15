import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { clearHistory, loadHistory } from '../../../../lib/coach/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, messages: await loadHistory(user.id) })
}

/** Clears the conversation. Confirmed changes already made to the plan stay. */
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  await clearHistory(user.id)
  return NextResponse.json({ ok: true })
}

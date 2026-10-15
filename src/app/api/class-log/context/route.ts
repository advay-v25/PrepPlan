import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { getClassLogContext } from '../../../../lib/planning/classlog/service'

export const dynamic = 'force-dynamic'

/** Read-only: is this student class-led, and which class days are still unlogged. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, context: await getClassLogContext(user.id) })
}

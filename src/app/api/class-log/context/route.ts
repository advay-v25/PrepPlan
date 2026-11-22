import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { getClassLogContext } from '../../../../lib/planning/classlog/service'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'

export const dynamic = 'force-dynamic'

/** Read-only: is this student class-led, and which class days are still unlogged. */
export async function GET() {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user
  return NextResponse.json({ ok: true, context: await getClassLogContext(user.id) })
}

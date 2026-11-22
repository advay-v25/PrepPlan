import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'

const profileSchema = z.object({ name: z.string().min(1).max(100) })
/** Planning fields moved to the canonical, versioned onboarding editors (/api/onboarding/{exam,route,week}); this route no longer writes them. */
const RETIRED = ['examDate', 'maxSessionMinutes', 'prepMode'] as const

export async function GET() {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { data, error } = await supabase.from('profiles').select('display_name').eq('id', access.user.id).single()
  if (error) return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  return NextResponse.json({ profile: { name: data.display_name } })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const userId = access.user.id

  const raw = await request.json().catch(() => null) as Record<string, unknown> | null
  const retired = raw && typeof raw === 'object' ? RETIRED.filter(k => k in raw) : []
  if (retired.length) return NextResponse.json({ ok: false, code: 'RETIRED_FIELD', fields: retired, error: 'This route only changes your name. Change your exam, route or study time in Settings; those edits are checked against your latest setup. Nothing was changed.' }, { status: 400 })
  const parsed = profileSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid profile data.' }, { status: 400 })
  // A name-only patch touches nothing that affects planning (update_planning_profile does not move the setup version for it).
  const { error } = await createAdminClient().rpc('update_planning_profile', { p_user: userId, p_patch: { display_name: parsed.data.name } })
  if (error) {
    console.error('Profile update error:', error)
    return NextResponse.json({ error: 'Failed to update profile. Nothing was changed.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

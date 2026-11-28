import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import { NAME_ERROR, normalizePersonName } from '../../../lib/auth/personName'
import { JsonInputError, readBoundedJson } from '../../../lib/auth/requestSecurity'

const profileSchema = z.strictObject({ name: z.string().max(300) })
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

  let raw: unknown
  try { raw = await readBoundedJson(request, 2048) }
  catch (error) {
    if (error instanceof JsonInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Enter a valid name.' }, { status: 400 })
  }
  const retired = raw && typeof raw === 'object' ? RETIRED.filter(k => k in raw) : []
  if (retired.length) return NextResponse.json({ ok: false, code: 'RETIRED_FIELD', fields: retired, error: 'This route only changes your name. Change your exam, route or study time in Settings; those edits are checked against your latest setup. Nothing was changed.' }, { status: 400 })
  const parsed = profileSchema.safeParse(raw)
  const name = parsed.success ? normalizePersonName(parsed.data.name) : null
  if (name === null) return NextResponse.json({ error: NAME_ERROR, code: 'INVALID_NAME' }, { status: 400 })
  // A name-only patch touches nothing that affects planning (update_planning_profile does not move the setup version for it).
  const { error } = await createAdminClient().rpc('update_planning_profile', { p_user: userId, p_patch: { display_name: name } })
  if (error) {
    console.error('Profile update error:', error.code)
    return NextResponse.json({ error: 'Could not confirm the name change. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

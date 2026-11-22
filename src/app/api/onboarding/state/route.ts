import { isAdmitted } from '../../../../lib/beta/admission'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { readCanonicalState } from '../../../../lib/onboarding/service'

/** The single read contract for onboarding. Read-only. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, code: 'unauthorized', message: 'Unauthorized' }, { status: 401 })
  if (!user.email_confirmed_at || !(await isAdmitted(user.id))) return NextResponse.json({ ok: false, code: 'NOT_ADMITTED', error: 'PrepPlan is a private beta and this account has no valid invitation.' }, { status: 403 })
  return NextResponse.json({ ok: true, data: await readCanonicalState(user.id) })
}

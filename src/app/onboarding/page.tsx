import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { createAdminClient } from '../../lib/supabase/admin'
import { STEPS, type Step } from '../../lib/onboarding/steps'
import { readCanonicalState } from '../../lib/onboarding/service'

/**
 * Resumes where the student left off.
 *
 * `/onboarding` is now only an entry point — the flow itself lives at
 * `/onboarding/[step]` so the back button, deep links and refresh all work. The
 * old single route had all six steps in one component's local state.
 */
export default async function OnboardingEntry() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding')

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('onboarding_status').eq('id', user.id).maybeSingle()

  if (profile?.onboarding_status === 'complete') redirect('/app')

  const { firstIncompleteStep } = await readCanonicalState(user.id)
  redirect(`/onboarding/${firstIncompleteStep}`)
}

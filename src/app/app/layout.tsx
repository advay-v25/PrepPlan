import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { AppShell } from '../../components/AppShell'

export const dynamic = 'force-dynamic'

/**
 * Authentication and completed onboarding gate /app/*.
 *
 * This is a setup-completion gate, not an eligibility verdict. Every signed-in
 * user can finish onboarding and enter the product; no readiness score or
 * feasibility result can deny access.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app')

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_status')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.onboarding_status !== 'complete') redirect('/onboarding')

  return (
    <AppShell>{children}</AppShell>
  )
}

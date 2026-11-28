import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { isAdmitted } from '../../lib/beta/admission'
import { AppShell } from '../../components/AppShell'
import { profileRow } from '../../lib/ops/sharedReads'

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

  if (!user.email_confirmed_at) redirect('/check-email')
  if (!(await isAdmitted(user.id))) redirect('/not-invited')

  const profile = await profileRow(user.id)   // the same per-request snapshot the page's loaders share

  if (profile?.onboarding_status !== 'complete') redirect('/onboarding')

  return (
    <AppShell displayName={profile.display_name || user.user_metadata?.full_name || user.user_metadata?.name || null}>{children}</AppShell>
  )
}

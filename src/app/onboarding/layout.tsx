import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { isAdmitted } from '../../lib/beta/admission'

export const dynamic = 'force-dynamic'

/** Onboarding renders in the app's design system. Before it, a signed-in account must be verified and (in the private beta) admitted by an invitation. */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (user) {
    if (!user.email_confirmed_at) redirect('/check-email')
    if (!(await isAdmitted(user.id))) redirect('/not-invited')
  }
  return <div className="ob-root">{children}</div>
}

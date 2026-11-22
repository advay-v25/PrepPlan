import { redirect } from 'next/navigation'
import { createClient } from '../lib/supabase/server'
import { LandingExperience } from '../components/landing/LandingExperience'
import '../landing.css'
import { Bricolage_Grotesque } from 'next/font/google'

const display = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--font-display' })

export const metadata = { title: { absolute: 'CFA Level I study planner · PrepPlan' } }

export const dynamic = 'force-dynamic'

/**
 * A signed-in visitor has nothing to see here — /app's own layout resolves
 * whether they land in onboarding or the workspace, so this route only needs
 * to hand them off.
 */
export default async function LandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/app')

  return <LandingExperience className={display.variable} />
}

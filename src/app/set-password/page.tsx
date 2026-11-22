import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { SetPasswordForm } from '../../components/auth/RecoveryForms'
import { needsPassword } from '../../lib/auth/passwordState'
import { authDestination } from '../../lib/auth/redirect'

export const metadata = { title: 'Add a password' }
export const dynamic = 'force-dynamic'

/** Shown once after a first Google sign-in, so the same email and a password also work later. */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  const { next } = await searchParams
  const destination = authDestination(typeof next === 'string' ? next : null)
  if (!user) redirect('/login')
  if (!user.email_confirmed_at) redirect('/check-email')
  if (!needsPassword(user)) redirect(destination)
  return <SetPasswordForm email={user.email ?? ''} next={destination} />
}

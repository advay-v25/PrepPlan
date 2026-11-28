import { redirect } from 'next/navigation'
import { UpdatePasswordForm } from '../../components/auth/RecoveryForms'
import { recoveryGrant } from '../../lib/auth/securityServer'
import { verifiedSession } from '../../lib/auth/recoverySession'
import { createClient } from '../../lib/supabase/server'

export const metadata = { title: 'Set a new password' }

export default async function UpdatePasswordPage() {
  let allowed: boolean
  try {
    const session = await verifiedSession(await createClient())
    allowed = !!session && await recoveryGrant('check', session.userId, session.id)
  } catch {
    redirect('/auth/error?reason=unavailable&flow=recovery')
  }
  if (!allowed) redirect('/forgot-password')
  return <UpdatePasswordForm />
}

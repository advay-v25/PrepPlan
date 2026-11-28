import { redirect } from 'next/navigation'
import { getEntryUser } from '../../lib/supabase/server'
import { SignupForm } from '../../components/auth/SignupForm'

export const metadata = { title: 'Create account' }

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const user = await getEntryUser()
  if (user) redirect('/app')
  return <SignupForm />
}

import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { SignupForm } from '../../components/auth/SignupForm'

export const metadata = { title: 'Create account' }

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/app')
  return <SignupForm />
}

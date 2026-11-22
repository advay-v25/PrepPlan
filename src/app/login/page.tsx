import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { LoginForm } from '../../components/auth/LoginForm'
import { authDestination } from '../../lib/auth/redirect'

export const metadata = { title: 'Sign in' }

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { next, reset } = await searchParams
  const destination = authDestination(typeof next === 'string' ? next : null)
  if (user) redirect(destination)
  return <LoginForm nextPath={destination} reset={reset === 'success' || reset === 'sessions' ? reset : undefined} />
}

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getEntryUser } from '../../lib/supabase/server'
import { LoginForm } from '../../components/auth/LoginForm'
import { authDestination } from '../../lib/auth/redirect'
import { readResetReceipt, RESET_RECEIPT_COOKIE } from '../../lib/auth/securityServer'

export const metadata = { title: 'Sign in' }

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [user, { next }, store] = await Promise.all([getEntryUser(), searchParams, cookies()])
  const destination = authDestination(typeof next === 'string' ? next : null)
  if (user) redirect(destination)
  return <LoginForm nextPath={destination} reset={readResetReceipt(store.get(RESET_RECEIPT_COOKIE)?.value)} />
}

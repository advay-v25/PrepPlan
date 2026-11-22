import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { AccountActions } from '../../components/settings/AccountActions'

export const metadata = { title: 'Manage your account' }

export const dynamic = 'force-dynamic'

/** Own-account controls for a signed-in person, outside the study-app gate, so unfinished setup or admission never traps someone's data. No study feature is reachable from here. */
export default async function AccountPage() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) redirect('/login?next=/account')
  return (
    <main className="standalone-page">
      <h1>Your account</h1>
      <p className="fine-print">Signed in as {user.email}. You can download or delete your data here even if your setup is unfinished.</p>
      <AccountActions email={user.email ?? ''} />
      <p><Link href="/" className="text-button">Back to PrepPlan</Link></p>
    </main>
  )
}

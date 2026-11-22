import { createClient } from './../supabase/server'
import { notFound, redirect } from 'next/navigation'

/**
 * Checks if the user is authorized to perform reviewer actions (like promoting items or voiding evidence).
 *
 * Replaces the old environment-variable fallback. Fails closed: if no role is
 * configured in the database, nobody can review.
 */
export async function checkIsReviewer(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'diagnostic_reviewer')
    .maybeSingle()

  return Boolean(data)
}

/**
 * The one reviewer guard for pages and routes: a signed-in user who holds the reviewer role.
 * Returns an empty identity otherwise; pages show a 404 and routes enforce their own 401/403 contract.
 */
export async function getReviewer(): Promise<{ userId: string } | { userId: null; signedIn: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, signedIn: false }
  if (!user.email_confirmed_at) return { userId: null, signedIn: true }
  return (await checkIsReviewer(user.id)) ? { userId: user.id } : { userId: null, signedIn: true }
}

export async function requireReviewerPage(path: string) {
  const reviewer = await getReviewer()
  if (reviewer.userId) return { userId: reviewer.userId }
  if ('signedIn' in reviewer && reviewer.signedIn) notFound()
  redirect(`/login?next=${encodeURIComponent(path)}`)
}

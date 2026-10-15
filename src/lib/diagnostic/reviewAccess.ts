import { createClient } from './../supabase/server'

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

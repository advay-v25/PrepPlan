import { createAdminClient } from '../supabase/admin'

/** Private-beta admission (server-owned). In invite-only mode a user is admitted only through an invitation accepted by THEIR verified identity. */
export async function isAdmitted(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc('is_beta_admitted', { p_user: userId })
  if (error) { console.error('[admission]', error.message); return false }   // fail closed
  return data === true
}

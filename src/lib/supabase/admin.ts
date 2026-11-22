import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { tracedFetch } from '../ops/readTrace'
import { budgetFetch } from '../ops/requestBudget'

/**
 * Service-role client, for system-owned rows.
 *
 * Only use this on the server. Prefer the request-scoped client for owned
 * reads. A privileged write must first verify access and bind every affected
 * student row to the verified owner.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error('Supabase service role is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY)')
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: budgetFetch(tracedFetch ?? ((input, init) => fetch(input, init))) },
  })
}

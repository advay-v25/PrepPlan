import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client, for system-owned rows.
 *
 * Blueprints, forms, and form_items are system objects: every learner may read
 * them, but no learner owns one. Their RLS grants select to all and insert to
 * nobody, so building a form through the user's own client fails silently at
 * the insert — which is why starting a diagnostic never worked.
 *
 * Only ever call this from server code, and only for rows that are genuinely
 * not user-scoped. Anything belonging to a learner still goes through the
 * request-scoped client in ./server so RLS keeps enforcing ownership.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase service role is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

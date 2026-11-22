import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { boundedStage } from '../ops/requestBudget'

const fields = z.object({ sub: z.uuid(), session_id: z.uuid() })

/** Bind privileged actions to the cryptographically verified current token. */
export async function verifiedSession(client: SupabaseClient, token?: string) {
  const { data, error } = await boundedStage('verify session', 8000, () => client.auth.getClaims(token))
  if (error && (error.status ?? 0) >= 500) throw new Error('Session unavailable')
  const claims = fields.safeParse(data?.claims)
  return claims.success && data ? { userId: claims.data.sub, id: claims.data.session_id, claims: data.claims } : null
}

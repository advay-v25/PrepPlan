import type { User } from '@supabase/supabase-js'

/**
 * A Google-created account can keep using Google, or add a password for email sign-in.
 * An email sign-up always has the `email` provider. Password recovery records `password_set`.
 * This only controls the optional prompt and account copy.
 */
export function needsPassword(user: Pick<User, 'app_metadata' | 'user_metadata'>) {
  const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers as string[] : []
  return !providers.includes('email') && user.user_metadata?.password_set !== true
}

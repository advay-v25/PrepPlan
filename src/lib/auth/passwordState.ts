import type { User } from '@supabase/supabase-js'

/**
 * A Google-created account has no password, so signing in with its email would fail later. Such an account must set one before using the app.
 * An email sign-up always has the `email` provider; a Google account that has set a password carries `password_set` (written by the set-password action).
 */
export function needsPassword(user: Pick<User, 'app_metadata' | 'user_metadata'>) {
  const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers as string[] : []
  return !providers.includes('email') && user.user_metadata?.password_set !== true
}

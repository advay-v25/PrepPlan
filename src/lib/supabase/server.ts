import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { tracedFetch } from '../ops/readTrace'
import { sessionCookieOptions } from '../auth/requestSecurity'
import { budgetFetch } from '../ops/requestBudget'

export async function clearSessionCookies() {
  const prefix = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]}-auth-token`
  const cookieStore = await cookies()
  for (const { name } of cookieStore.getAll()) {
    if (name === prefix || name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}-code-verifier`)) {
      cookieStore.set(name, '', { ...sessionCookieOptions(), maxAge: 0 })
    }
  }
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: sessionCookieOptions(),
      global: { fetch: budgetFetch(tracedFetch ?? fetch) },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, name.endsWith('-code-verifier') && options.maxAge !== 0 ? { ...options, maxAge: 600 } : options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

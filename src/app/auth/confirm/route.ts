import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '../../../lib/supabase/server'
import { safeNextPath } from '../../../lib/auth/redirect'

export async function GET(request: Request) {
  const url = new URL(request.url); const tokenHash = url.searchParams.get('token_hash'); const type = url.searchParams.get('type') as EmailOtpType | null; const next = safeNextPath(url.searchParams.get('next'), '/onboarding')
  if (!tokenHash || !type) return NextResponse.redirect(new URL('/auth/error?reason=invalid', url.origin))
  const supabase = await createClient(); const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
  return NextResponse.redirect(new URL(error ? '/auth/error?reason=expired' : next, url.origin))
}

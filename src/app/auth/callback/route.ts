import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { safeNextPath } from '../../../lib/auth/redirect'

export async function GET(request: Request) {
  const url = new URL(request.url); 
  const code = url.searchParams.get('code'); 
  const next = safeNextPath(url.searchParams.get('next'))
  
  if (!code) return NextResponse.redirect(new URL('/auth/error?reason=missing_code', url.origin))
  
  const supabase = await createClient(); 
  const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code)
  
  if (error || !user) return NextResponse.redirect(new URL('/auth/error?reason=expired', url.origin))

  return NextResponse.redirect(new URL(next, url.origin))
}

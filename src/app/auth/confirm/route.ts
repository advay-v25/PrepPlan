import { redirect } from 'next/navigation'
import { authDestination } from '../../../lib/auth/redirect'

/** Older signup and sign-in links now open a confirmation screen without using the token. */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  if (type === 'recovery') redirect('/forgot-password')
  if (!tokenHash || !/^[A-Za-z0-9_-]{20,256}$/.test(tokenHash) || (type !== 'signup' && type !== 'magiclink')) {
    redirect(type === 'signup' ? '/auth/error?reason=invalid&flow=signup' : '/auth/error?reason=invalid')
  }
  const fragment = new URLSearchParams({ token_hash: tokenHash, type, next: authDestination(searchParams.get('next')) })
  redirect('/auth/verify#' + fragment.toString())
}

import Link from 'next/link'
import { AuthShell } from '../../../components/auth/AuthShell'

export const metadata = { title: 'Sign-in link unavailable' }

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams

  const copy = reason === 'cancelled'
    ? {
        title: 'Google sign-in was cancelled',
        body: 'You can try Google again or sign in with your email. Your study plan has not been changed.',
      }
    : reason === 'provider'
    ? {
        title: 'Google sign-in could not be completed',
        body: 'Try again or sign in with email. If this keeps happening, contact support.',
      }
    : reason === 'unavailable'
    ? {
        title: 'Sign-in is temporarily unavailable',
        body: 'We could not finish checking your sign-in. Check your connection and try again.',
      }
    : reason === 'expired'
    ? {
        title: 'This link has already been used or has expired',
        body: 'Try signing in again. Complete Google sign-in in the same browser where you started it.',
      }
    : {
        title: "This link can't be used",
        body: 'Try signing in or request a fresh email link.',
      }

  return (
    <AuthShell top={<>Need a hand? <Link href="/forgot-password">Reset password</Link></>}>
      <section className="auth-state">
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <Link className="auth-primary" href="/login">Try signing in</Link>
        <p className="auth-fine">Still stuck? <Link href="/forgot-password">Reset your password</Link> or <Link href="/signup">create a new account</Link>.</p>
      </section>
    </AuthShell>
  )
}

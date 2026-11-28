import Link from 'next/link'
import { AuthShell } from '../../../components/auth/AuthShell'

export const metadata = { title: 'Sign-in link unavailable' }

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string; flow?: string }> }) {
  const { reason, flow } = await searchParams
  const google = flow === 'google' || reason === 'cancelled' || reason === 'provider' || reason === 'missing_code'
  const action = google ? { href: '/login', label: 'Back to sign in' }
    : flow === 'signup' ? { href: '/check-email', label: 'Send a new confirmation email' }
    : { href: '/forgot-password', label: 'Send a new reset link' }

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
        body: google ? 'Start Google sign-in again and finish it in the same browser.'
          : 'Request a fresh email link and use the most recent message.',
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
        <Link className="auth-primary" href={action.href}>{action.label}</Link>
        {!google && flow !== 'signup' ? <Link className="text-button" href="/check-email">Resend confirmation email</Link> : null}
        {!google ? <Link className="text-button" href="/login">Back to sign in</Link> : null}
      </section>
    </AuthShell>
  )
}

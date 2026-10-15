import Link from 'next/link'

/**
 * A link that fails here isn't always actually broken: opening a
 * confirmation or reset link on a different device/browser than the one
 * that started the flow fails to exchange the code (it needs a verifier
 * stored by that original browser), even though Supabase already confirmed
 * the email or accepted the reset request server-side. `reason` lets the
 * message say something closer to the truth instead of one generic line
 * that leaves a successfully-confirmed user thinking they need to start
 * over from signup.
 */
export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams

  const copy = reason === 'expired'
    ? {
        title: 'This link has already been used or has expired',
        body: 'If you opened it on a different device or browser than the one you started on, the email was likely already confirmed, or the request already went through — try signing in directly.',
      }
    : {
        title: "This link can't be used",
        body: 'It may have expired, already been used, or been opened by an email security scanner.',
      }

  return (
    <main className="auth-single">
      <Link href="/" className="auth-brand"><span className="auth-brand-mark">//</span> Roadmap</Link>
      <section className="auth-state">
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <Link className="auth-primary" href="/login">Try signing in</Link>
        <p className="auth-fine">Still stuck? <Link href="/forgot-password">Reset your password</Link> or <Link href="/signup">create a new account</Link>.</p>
      </section>
    </main>
  )
}

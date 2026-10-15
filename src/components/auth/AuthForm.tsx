"use client"

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, BarChart3, BookOpenCheck, Eye, EyeOff, ShieldCheck, Wrench } from 'lucide-react'
import { createClient } from '../../lib/supabase/client'
import { safeNextPath } from '../../lib/auth/redirect'
import { Notice } from '../ui/Notice'

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Read directly off the URL rather than useSearchParams(), which forces a
  // Suspense boundary in the App Router — not worth it for a plain redirect
  // target and a one-off success banner.
  const [nextPath, setNextPath] = useState('/app')
  const [justReset, setJustReset] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setNextPath(safeNextPath(params.get('next')))
    setJustReset(params.get('reset') === 'success')
  }, [])

  const [unconfirmedEmail, setUnconfirmedEmail] = useState('')
  const [resent, setResent] = useState(false)

  const signInWithGoogle = async () => {
    setLoading(true); setError('')
    const supabase = createClient()
    // Google signups must land on context setup like email signups do, or they skip
    // onboarding entirely. Returning users signing in still go straight to the app
    // (or wherever they were trying to reach before being sent to sign in).
    const next = mode === 'signup' ? '/onboarding' : nextPath
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } })
    if (authError) { setError('Google sign-in could not be started. Please try again.'); setLoading(false) }
  }

  const resendConfirmation = async () => {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.resend({ type: 'signup', email: unconfirmedEmail })
    setResent(true); setLoading(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setUnconfirmedEmail(''); setResent(false)
    if (mode === 'signup' && !accepted) { setError('Please accept the Terms and Privacy Policy to continue.'); return }
    // The 8-character minimum is a signup rule, not a login rule — enforcing it on
    // login would lock out any account created before this minimum existed.
    if (mode === 'signup' && password.length < 8) { setError('Use at least 8 characters for your password.'); return }
    setLoading(true)
    const supabase = createClient()
    if (mode === 'login') {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        // Supabase's own message distinguishes these; our generic wrong-password
        // copy was swallowing "Email not confirmed" and leaving an unconfirmed
        // user with no way to even find out why, let alone resend the email.
        if (authError.code === 'email_not_confirmed') {
          setError('Confirm your email before signing in.')
          setUnconfirmedEmail(email)
        } else {
          setError('The email or password is incorrect.')
        }
        setLoading(false); return
      }
      router.replace(nextPath); router.refresh(); return
    }
    const { data, error: authError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` } })
    if (authError) { setError('We could not create the account. Check your details and try again.'); setLoading(false); return }
    // Supabase returns no error for an email that already belongs to a confirmed
    // account (an anti-enumeration measure: an error here would let an attacker
    // probe which emails are registered) — instead the returned user carries no
    // identities. No confirmation email is sent in that case, so sending this
    // visitor to check-email would have them wait for an email that never comes.
    if (data.user && data.user.identities?.length === 0) {
      setError('An account already exists for this email. Sign in, or reset your password if you\'ve forgotten it.')
      setLoading(false); return
    }
    router.push(`/check-email?email=${encodeURIComponent(email)}`)
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link href="/" className="auth-brand"><span className="auth-brand-mark">//</span> Roadmap</Link>
        <div className="auth-form-wrap">
          <h1>{mode === 'login' ? 'Build a study plan that responds to evidence.' : 'Create your Roadmap account.'}</h1>
          <p className="auth-lede">{mode === 'login' ? 'Sign in to continue your CFA Level I roadmap.' : 'Share optional context, then organise your studies one week at a time.'}</p>
          {justReset ? <Notice tone="success" role="status">Password updated. Sign in with your new password.</Notice> : null}
          <button className="google-button" onClick={signInWithGoogle} disabled={loading}><span className="google-g">G</span> Continue with Google</button>
          <div className="auth-divider"><span>or</span></div>
          <form className="auth-form" onSubmit={submit}>
            {mode === 'signup' ? (
              <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required placeholder="Your name" /></label>
            ) : null}
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" /></label>
            <label>Password<span className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required placeholder="At least 8 characters" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </span></label>
            {mode === 'login' ? (
              <div className="auth-helper-row"><span /><Link href="/forgot-password">Forgot password?</Link></div>
            ) : (
              <label className="auth-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> <span>I agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</span></label>
            )}
            {error ? (
              <p className="auth-error" role="alert">
                {error}
                {unconfirmedEmail && !resent && (
                  <> <button type="button" className="text-button" onClick={resendConfirmation} disabled={loading}>Resend confirmation email</button></>
                )}
                {resent && <> Sent — check your inbox.</>}
              </p>
            ) : null}
            <button className="auth-primary" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={18} /></button>
          </form>
          <p className="auth-switch">{mode === 'login' ? <>Don&apos;t have an account? <Link href="/signup">Create account</Link></> : <>Already have an account? <Link href="/login">Sign in</Link></>}</p>
        </div>
      </section>
      <aside className="auth-explainer">
        <div><h2>How Roadmap works</h2><p>An evidence-driven cycle that continuously improves your plan.</p></div>
        <ol>
          <li><span><BookOpenCheck size={20} /></span><div><strong>Class or self-study</strong><small>Capture what was covered and what fits your real week.</small></div></li>
          <li><span><BarChart3 size={20} /></span><div><strong>Diagnostic</strong><small>Measure application, missed detail and confidence calibration.</small></div></li>
          <li><span><Wrench size={20} /></span><div><strong>Repair</strong><small>Target the prerequisite or misconception causing the miss.</small></div></li>
          <li><span><ShieldCheck size={20} /></span><div><strong>Re-verify</strong><small>Confirm that the repair held before readiness moves.</small></div></li>
        </ol>
      </aside>
    </main>
  )
}

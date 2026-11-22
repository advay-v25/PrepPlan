"use client"

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight, BarChart3, BookOpenCheck, Eye, EyeOff, ShieldCheck, Wrench } from 'lucide-react'
import { authRequest } from '../../lib/auth/authRequest'
import { GOOGLE_SIGN_IN_ENABLED, MIN_PASSWORD_LENGTH, passwordRule, TURNSTILE_SITE_KEY } from '../../lib/auth/authPolicy'
import { TurnstileCheck } from './TurnstileCheck'
import { Notice } from '../ui/Notice'

export function AuthForm({ mode, nextPath = '/app', reset }: { mode: 'login' | 'signup'; nextPath?: string; reset?: 'success' | 'sessions' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)

  const signInWithGoogle = async () => {
    if (loading || (mode === 'signup' && !accepted)) return
    setLoading(true); setError('')
    try {
      const result = await authRequest('google', { next: mode === 'signup' ? '/onboarding' : nextPath })
      if (result.ok && result.data?.providerUrl) { window.location.assign(result.data.providerUrl); return }
      setError(result.data?.error ?? 'Google sign-in could not start. Try again or use email.')
    } catch { setError('Google sign-in could not be reached. Try again or use email.') }
    setLoading(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading || (TURNSTILE_SITE_KEY && !captcha)) return
    setError('')
    if (mode === 'signup') {
      if (!accepted) { setError('Please accept the Terms and Privacy Policy to continue.'); return }
      const rule = passwordRule(password)
      if (rule) { setError(rule); return }
    }
    setLoading(true)
    try {
      const fields = { email, password, captchaToken: captcha || undefined }
      const result = await authRequest(mode, mode === 'signup' ? { ...fields, name, accepted } : { ...fields, next: nextPath })
      if (result.ok) {
        window.location.assign(mode === 'signup' ? '/check-email' : result.data?.next ?? '/app')
        return
      }
      setError(result.data?.error ?? 'Sign-in could not be confirmed. Try again.')
    } catch {
      setError('Roadmap could not be reached. Try again.')
    } finally {
      setCaptcha(''); setCaptchaAttempt((value) => value + 1); setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link href="/" className="auth-brand"><span className="brand-mark"><span /></span> Roadmap</Link>
        <div className="auth-form-wrap">
          <h1>{mode === 'login' ? 'Build a study plan that responds to evidence.' : 'Create your Roadmap account.'}</h1>
          <p className="auth-lede">{mode === 'login' ? 'Sign in to continue your CFA Level I roadmap.' : 'Set up your exam and your week, then organise your studies one week at a time.'}</p>
          {reset ? <Notice tone={reset === 'success' ? 'success' : 'warn'} role="status">{reset === 'success' ? 'Password updated. Sign in with your new password.' : 'Password updated. Roadmap could not confirm that every previous session was revoked.'}</Notice> : null}
          {GOOGLE_SIGN_IN_ENABLED && mode === 'login' ? <>
            <button type="button" className="google-button" onClick={signInWithGoogle} disabled={loading}><span className="google-g">G</span> Continue with Google</button>
            <div className="auth-divider"><span>or</span></div>
          </> : null}
          <form className="auth-form" onSubmit={submit}>
            {mode === 'signup' ? (
              <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={100} required placeholder="Your name" /></label>
            ) : null}
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} required placeholder="you@example.com" /></label>
            <label>Password<span className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required maxLength={mode === 'login' ? 1024 : 72} minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined} />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </span></label>
            {mode === 'login' ? (
              <div className="auth-helper-row"><Link href="/check-email">Verify email</Link><Link href="/forgot-password">Forgot password?</Link></div>
            ) : (
              <label className="auth-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> <span>I agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</span></label>
            )}
            <TurnstileCheck onToken={setCaptcha} attempt={captchaAttempt} />
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button type="submit" className="auth-primary" disabled={loading || !!TURNSTILE_SITE_KEY && !captcha}>{loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={18} /></button>
            {GOOGLE_SIGN_IN_ENABLED && mode === 'signup' ? <button type="button" className="google-button" onClick={signInWithGoogle} disabled={loading || !accepted}><span className="google-g">G</span> Continue with Google</button> : null}
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

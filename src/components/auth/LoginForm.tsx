"use client"

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { authRequest } from '../../lib/auth/authRequest'
import { GOOGLE_SIGN_IN_ENABLED, TURNSTILE_SITE_KEY } from '../../lib/auth/authPolicy'
import { TurnstileCheck } from './TurnstileCheck'
import { GoogleMark } from './GoogleMark'
import { AuthShell } from './AuthShell'
import { LoginAside } from './AuthAside'
import { Notice } from '../ui/Notice'

/** The /login page. Same frame and field style as sign-up. */
export function LoginForm({ nextPath = '/app', reset }: { nextPath?: string; reset?: 'success' | 'sessions' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const blocked = loading || (!!TURNSTILE_SITE_KEY && !captcha)

  const signInWithGoogle = async () => {
    if (loading) return
    setLoading(true); setError('')
    try {
      const result = await authRequest('google', { next: nextPath })
      if (result.ok && result.data?.providerUrl) { window.location.assign(result.data.providerUrl); return }
      setError(result.data?.error ?? 'Google sign-in could not start. Try again or use email.')
    } catch { setError('Google sign-in could not be reached. Try again or use email.') }
    setLoading(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (blocked) return
    setError(''); setLoading(true)
    try {
      const result = await authRequest('login', { email, password, captchaToken: captcha || undefined, next: nextPath })
      if (result.ok) { window.location.assign(result.data?.next ?? '/app'); return }
      setError(result.data?.error ?? 'Sign-in could not be confirmed. Try again.')
    } catch {
      setError('PrepPlan could not be reached. Try again.')
    } finally {
      setCaptcha(''); setCaptchaAttempt(v => v + 1); setLoading(false)
    }
  }

  return (
    <AuthShell top={<>New to PrepPlan? <Link href="/signup">Create account</Link></>} aside={<LoginAside />}>
      <h1>Welcome back</h1>
      <p className="su-lede">Sign in to continue your CFA Level I plan</p>

      {reset ? <Notice tone={reset === 'success' ? 'success' : 'warn'} role="status">{reset === 'success' ? 'Password updated. Sign in with your new password.' : 'Password updated. PrepPlan could not confirm that every previous session was revoked.'}</Notice> : null}

      {GOOGLE_SIGN_IN_ENABLED ? <>
        <button type="button" className="su-google" onClick={signInWithGoogle} disabled={loading}><GoogleMark /> Continue with Google</button>
        <div className="su-or"><span>or use your email</span></div>
      </> : null}

      <form className="su-form" onSubmit={submit}>
        <label className="su-field"><span>Email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required placeholder="you@example.com" />
        </label>
        <label className="su-field">
          <span className="su-fieldrow">Password <Link href="/forgot-password">Forgot password?</Link></span>
          <span className="su-pass">
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={1024} />
            <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </span>
        </label>
        <TurnstileCheck onToken={setCaptcha} attempt={captchaAttempt} />
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button type="submit" className="su-submit" disabled={blocked}>{loading ? 'Please wait…' : 'Sign in'} <ArrowRight size={18} aria-hidden /></button>
        <p className="su-small">Haven&rsquo;t confirmed your email yet? <Link href="/check-email">Send the confirmation link again</Link></p>
      </form>
    </AuthShell>
  )
}

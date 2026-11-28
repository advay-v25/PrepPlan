"use client"

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import gsap from 'gsap'
import { ArrowRight } from 'lucide-react'
import { authRequest } from '../../lib/auth/authRequest'
import { GOOGLE_SIGN_IN_ENABLED, TURNSTILE_SITE_KEY } from '../../lib/auth/authPolicy'
import { TurnstileCheck } from './TurnstileCheck'
import { GoogleMark } from './GoogleMark'
import { AuthShell } from './AuthShell'
import { LoginAside } from './AuthAside'
import { PasswordField } from './PasswordField'
import { useAuthFormReady } from './useAuthFormReady'
import { Notice } from '../ui/Notice'
import { calm, enter } from '../flow/motion'

/** The /login page. Same frame and field style as sign-up. */
export function LoginForm({ nextPath = '/app', reset }: { nextPath?: string; reset?: 'success' | 'sessions' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const card = useRef<HTMLDivElement>(null)
  const ready = useAuthFormReady()
  const blocked = !ready || loading || (!!TURNSTILE_SITE_KEY && !captcha)

  useLayoutEffect(() => { if (card.current) enter(card.current.querySelectorAll(':scope > *')) }, [])
  // A refused sign-in nudges the form sideways once, so the error is felt as well as read.
  const refuse = (message: string) => {
    setError(message)
    if (!calm() && card.current) gsap.fromTo(card.current.querySelector('.su-form'), { x: 0 }, { x: 0, keyframes: { x: [-8, 7, -4, 2, 0] }, duration: 0.38, ease: 'power2.out' })
  }

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
      refuse(result.data?.error ?? 'Sign-in could not be confirmed. Try again.')
    } catch {
      refuse('PrepPlan could not be reached. Try again.')
    } finally {
      setCaptcha(''); setCaptchaAttempt(v => v + 1); setLoading(false)
    }
  }

  return (
    <AuthShell top={<>New here? <Link href="/signup">Create account</Link></>} aside={<LoginAside />}>
      <div ref={card} className="su-stack">
        <h1>Welcome back</h1>

        {reset ? <Notice tone={reset === 'success' ? 'success' : 'warn'} role="status">{reset === 'success' ? 'Password updated. Sign in with it now.' : 'Password updated. Other devices may still be signed in.'}</Notice> : null}

        {GOOGLE_SIGN_IN_ENABLED ? <>
          <button type="button" className="su-google" onClick={signInWithGoogle} disabled={!ready || loading}><GoogleMark /> Continue with Google</button>
          <div className="su-or"><span>or</span></div>
        </> : null}

        <form className="su-form" onSubmit={submit}>
          <label className="su-field"><span>Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required placeholder="you@example.com" />
          </label>
          <PasswordField value={password} onChange={setPassword} autoComplete="current-password" meter={false} maxLength={1024}
            rightLabel={<Link href="/forgot-password">Forgot password?</Link>} />
          <TurnstileCheck onToken={setCaptcha} attempt={captchaAttempt} />
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button type="submit" className="su-submit" disabled={blocked}>{loading ? 'Signing in…' : 'Sign in'} <ArrowRight size={18} aria-hidden /></button>
        </form>
        <p className="su-small"><Link href="/check-email">Resend confirmation email</Link></p>
      </div>
    </AuthShell>
  )
}

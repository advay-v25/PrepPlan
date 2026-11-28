"use client"

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { authRequest } from '../../lib/auth/authRequest'
import { GOOGLE_SIGN_IN_ENABLED, passwordRule, TURNSTILE_SITE_KEY } from '../../lib/auth/authPolicy'
import { GoogleMark } from './GoogleMark'
import { AuthShell } from './AuthShell'
import { SignupAside } from './AuthAside'
import { PasswordField } from './PasswordField'
import { TurnstileCheck } from './TurnstileCheck'
import { useAuthFormReady } from './useAuthFormReady'
import { NAME_ERROR, normalizePersonName } from '../../lib/auth/personName'
import { enter } from '../flow/motion'

/** The /signup page. Same account call as the shared AuthForm; a layout of its own so the page stays short. */
export function SignupForm() {
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const card = useRef<HTMLDivElement>(null)
  const ready = useAuthFormReady()
  const blocked = !ready || loading || (!!TURNSTILE_SITE_KEY && !captcha)
  const nameBad = nameTouched && name.trim() !== '' && !normalizePersonName(name)

  useLayoutEffect(() => { if (card.current) enter(card.current.querySelectorAll(':scope > *')) }, [])

  const signInWithGoogle = async () => {
    if (loading) return
    setLoading(true); setError('')
    try {
      const result = await authRequest('google', { next: '/onboarding' })
      if (result.ok && result.data?.providerUrl) { window.location.assign(result.data.providerUrl); return }
      setError(result.data?.error ?? 'Google sign-in could not start. Try again or use email.')
    } catch { setError('Google sign-in could not be reached. Try again or use email.') }
    setLoading(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (blocked) return
    setError('')
    const normalizedName = normalizePersonName(name)
    if (!normalizedName) { setNameTouched(true); setError(NAME_ERROR); return }
    if (!accepted) { setError('Please accept the Terms and Privacy Policy to continue.'); return }
    const rule = passwordRule(password)
    if (rule) { setError(rule); return }
    setLoading(true)
    try {
      const result = await authRequest('signup', { email, password, captchaToken: captcha || undefined, name: normalizedName, accepted })
      if (result.ok) { window.location.assign('/check-email?from=signup'); return }
      setError(result.data?.error ?? 'Sign-up could not be confirmed. Try again.')
    } catch {
      setError('PrepPlan could not be reached. Try again.')
    } finally {
      setCaptcha(''); setCaptchaAttempt(v => v + 1); setLoading(false)
    }
  }

  return (
    <AuthShell top={<>Have an account? <Link href="/login">Sign in</Link></>} aside={<SignupAside />}>
      <div ref={card} className="su-stack">
        <h1>Create your account</h1>
        <p className="su-small">After you verify your email or continue with Google, you’ll set your exam target and study week.</p>

        {GOOGLE_SIGN_IN_ENABLED ? <>
          <button type="button" className="su-google" aria-describedby="signup-policies" onClick={signInWithGoogle} disabled={!ready || loading}><GoogleMark /> Sign up with Google</button>
          <div className="su-or"><span>or</span></div>
        </> : null}

        <form className="su-form" onSubmit={submit}>
          <label className="su-field"><span>Full name</span>
            <input value={name} onChange={e => setName(e.target.value)} onBlur={() => setNameTouched(true)} autoComplete="name" maxLength={200} required placeholder="Your name" aria-invalid={nameBad} aria-describedby={nameBad ? 'su-name-rule' : undefined} />
            {nameBad ? <small id="su-name-rule" className="su-hint is-bad">{NAME_ERROR}</small> : null}
          </label>
          <label className="su-field"><span>Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required placeholder="you@example.com" />
          </label>
          <PasswordField value={password} onChange={setPassword} />
          <label className="su-consent"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} aria-describedby="signup-policies" /> <span>I agree to the Terms and Privacy Policy.</span></label>
          <TurnstileCheck onToken={setCaptcha} attempt={captchaAttempt} />
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button type="submit" className="su-submit" disabled={blocked}>{loading ? 'Creating…' : 'Create account'} <ArrowRight size={18} aria-hidden /></button>
        </form>
        <p id="signup-policies" className="su-agree">{GOOGLE_SIGN_IN_ENABLED ? 'Continuing with Google also means you agree to the ' : 'Read the '}<Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
      </div>
    </AuthShell>
  )
}

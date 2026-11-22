"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, CheckCircle2, Mail } from 'lucide-react'
import { authRequest } from '../../lib/auth/authRequest'
import { MIN_PASSWORD_LENGTH, passwordRule, TURNSTILE_SITE_KEY, VERIFICATION_TYPES, type VerificationType } from '../../lib/auth/authPolicy'
import { TurnstileCheck } from './TurnstileCheck'

function EmailRequest({ action }: { action: 'forgot' | 'resend' }) {
  const reset = action === 'forgot'
  const [email, setEmail] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending || (TURNSTILE_SITE_KEY && !captcha)) return
    setSending(true)
    setError('')
    try {
      const result = await authRequest(action, { email, captchaToken: captcha || undefined })
      if (result.ok) setSent(true)
      else setError(result.data?.error ?? 'PrepPlan could not confirm the request. Wait a moment and try again.')
    } catch {
      setError('PrepPlan could not confirm the request. Wait a moment and try again.')
    } finally {
      setCaptcha('')
      setAttempt(value => value + 1)
      setSending(false)
    }
  }

  return <AuthCard>
    {sent ? <div className="auth-state">
      <CheckCircle2 size={40} aria-hidden />
      <h1>Check your inbox</h1>
      <p>{reset ? 'If this address can receive a password reset, you’ll get a link to choose a new password.' : 'If this address is awaiting verification, you’ll get a confirmation link.'}</p>
      <p className="auth-fine">Check your spam folder and give the email a few minutes to arrive.</p>
      <Link className="auth-primary" href="/login">Return to sign in</Link>
      <button type="button" className="text-button" onClick={() => setSent(false)}>Use another email address</button>
    </div> : <>
      <Link href="/login" className="auth-back"><ArrowLeft size={17} /> Back to sign in</Link>
      <Mail size={30} className="auth-state-icon" aria-hidden />
      <h1>{reset ? 'Reset your password' : 'Verify your email'}</h1>
      <p className="auth-lede">{reset ? 'Enter your email address to request a single-use password-reset link.' : 'If your email still needs verification, open the link in your inbox to continue. You can request a fresh link below.'}</p>
      <form className="auth-form" onSubmit={submit}>
        <label>Email<input type="email" required autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <TurnstileCheck onToken={setCaptcha} attempt={attempt} />
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button type="submit" className="auth-primary" disabled={sending || !!TURNSTILE_SITE_KEY && !captcha}>
          {sending ? 'Requesting…' : reset ? 'Send reset link' : 'Send confirmation link'} <ArrowRight size={18} />
        </button>
      </form>
    </>}
  </AuthCard>
}

export function ForgotPasswordForm() { return <EmailRequest action="forgot" /> }
export function CheckEmail() { return <EmailRequest action="resend" /> }

type EmailLink = { type: VerificationType; tokenHash: string; next?: string; intent?: string }

export function VerificationForm() {
  const [link, setLink] = useState<EmailLink | null | undefined>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const params = new URLSearchParams(window.location.hash.slice(1))
    const type = params.get('type') as VerificationType
    const tokenHash = params.get('token_hash')
    const intent = params.get('intent') ?? undefined
    setLink(VERIFICATION_TYPES.includes(type) && tokenHash && (type !== 'recovery' || intent)
      ? { type, tokenHash, intent, next: params.get('next') ?? undefined } : null)
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [])

  async function verify() {
    if (!link || loading) return
    setLoading(true)
    setError('')
    try {
      const result = await authRequest('verify', link)
      if (result.ok && result.data?.next) { window.location.assign(result.data.next); return }
      setError(result.data?.error ?? 'Verification could not be confirmed. Try again or request a new link.')
    } catch { setError('Verification could not be confirmed. Try again or request a new link.') }
    finally { setLoading(false) }
  }

  return <AuthCard><div className="auth-state">
    <Mail size={30} className="auth-state-icon" aria-hidden />
    <h1>{link?.type === 'recovery' ? 'Confirm password reset' : link?.type === 'magiclink' ? 'Confirm sign-in' : 'Confirm your email'}</h1>
    {link === undefined ? <p role="status">Checking the link…</p> : link === null ? <p>This link can’t be used. Request a fresh email link to continue.</p> : <>
      <p>Continue when you’re ready to use this single-use link.</p>
      <button type="button" className="auth-primary" onClick={verify} disabled={loading}>{loading ? 'Confirming…' : 'Continue'}</button>
    </>}
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    {link?.type === 'recovery' ? <p><Link href="/update-password">Already confirmed? Choose your new password</Link> · <Link href="/forgot-password">Request a new reset email</Link></p> : <Link href="/check-email">Request a new confirmation email</Link>}
    <Link href="/login">Return to sign in</Link>
  </div></AuthCard>
}

export function UpdatePasswordForm() {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [newLinkRequired, setNewLinkRequired] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading || newLinkRequired) return
    const rule = passwordRule(password)
    if (rule) { setError(rule); return }
    if (password !== confirmation) { setError('The passwords do not match.'); return }
    setLoading(true)
    setError('')
    try {
      const result = await authRequest('update', { password })
      if (result.ok && result.data?.next) { window.location.assign(result.data.next); return }
      setError(result.data?.error ?? 'PrepPlan could not confirm the password change.')
      setNewLinkRequired(result.data?.code === 'RECOVERY_REQUIRED' || result.data?.code === 'RESET_OUTCOME_UNKNOWN')
    } catch {
      setError('PrepPlan could not confirm the password change. Try signing in with the new password or request a fresh link.')
      setNewLinkRequired(true)
    } finally { setLoading(false) }
  }

  return <AuthCard>
    <h1>Choose a new password</h1>
    <p className="auth-lede">Use a unique passphrase of at least {MIN_PASSWORD_LENGTH} characters.</p>
    <form className="auth-form" onSubmit={submit}>
      <label>New password<input type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} required /></label>
      <label>Confirm password<input type="password" autoComplete="new-password" maxLength={72} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {newLinkRequired ? <Link href="/forgot-password">Request a new reset email</Link> : <button type="submit" className="auth-primary" disabled={loading}>{loading ? 'Updating…' : 'Update password'} <ArrowRight size={18} /></button>}
      <Link href="/login">Return to sign in</Link>
    </form>
  </AuthCard>
}

/** First Google sign-in: add a password so the same email also works with a password later. */
export function SetPasswordForm({ email, next }: { email: string; next: string }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    const rule = passwordRule(password)
    if (rule) { setError(rule); return }
    if (password !== confirmation) { setError('The passwords do not match.'); return }
    setLoading(true)
    setError('')
    try {
      const result = await authRequest('setpassword', { password, next })
      if (result.ok && result.data?.next) { window.location.assign(result.data.next); return }
      setError(result.data?.error ?? 'PrepPlan could not save the password. Try again.')
    } catch { setError('PrepPlan could not be reached. Try again.') }
    finally { setLoading(false) }
  }

  return <AuthCard>
    <h1>Add a password</h1>
    <p className="auth-lede">You signed in with Google. Add a password so you can also sign in with {email ? <strong>{email}</strong> : 'your email'} whenever you like.</p>
    <form className="auth-form" onSubmit={submit}>
      <label>Password<input type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} required autoFocus /></label>
      <label>Confirm password<input type="password" autoComplete="new-password" maxLength={72} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
      <p className="auth-fine">At least {MIN_PASSWORD_LENGTH} characters. A short phrase works well.</p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <button type="submit" className="auth-primary" disabled={loading}>{loading ? 'Saving…' : 'Save and continue'} <ArrowRight size={18} /></button>
    </form>
  </AuthCard>
}

function AuthCard({ children }: { children: ReactNode }) {
  return <main className="auth-single"><Link href="/" className="auth-brand"><span className="brand-mark" aria-hidden="true" /> PrepPlan</Link><section>{children}</section></main>
}

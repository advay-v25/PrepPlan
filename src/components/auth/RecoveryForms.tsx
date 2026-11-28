"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { authRequest } from '../../lib/auth/authRequest'
import { passwordRule, TURNSTILE_SITE_KEY, VERIFICATION_TYPES, type VerificationType } from '../../lib/auth/authPolicy'
import { TurnstileCheck } from './TurnstileCheck'
import { AuthShell } from './AuthShell'
import { PasswordField } from './PasswordField'
import { useAuthFormReady } from './useAuthFormReady'
import { StateBadge } from './StateBadge'
import { enter } from '../flow/motion'

function EmailRequest({ action, afterSignup = false }: { action: 'forgot' | 'resend'; afterSignup?: boolean }) {
  const reset = action === 'forgot'
  const [email, setEmail] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const sentHeading = useRef<HTMLHeadingElement>(null)
  const blocked = !useAuthFormReady() || sending || (!!TURNSTILE_SITE_KEY && !captcha)
  useEffect(() => { if (sent) sentHeading.current?.focus() }, [sent])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (blocked) return
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
      <StateBadge icon="sent" />
      <h1 ref={sentHeading} tabIndex={-1}>Check your inbox</h1>
      <p>{reset ? 'If that address has an account, a reset link is on its way' : 'If that address is waiting for confirmation, a new link is on its way'}</p>
      <p className="auth-fine">It can take a few minutes. Check spam too.</p>
      <p className="auth-fine">Request entered for <strong>{email.trim()}</strong>.</p>
      <button type="button" className="text-button" onClick={() => setSent(false)}>Edit email or try again</button>
      <Link className="auth-back" href="/login">Back to sign in</Link>
    </div> : <div className="auth-state">
      <StateBadge icon={reset ? 'key' : 'mail'} />
      <h1>{reset ? 'Reset your password' : afterSignup ? 'Check your email' : 'Send a new confirmation email'}</h1>
      <p className="auth-lede">{reset ? 'We will email you a link to choose a new one'
        : afterSignup ? 'If your account was created, follow the confirmation link to finish signing up. You can request another link below.'
          : 'We will email you a fresh confirmation link'}</p>
      <form className="auth-form" onSubmit={submit}>
        <label>Email<input type="email" required autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <TurnstileCheck onToken={setCaptcha} attempt={attempt} />
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button type="submit" className="auth-primary" disabled={blocked}>
          {sending ? 'Sending…' : reset ? 'Send reset link' : 'Send confirmation link'} <ArrowRight size={18} />
        </button>
      </form>
      <Link href="/login" className="auth-back"><ArrowLeft size={16} /> Back to sign in</Link>
    </div>}
  </AuthCard>
}

export function ForgotPasswordForm() { return <EmailRequest action="forgot" /> }
export function CheckEmail({ afterSignup }: { afterSignup?: boolean }) { return <EmailRequest action="resend" afterSignup={afterSignup} /> }

type EmailLink = { type: VerificationType; tokenHash: string; next?: string; intent?: string }

export function VerificationForm() {
  const [link, setLink] = useState<EmailLink | null | undefined>()
  const [kind, setKind] = useState<VerificationType>()
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
    const knownKind = VERIFICATION_TYPES.includes(type)
    if (knownKind) setKind(type)
    setLink(knownKind && tokenHash && /^[A-Za-z0-9_-]{20,256}$/.test(tokenHash) && (type !== 'recovery' || intent)
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
      if (result.data?.code === 'INVALID_LINK') { setLink(null); return }
      setError(result.data?.error ?? 'Verification could not be confirmed. Try again or request a new link.')
    } catch { setError('Verification could not be confirmed. Try again or request a new link.') }
    finally { setLoading(false) }
  }

  const retry = kind === 'recovery' ? { href: '/forgot-password', label: 'Send a new reset link' }
    : kind === 'magiclink' ? { href: '/login', label: 'Start sign-in again' }
    : { href: '/check-email', label: 'Send a new confirmation email' }

  return <AuthCard><div className="auth-state">
    <StateBadge icon={kind === 'recovery' ? 'key' : 'mail'} />
    <h1>{link === null ? 'This link can’t be used' : kind === 'recovery' ? 'Confirm password reset' : kind === 'magiclink' ? 'Confirm sign-in' : 'Confirm your email'}</h1>
    {link === undefined ? <p role="status">Checking the link…</p> : link === null ? <p>This link can’t be used. Request a new one.</p> : <>
      <p>{link.type === 'recovery' ? 'Confirm this request to choose a new password.' : 'Confirm this request to continue. This link works once.'}</p>
      <button type="button" className="auth-primary" onClick={verify} disabled={loading}>{loading ? 'Confirming…' : link.type === 'recovery' ? 'Continue to new password' : link.type === 'magiclink' ? 'Confirm sign-in' : 'Confirm email'}</button>
    </>}
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    {link !== undefined ? <Link className={link === null ? 'auth-primary' : 'text-button'} href={retry.href}>{retry.label}</Link> : null}
    {link === null && !kind ? <Link className="text-button" href="/forgot-password">Send a new reset link</Link> : null}
    {retry.href !== '/login' ? <Link href="/login" className="auth-back"><ArrowLeft size={16} /> Back to sign in</Link> : null}
  </div></AuthCard>
}

export function UpdatePasswordForm() {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [newLinkRequired, setNewLinkRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const feedback = useRef<HTMLParagraphElement>(null)
  const blocked = !useAuthFormReady() || loading || newLinkRequired
  useEffect(() => { if (error) feedback.current?.focus() }, [error])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (blocked) return
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
    <div className="auth-state">
      <StateBadge icon="key" />
      <h1>Choose a new password</h1>
      <form className="auth-form" onSubmit={submit}>
        <PasswordField label="New password" value={password} onChange={setPassword} autoFocus />
        <PasswordField label="Confirm password" value={confirmation} onChange={setConfirmation} meter={false} match={password} />
        {error ? <p className="auth-error" role="alert" tabIndex={-1} ref={feedback}>{error}</p> : null}
        {newLinkRequired ? <Link className="auth-primary" href="/forgot-password">Request a new reset email</Link> : <button type="submit" className="auth-primary" disabled={blocked}>{loading ? 'Updating…' : 'Update password'} <ArrowRight size={18} /></button>}
      </form>
      <Link href="/login" className="auth-back"><ArrowLeft size={16} /> Back to sign in</Link>
    </div>
  </AuthCard>
}

export function SetPasswordForm({ email, next }: { email: string; next: string }) {
  return <AuthCard>
    <div className="auth-state">
      <StateBadge icon="key" />
      <h1>Keep using Google or add a password</h1>
      <p>You can sign in with Google and add a password later in Settings.</p>
      <Link className="auth-primary" href={next}>Continue with Google only</Link>
      <p className="auth-fine">To add a password now, <Link href="/forgot-password">request a link by email</Link>{email ? <> for <strong>{email}</strong></> : null}.</p>
    </div>
  </AuthCard>
}

function AuthCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) enter(ref.current.querySelectorAll('.auth-state > *:not(.sb)'), { y: 10 }) }, [])
  return <AuthShell top={<>Remembered it? <Link href="/login">Sign in</Link></>}><div ref={ref}>{children}</div></AuthShell>
}

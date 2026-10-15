"use client"

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, Mail } from 'lucide-react'
import { createClient } from '../../lib/supabase/client'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('')
    const supabase = createClient()
    // A missing account never errors here (Supabase's own anti-enumeration
    // behaviour — it would otherwise let an attacker probe which emails are
    // registered), but a real failure like rate-limiting does, and silently
    // showing "check your inbox" for that left someone waiting for an email
    // that was never sent, with no way to know why.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/update-password` })
    if (resetError) { setError('We could not send that right now. Wait a few minutes and try again.'); setLoading(false); return }
    setSent(true); setLoading(false)
  }
  return <AuthCard>{sent ? <div className="auth-state"><CheckCircle2 size={40} /><h1>Check your inbox</h1><p>If an account exists for <strong>{email}</strong>, you&apos;ll receive a secure password-reset link. Open it on this same device.</p><button className="auth-primary" onClick={() => setSent(false)}>Send again</button><Link href="/login">Return to sign in</Link></div> : <><Link href="/login" className="auth-back"><ArrowLeft size={17} /> Back to sign in</Link><Mail size={30} className="auth-state-icon" /><h1>Reset your password</h1><p className="auth-lede">Enter your account email. We&apos;ll send a single-use recovery link.</p><form className="auth-form" onSubmit={submit}><label>Email<input type="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>{error ? <p className="auth-error" role="alert">{error}</p> : null}<button className="auth-primary" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'} <ArrowRight size={18} /></button></form></>}</AuthCard>
}

export function UpdatePasswordForm() {
  const router = useRouter(); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); if (password.length < 8) { setError('Use at least 8 characters.'); return } if (password !== confirm) { setError('The passwords do not match.'); return } setLoading(true); const supabase = createClient(); const { error: updateError } = await supabase.auth.updateUser({ password }); if (updateError) { setError('This recovery link is invalid or expired. Request a new one.'); setLoading(false); return } 
    // 'global' clears the current session too, not just other devices — a
    // password change should always require signing back in, and /login now
    // redirects an already-authenticated visitor straight to /app, which
    // would otherwise skip this confirmation entirely.
    await supabase.auth.signOut({ scope: 'global' })
    router.replace('/login?reset=success')
  }
  return <AuthCard><h1>Choose a new password</h1><p className="auth-lede">Use a password you do not use for another account.</p><form className="auth-form" onSubmit={submit}><label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>{error ? <p className="auth-error">{error}</p> : null}<button className="auth-primary" disabled={loading}>{loading ? 'Updating…' : 'Update password'} <ArrowRight size={18} /></button></form></AuthCard>
}

export function CheckEmail({ email }: { email?: string }) {
  const [resent, setResent] = useState(false); const [loading, setLoading] = useState(false)
  const resend = async () => {
    if (!email) return
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.resend({ type: 'signup', email })
    setResent(true); setLoading(false)
  }
  return <AuthCard><div className="auth-state"><Mail size={40} /><h1>Verify your email</h1><p>We sent a confirmation link{email ? <> to <strong>{email}</strong></> : null}. Open it on this device to continue setup.</p><p className="auth-fine">The link may take a minute to arrive. Check spam before requesting another.</p>{email && (resent ? <p className="auth-fine">Sent again — check your inbox.</p> : <button type="button" className="text-button" onClick={resend} disabled={loading}>{loading ? 'Sending…' : 'Resend confirmation email'}</button>)}<Link className="auth-primary" href="/login">Return to sign in</Link></div></AuthCard>
}

function AuthCard({ children }: { children: React.ReactNode }) { return <main className="auth-single"><Link href="/" className="auth-brand"><span className="auth-brand-mark">//</span> Roadmap</Link><section>{children}</section></main> }

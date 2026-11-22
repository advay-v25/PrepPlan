"use client"

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarCheck, Check, Eye, EyeOff, Target, Clock3 } from 'lucide-react'
import { authRequest } from '../../lib/auth/authRequest'
import { GOOGLE_SIGN_IN_ENABLED, MIN_PASSWORD_LENGTH, passwordRule, TURNSTILE_SITE_KEY } from '../../lib/auth/authPolicy'
import { GoogleMark } from './GoogleMark'
import { TurnstileCheck } from './TurnstileCheck'

const DAYS = [
  { d: 'Mon', t: 'Ethics', m: '45 min' }, { d: 'Tue', t: 'Quant methods', m: '60 min' }, { d: 'Wed', t: 'Rest', m: '' },
  { d: 'Thu', t: 'Economics', m: '45 min' }, { d: 'Fri', t: 'Quant recap', m: '30 min' }, { d: 'Sat', t: 'Review', m: '60 min' }, { d: 'Sun', t: 'Paper', m: '90 min' },
]
const STEPS = [
  { Icon: Target, title: 'Set your exam', text: 'Pick the sitting you are aiming for.' },
  { Icon: Clock3, title: 'Share your week', text: 'Tell us when you can study.' },
  { Icon: CalendarCheck, title: 'Get your plan', text: 'A week you can actually follow.' },
]

/** The /signup page. Same account call as the shared AuthForm; a layout of its own so the page can lead with what happens next. */
export function SignupForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const longEnough = Array.from(password).length >= MIN_PASSWORD_LENGTH
  const blocked = loading || (!!TURNSTILE_SITE_KEY && !captcha)

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
    if (!accepted) { setError('Please accept the Terms and Privacy Policy to continue.'); return }
    const rule = passwordRule(password)
    if (rule) { setError(rule); return }
    setLoading(true)
    try {
      const result = await authRequest('signup', { email, password, captchaToken: captcha || undefined, name, accepted })
      if (result.ok) { window.location.assign('/check-email'); return }
      setError(result.data?.error ?? 'Sign-up could not be confirmed. Try again.')
    } catch {
      setError('PrepPlan could not be reached. Try again.')
    } finally {
      setCaptcha(''); setCaptchaAttempt(v => v + 1); setLoading(false)
    }
  }

  return (
    <main className="su">
      <section className="su-main">
        <header className="su-top">
          <Link href="/" className="auth-brand"><span className="brand-mark"><span /></span> PrepPlan</Link>
          <p>Have an account? <Link href="/login">Sign in</Link></p>
        </header>

        <div className="su-card">
          <h1>Create your account</h1>
          <p className="su-lede">About a minute. Next, you set your exam date and your week.</p>

          {GOOGLE_SIGN_IN_ENABLED ? <>
            <button type="button" className="su-google" onClick={signInWithGoogle} disabled={loading}><GoogleMark /> Sign up with Google</button>
            <p className="su-agree">By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link></p>
            <div className="su-or"><span>or use your email</span></div>
          </> : null}

          <form className="su-form" onSubmit={submit}>
            <label className="su-field"><span>Full name</span>
              <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={100} required placeholder="Your name" />
            </label>
            <label className="su-field"><span>Email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required placeholder="you@example.com" />
            </label>
            <label className="su-field"><span>Password</span>
              <span className="su-pass">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required maxLength={72} minLength={MIN_PASSWORD_LENGTH} aria-describedby="su-rule" />
                <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </span>
              <small id="su-rule" className={`su-rule${longEnough ? ' is-met' : ''}`}><Check size={13} aria-hidden /> At least {MIN_PASSWORD_LENGTH} characters. A short phrase works well.</small>
            </label>

            <label className="su-consent"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /> <span>I agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</span></label>

            <TurnstileCheck onToken={setCaptcha} attempt={captchaAttempt} />
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button type="submit" className="su-submit" disabled={blocked}>{loading ? 'Please wait…' : 'Create account'} <ArrowRight size={18} aria-hidden /></button>

          </form>
        </div>
        <p className="su-foot">Not affiliated with CFA Institute.</p>
      </section>

      <aside className="su-aside" aria-label="What happens next">
        <div className="su-aside__inner">
          <h2>Your first week, planned.</h2>
          <p>Study around your life, not the other way round.</p>
          <div className="su-week" role="img" aria-label="Example week: study sessions most days, a rest day on Wednesday and a practice paper on Sunday">
            <span className="su-week__tag">Example week</span>
            <ul>
              {DAYS.map(x => (
                <li key={x.d} className={x.t === 'Rest' ? 'is-rest' : x.t === 'Paper' ? 'is-paper' : ''}>
                  <b>{x.d}</b><span>{x.t}</span><em>{x.m}</em>
                </li>
              ))}
            </ul>
          </div>
          <ol className="su-steps">
            {STEPS.map(({ Icon, title, text }, i) => (
              <li key={title}><span><Icon size={18} aria-hidden /></span><div><strong>{i + 1}. {title}</strong><small>{text}</small></div></li>
            ))}
          </ol>
        </div>
      </aside>
    </main>
  )
}

"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '../ui/Dialog'
import { signOutThisDevice } from '../../lib/auth/signOutThisDevice'

export function AccountActions({ email }: { email: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState('')
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [sessionUnavailable, setSessionUnavailable] = useState(false)
  const signInRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => { if (sessionUnavailable) signInRef.current?.focus() }, [sessionUnavailable])

  // This device only: the session in THIS browser is cleared. Other devices stay signed in, and the page says so. A failure is shown, never ignored.
  // Re-authenticate: end THIS device's session and come back to the account page after the normal sign-in (password or Google), which proves a fresh sign-in for the new session.
  const signOutTo = async (destination: string) => {
    setLoading(true); setNotice(''); setError('')
    const result = await signOutThisDevice()
    if (!result.ok) {
      setSessionUnavailable(result.sessionUnavailable); setConfirming(false); setNotice(result.message); setLoading(false)
      return
    }
    router.push(destination)
  }
  const handleReauth = () => signOutTo('/login?next=%2Faccount')
  const handleSignOut = () => signOutTo('/login')

  // Fetch first so a failed preparation is an error message, never an error body saved as a .json file.
  const handleExport = async () => {
    setExporting(true); setNotice('')
    try {
      const res = await fetch('/api/account/export')
      if (!res.ok) { const b = await res.json().catch(() => null); setNotice(b?.error ?? 'The export could not be prepared. Nothing was changed.'); return }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `roadmap-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href)
      setNotice('Your data was downloaded. It is a copy for you, not a backup you can re-import.')
    } catch { setNotice('Could not reach PrepPlan. Nothing was downloaded.') } finally { setExporting(false) }
  }

  const handleDeleteAccount = async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmEmail: confirmText }) })
      if (response.status === 401) {
        // Signed out or already deleted (for example a lost earlier response): do not guess; say what is known.
        setError('This session is no longer signed in. Your earlier deletion may have completed, but this response cannot confirm it. Try signing in with your existing email and password. A failed sign-in alone does not prove deletion. Do not use "Continue with Google" to check, because that can create a new account.')
        setLoading(false); return
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        // The server's message is written for the student: it says whether anything was deleted and what to do next.
        setError(body?.error ?? 'Something went wrong. Nothing was deleted. Try again, or email support.')
        setNeedsSignIn(body?.code === 'RECENT_SIGN_IN_REQUIRED')
        setLoading(false)
        return
      }
      router.push('/')
    } catch {
      setError('We could not reach PrepPlan, so it is not confirmed whether your account was deleted. Try signing in with your existing email and password. If you get in, the account still exists and you can retry. A failed sign-in alone does not prove deletion. Do not use "Continue with Google" to check, because that can create a new account.')
      setLoading(false)
    }
  }

  if (sessionUnavailable) return <div className="account-actions"><p role="alert" className="fine-print">{notice}</p><a ref={signInRef} className="secondary-button" href="/login?next=%2Faccount">Sign in again</a></div>

  return (
    <div className="account-actions">
      <div className="account-actions__row">
        <button type="button" className="secondary-button" onClick={handleSignOut} disabled={loading}>Sign out of this device</button>
        <button type="button" className="secondary-button" onClick={handleExport} disabled={exporting}>{exporting ? 'Preparing…' : 'Download my data'}</button>
      </div>
      {notice && <p role="status" className="fine-print">{notice}</p>}
      <section className="account-danger" aria-labelledby="danger-h">
        <h3 id="danger-h">Delete your account</h3>
        <p className="fine-print">Permanent. Your downloaded copy is optional and separate; download it first if you want one.</p>
        <button type="button" className="secondary-button sign-out-button" onClick={() => { setConfirming(true); setConfirmText(''); setError('') }} disabled={loading}>Delete account…</button>
      </section>

      {confirming && (
        <Dialog
          open
          onClose={() => { if (!loading) setConfirming(false) }}
          role="alertdialog"
          title="Delete your account?"
          description="This permanently removes your account and all study data — your roadmap, calendar, test history, and notes. This cannot be undone."
          initialFocusRef={firstFieldRef}
          footer={(
            <>
              <button type="button" className="secondary-button" onClick={() => setConfirming(false)} disabled={loading}>Cancel</button>
              <button
                type="button"
                className="primary-button is-danger"
                onClick={handleDeleteAccount}
                disabled={loading || confirmText.trim().toLowerCase() !== email.toLowerCase()}
              >
                {loading ? 'Deleting…' : 'Delete my account'}
              </button>
            </>
          )}
        >
          <label className="field">
            <span>Type your email address ({email}) to confirm</span>
            <input
              ref={firstFieldRef}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={email}
              autoComplete="off"
            />
          </label>
          <p className="fine-print">Your data export is a separate download. A pseudonymous record that a deletion happened (a one-way hash of your account id and the time) is kept; the database provider's backups age out on their own schedule, and a reminder email already handed to the mail provider cannot be recalled. See the privacy page.</p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {needsSignIn && <p><button type="button" className="secondary-button" onClick={handleReauth}>Sign in again, then return here</button></p>}
        </Dialog>
      )}
    </div>
  )
}

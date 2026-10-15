"use client"

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'
import { Dialog } from '../ui/Dialog'

export function AccountActions() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState('')
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const handleSignOut = async () => {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleDeleteAccount = async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/account/delete', { method: 'DELETE' })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? 'Failed to delete account')
      }
      // The account is already gone server-side at this point, so Supabase's
      // own logout endpoint has nothing left to revoke and answers 403 — this
      // call is only here to clear the local session, which it still does
      // even when the network request itself fails.
      const supabase = createClient()
      await supabase.auth.signOut().catch(() => {})
      router.push('/')
    } catch {
      // A specific server message isn't shown here — if deletion fails it's a
      // data-dependency problem the person deleting their account can't fix
      // by rewording anything, so a generic "try again / contact us" reads
      // more honestly than echoing an internal error.
      setError('Something went wrong deleting your account. Please try again, or contact support if this keeps happening.')
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
      <button className="secondary-button" onClick={handleSignOut} disabled={loading}>
        Sign Out
      </button>
      <button
        className="secondary-button sign-out-button"
        onClick={() => { setConfirming(true); setConfirmText(''); setError('') }}
        disabled={loading}
      >
        Delete Account
      </button>

      {confirming && (
        <Dialog
          open
          onClose={() => setConfirming(false)}
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
                disabled={loading || confirmText !== 'DELETE'}
              >
                {loading ? 'Deleting…' : 'Delete my account'}
              </button>
            </>
          )}
        >
          <label className="field">
            <span>Type DELETE to confirm</span>
            <input
              ref={firstFieldRef}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </Dialog>
      )}
    </div>
  )
}

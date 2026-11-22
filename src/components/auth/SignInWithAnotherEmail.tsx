'use client'

import { useState } from 'react'
import { signOutThisDevice } from '../../lib/auth/signOutThisDevice'

export function SignInWithAnotherEmail() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function changeAccount() {
    setBusy(true)
    setError(null)
    const result = await signOutThisDevice()
    if (result.ok) window.location.assign('/login')
    else { setError(result.message); setBusy(false) }
  }

  return <div>
    <button type="button" className="secondary-button" disabled={busy} onClick={changeAccount}>{busy ? 'Signing out…' : 'Sign in with another email'}</button>
    {error && <p role="alert">{error}</p>}
  </div>
}

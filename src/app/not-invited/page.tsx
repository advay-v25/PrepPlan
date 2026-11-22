import Link from 'next/link'
import { SupportLink } from '../../components/legal/SupportLink'
import { AuthShell } from '../../components/auth/AuthShell'
import { SignInWithAnotherEmail } from '../../components/auth/SignInWithAnotherEmail'

export const metadata = { title: 'Invitation needed' }

/** Where an account without a valid beta invitation lands. Plain next steps; no detail about who is or is not on the list. */
export default function NotInvitedPage() {
  return (
    <AuthShell>
      <h1>PrepPlan needs an invitation</h1>
      <p>Your account is verified, but it is not linked to an invitation, so PrepPlan is not open to it yet.</p>
      <ul>
        <li><strong>Invitation expired or already used?</strong> Ask the person who invited you to send a new one.</li>
        <li><strong>Signed in with a different email than the one invited?</strong> Sign out and use the invited address.</li>
        <li><strong>Not sure?</strong> Contact <SupportLink subject="PrepPlan invitation" /> and say which address you were invited on.</li>
      </ul>
      <div className="su-actions"><SignInWithAnotherEmail /> <Link className="text-button" href="/account">Download or delete my data</Link></div>
    </AuthShell>
  )
}

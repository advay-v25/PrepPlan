import Link from 'next/link'
import { SupportLink } from '../../components/legal/SupportLink'
import { SignInWithAnotherEmail } from '../../components/auth/SignInWithAnotherEmail'

export const metadata = { title: 'Private beta invitation' }

/** Where an account without a valid beta invitation lands. Plain next steps; no detail about who is or is not on the list. */
export default function NotInvitedPage() {
  return (
    <main className="standalone-page">
      <h1>This is a private beta</h1>
      <p>Your account is verified, but it is not linked to a beta invitation, so PrepPlan is not open to it yet.</p>
      <ul>
        <li><strong>Invitation expired or already used?</strong> Ask the person who invited you to send a new one.</li>
        <li><strong>Signed in with a different email than the one invited?</strong> Sign out and use the invited address.</li>
        <li><strong>Not sure?</strong> Contact <SupportLink subject="PrepPlan invitation" /> and say which address you were invited on.</li>
      </ul>
      <div className="standalone-page__actions"><SignInWithAnotherEmail /> <Link className="text-button" href="/account">Download or delete my data</Link></div>
    </main>
  )
}
